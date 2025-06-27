/* eslint-disable @typescript-eslint/no-explicit-any */
// supabase/functions/execute-load-test/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
  'Access-Control-Max-Age': '86400',
}

interface ExecuteLoadTestRequest {
  projectId: string;
  testCaseIds: string[];
  environment?: 'local' | 'staging' | 'production';
  loadTestConfig?: {
    threads?: number;
    rampUp?: number;
    duration?: number;
    iterations?: number;
  };
}

interface LoadTestResult {
  test_case_id: string;
  status: 'pass' | 'fail' | 'skip';
  execution_time: number;
  error_message?: string;
  logs: string[];
  load_test_metrics: {
    requests_per_second: number;
    avg_response_time: number;
    error_rate: number;
    throughput: number;
    percentile_90: number;
    percentile_95: number;
    percentile_99: number;
    total_requests: number;
    failed_requests: number;
    duration: number;
    vusers: number;
    response_time_over_time?: number[];
    throughput_over_time?: number[];
    error_rate_over_time?: number[];
    error_details?: Array<{
      type: string;
      count: number;
      message?: string;
    }>;
  };
}

serve(async (req) => {
  console.log(`${req.method} ${req.url}`)
  
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      status: 200, 
      headers: corsHeaders 
    })
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { 
        status: 405, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        }
      }
    )
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing environment variables:', { supabaseUrl: !!supabaseUrl, supabaseServiceKey: !!supabaseServiceKey })
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { 
          status: 500, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          }
        }
      )
    }

    const requestData: ExecuteLoadTestRequest = await req.json()
    const { 
      projectId, 
      testCaseIds, 
      environment = 'staging',
      loadTestConfig = {}
    } = requestData

    if (!projectId || !testCaseIds || testCaseIds.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: projectId, testCaseIds' }),
        { 
          status: 400, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          }
        }
      )
    }

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey)

    // Get authenticated user
    const authHeader = req.headers.get('Authorization')
    let userId = null
    if (authHeader) {
      try {
        const token = authHeader.replace('Bearer ', '')
        const { data: { user } } = await supabaseClient.auth.getUser(token)
        userId = user?.id
      } catch (error) {
        console.error('Failed to get user from token:', error)
      }
    }

    // Get project details for environment URLs
    const { data: project, error: projectError } = await supabaseClient
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single()

    if (projectError || !project) {
      console.error('Project not found:', projectError)
      return new Response(
        JSON.stringify({ error: 'Project not found' }),
        { 
          status: 404, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          }
        }
      )
    }

    // Get load test cases
    const { data: testCases, error: testCasesError } = await supabaseClient
      .from('test_cases')
      .select('*')
      .in('id', testCaseIds)
      .eq('test_type', 'load')

    if (testCasesError || !testCases || testCases.length === 0) {
      console.error('No load test cases found:', testCasesError)
      return new Response(
        JSON.stringify({ error: 'No load test cases found' }),
        { 
          status: 404, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          }
        }
      )
    }

    // Get environment URL
    const environmentUrl = getEnvironmentUrl(project, environment)
    if (!environmentUrl) {
      return new Response(
        JSON.stringify({ error: `No URL configured for ${environment} environment` }),
        { 
          status: 400, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          }
        }
      )
    }

    // Create test run record
    const { data: testRun, error: testRunError } = await supabaseClient
      .from('test_runs')
      .insert({
        project_id: projectId,
        name: `Load Test Run - ${environment} - ${new Date().toISOString().slice(0, 19)}`,
        environment: environment,
        status: 'running',
        test_type: 'load',
        trigger_type: 'manual',
        trigger_data: { 
          testCaseIds, 
          environmentUrl,
          loadTestConfig
        },
        started_by: userId,
        started_at: new Date().toISOString(),
        total_tests: testCaseIds.length,
        passed_tests: 0,
        failed_tests: 0
      })
      .select()
      .single()

    if (testRunError || !testRun) {
      console.error('Failed to create test run record:', testRunError)
      return new Response(
        JSON.stringify({ error: 'Failed to create test run record' }), 
        { 
          status: 500, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          }
        }
      )
    }

    // Use Server-Sent Events for real-time updates
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const initialData = JSON.stringify({
          success: true,
          testRunId: testRun.id,
          message: 'Load test execution started',
          testType: 'load',
          environmentUrl,
          testCount: testCases.length
        })
        controller.enqueue(encoder.encode(`data: ${initialData}\n\n`))

        try {
          // Execute local load tests
          await executeLoadTests(
            supabaseClient,
            testRun.id,
            testCases,
            environmentUrl,
            loadTestConfig,
            (update) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(update)}\n\n`))
            }
          )

          // Mark test run as completed
          await supabaseClient
            .from('test_runs')
            .update({
              status: 'completed',
              completed_at: new Date().toISOString()
            })
            .eq('id', testRun.id)

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'complete',
            testType: 'load',
            message: 'Load test execution completed'
          })}\n\n`))
        } catch (error) {
          console.error('Error during load test execution:', error)
          
          await supabaseClient
            .from('test_runs')
            .update({
              status: 'failed',
              error_message: error.message,
              completed_at: new Date().toISOString()
            })
            .eq('id', testRun.id)

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            error: error.message
          })}\n\n`))
        } finally {
          controller.close()
        }
      }
    })

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })

  } catch (error) {
    console.error('Error in execute-load-test function:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        }, 
        status: 500 
      }
    )
  }
})

// Execute local load tests using concurrent HTTP requests
async function executeLoadTests(
  supabaseClient: any,
  testRunId: string,
  testCases: any[],
  environmentUrl: string,
  loadTestConfig: any,
  onProgress: (update: any) => void
) {
  let passedTests = 0;
  let failedTests = 0;

  for (const testCase of testCases) {
    const startTime = Date.now();
    
    try {
      onProgress({
        type: 'load_test_start',
        testCaseId: testCase.id,
        testName: testCase.name,
        message: `Starting load test: ${testCase.name}`
      });

      // Validate test case configuration
      if (!testCase.jmeter_config || !testCase.jmeter_config.endpoints) {
        throw new Error('Test case missing jmeter_config or endpoints');
      }

      // Merge test case config with global config
      const testConfig = {
        threads: 10,
        rampUp: 60,
        duration: 300,
        ...testCase.jmeter_config,
        ...loadTestConfig,
        testName: testCase.name,
        endpoints: testCase.jmeter_config.endpoints.map((endpoint: any) => ({
          ...endpoint,
          url: endpoint.url.startsWith('http') ? endpoint.url : `${environmentUrl}${endpoint.url}`
        }))
      };

      // Execute the load test
      const metrics = await runLocalLoadTest(testConfig, onProgress, testCase.id);
      const executionTime = Date.now() - startTime;

      // Determine if test passed based on error rate
      const testPassed = metrics.error_rate < 5; // Consider test failed if error rate > 5%
      
      if (testPassed) {
        passedTests++;
      } else {
        failedTests++;
      }

      // Store results in Supabase
      const { error } = await supabaseClient
        .from('test_results')
        .insert({
          test_run_id: testRunId,
          test_case_id: testCase.id,
          status: testPassed ? 'pass' : 'fail',
          duration_seconds: Math.round(executionTime / 1000),
          load_test_metrics: metrics,
          executed_at: new Date().toISOString(),
          logs: `Load test completed with ${metrics.total_requests} requests, ${metrics.error_rate.toFixed(2)}% error rate`
        });

      if (error) {
        console.error('Failed to store test result:', error);
      }

      // Update test run progress
      await supabaseClient
        .from('test_runs')
        .update({
          passed_tests: passedTests,
          failed_tests: failedTests,
        })
        .eq('id', testRunId);

      onProgress({
        type: 'load_test_complete',
        testCaseId: testCase.id,
        metrics,
        status: testPassed ? 'pass' : 'fail',
        executionTime,
        message: `Load test completed: ${testPassed ? 'PASSED' : 'FAILED'} - ${metrics.requests_per_second.toFixed(2)} RPS, ${metrics.error_rate.toFixed(2)}% errors`
      });

    } catch (error) {
      console.error(`Load test ${testCase.id} failed:`, error);
      failedTests++;
      
      // Store failed result
      await supabaseClient
        .from('test_results')
        .insert({
          test_run_id: testRunId,
          test_case_id: testCase.id,
          status: 'fail',
          duration_seconds: Math.round((Date.now() - startTime) / 1000),
          error_message: error.message,
          executed_at: new Date().toISOString(),
          logs: `Load test failed: ${error.message}`
        });

      // Update test run progress
      await supabaseClient
        .from('test_runs')
        .update({
          passed_tests: passedTests,
          failed_tests: failedTests,
        })
        .eq('id', testRunId);

      onProgress({
        type: 'load_test_error',
        testCaseId: testCase.id,
        error: error.message,
        message: `Load test failed: ${error.message}`
      });
    }
  }

  // Final summary
  onProgress({
    type: 'load_test_summary',
    message: `Load test execution completed: ${passedTests} passed, ${failedTests} failed`,
    totalTests: testCases.length,
    passedTests,
    failedTests
  });
}

// Run local load test using concurrent HTTP requests
async function runLocalLoadTest(
  config: any, 
  onProgress: (update: any) => void, 
  testCaseId: string
): Promise<any> {
  const {
    threads = 10,
    rampUp = 60,
    duration = 300,
    endpoints = []
  } = config;

  if (endpoints.length === 0) {
    throw new Error('No endpoints configured for load test');
  }

  const results: Array<{
    timestamp: number;
    responseTime: number;
    success: boolean;
    statusCode?: number;
    error?: string;
    endpoint: string;
  }> = [];

  const startTime = Date.now();
  const endTime = startTime + (duration * 1000);
  const rampUpInterval = (rampUp * 1000) / threads;

  let activeThreads = 0;
  let completedRequests = 0;
  let errorCount = 0;

  // Progress tracking
  let lastProgressUpdate = Date.now();
  const progressInterval = 5000; // Update every 5 seconds

  const workers: Promise<void>[] = [];

  // Start threads gradually during ramp-up
  for (let i = 0; i < threads; i++) {
    const threadDelay = i * rampUpInterval;
    
    const worker = (async () => {
      // Wait for ramp-up delay
      if (threadDelay > 0) {
        await new Promise(r => setTimeout(r, threadDelay));
      }

      activeThreads++;
      
      // Keep making requests until duration is reached
      while (Date.now() < endTime) {
        for (const endpoint of endpoints) {
          if (Date.now() >= endTime) break;

          const requestStart = Date.now();
          
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

            const response = await fetch(endpoint.url, {
              method: endpoint.method || 'GET',
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'QA-Autopilot-LoadTest/1.0',
                ...endpoint.headers
              },
              body: endpoint.body ? JSON.stringify(endpoint.body) : undefined,
              signal: controller.signal
            });

            clearTimeout(timeoutId);
            const responseTime = Date.now() - requestStart;
            const success = response.ok;

            results.push({
              timestamp: requestStart,
              responseTime,
              success,
              statusCode: response.status,
              endpoint: endpoint.url
            });

            completedRequests++;
            if (!success) errorCount++;

          } catch (error) {
            const responseTime = Date.now() - requestStart;
            
            results.push({
              timestamp: requestStart,
              responseTime,
              success: false,
              error: error.message,
              endpoint: endpoint.url
            });

            completedRequests++;
            errorCount++;
          }

          // Update progress periodically
          if (Date.now() - lastProgressUpdate > progressInterval) {
            const elapsed = (Date.now() - startTime) / 1000;
            const progress = Math.min((elapsed / duration) * 100, 100);
            
            onProgress({
              type: 'load_test_progress',
              testCaseId,
              progress: Math.round(progress),
              activeThreads,
              completedRequests,
              errorCount,
              message: `Progress: ${Math.round(progress)}% - ${completedRequests} requests, ${errorCount} errors`
            });
            
            lastProgressUpdate = Date.now();
          }

          // Small delay between requests in same thread to avoid overwhelming
          await new Promise(r => setTimeout(r, 100));
        }
      }

      activeThreads--;
    })();

    workers.push(worker);
  }

  // Wait for all workers to complete
  await Promise.all(workers);

  // Calculate final metrics
  return calculateMetrics(results, duration, threads);
}

function calculateMetrics(results: any[], duration: number, vusers: number): any {
  if (results.length === 0) {
    return {
      requests_per_second: 0,
      avg_response_time: 0,
      error_rate: 100,
      throughput: 0,
      percentile_90: 0,
      percentile_95: 0,
      percentile_99: 0,
      total_requests: 0,
      failed_requests: 0,
      duration,
      vusers,
      error_details: []
    };
  }

  const totalRequests = results.length;
  const failedRequests = results.filter(r => !r.success).length;
  const successfulRequests = totalRequests - failedRequests;
  
  // Response times for successful requests
  const responseTimes = results
    .filter(r => r.success)
    .map(r => r.responseTime)
    .sort((a, b) => a - b);

  // Calculate percentiles
  const getPercentile = (arr: number[], percentile: number) => {
    if (arr.length === 0) return 0;
    const index = Math.ceil((percentile / 100) * arr.length) - 1;
    return arr[Math.max(0, index)] || 0;
  };

  const avgResponseTime = responseTimes.length > 0 
    ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length 
    : 0;

  const errorRate = (failedRequests / totalRequests) * 100;
  const requestsPerSecond = totalRequests / duration;
  
  // Group errors by type
  const errorDetails = results
    .filter(r => !r.success)
    .reduce((acc, r) => {
      const errorType = r.statusCode ? `HTTP ${r.statusCode}` : r.error || 'Unknown Error';
      acc[errorType] = (acc[errorType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

  return {
    requests_per_second: requestsPerSecond,
    avg_response_time: avgResponseTime,
    error_rate: errorRate,
    throughput: successfulRequests / duration, // Successful requests per second
    percentile_90: getPercentile(responseTimes, 90),
    percentile_95: getPercentile(responseTimes, 95),
    percentile_99: getPercentile(responseTimes, 99),
    total_requests: totalRequests,
    failed_requests: failedRequests,
    duration,
    vusers,
    error_details: Object.entries(errorDetails).map(([type, count]) => ({
      type,
      count
    }))
  };
}

// Get environment URL from project settings
function getEnvironmentUrl(project: any, environment: string): string | null {
  const urls = {
    local: project.settings?.local_url || 'http://localhost:3000',
    staging: project.settings?.staging_url,
    production: project.settings?.production_url,
  };
  
  return urls[environment as keyof typeof urls] || null;
}