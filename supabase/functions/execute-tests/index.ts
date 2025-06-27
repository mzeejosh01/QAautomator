/* eslint-disable @typescript-eslint/no-explicit-any */
// supabase/functions/execute-tests/index.ts
// REAL test execution with LambdaTest browser automation

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
  'Access-Control-Max-Age': '86400',
}
interface ExecuteTestsRequest {
  projectId: string;
  testCaseIds: string[];
  browserType?: 'chrome' | 'firefox' | 'safari';
  environment?: 'local' | 'staging' | 'production';
  testType?: 'functional' | 'load';
}

interface TestResult {
  test_case_id: string;
  status: 'pass' | 'fail' | 'skip';
  execution_time: number;
  error_message?: string;
  screenshot_url?: string;
  logs: string[];
  failure_details?: {
    element: string;
    expected: string;
    actual: string;
    selector: string;
    page_url: string;
  };
  load_test_metrics?: {
    requests_per_second?: number;
    avg_response_time?: number;
    error_rate?: number;
    throughput?: number;
    percentile_90?: number;
    percentile_95?: number;
    percentile_99?: number;
    response_time_over_time?: number[];
    throughput_over_time?: number[];
    error_rate_over_time?: number[];
    error_details?: Array<{
      message: string;
      count: number;
      sample?: any;
    }>;
  };
}

serve(async (req) => {
  console.log(`${req.method} ${req.url}`)
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }}
    )
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const jmeterPath = Deno.env.get('JMETER_PATH') || '/usr/bin/jmeter'

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }}
      )
    }

    const requestData: ExecuteTestsRequest = await req.json()
    const { 
      projectId, 
      testCaseIds, 
      browserType = 'chrome', 
      environment = 'staging',
      testType = 'functional'
    } = requestData

    if (!projectId || !testCaseIds || testCaseIds.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: projectId, testCaseIds' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }}
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
      return new Response(
        JSON.stringify({ error: 'Project not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }}
      )
    }

    // Get test cases to determine test type if not specified
    const { data: testCases, error: testCasesError } = await supabaseClient
      .from('test_cases')
      .select('*')
      .in('id', testCaseIds)

    if (testCasesError || !testCases || testCases.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No test cases found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }}
      )
    }

    // Determine test type from test cases if not specified
    const resolvedTestType = testType || 
      (testCases.some(tc => tc.test_type === 'load') ? 'load' : 'functional')

    // Get environment URL
    const environmentUrl = getEnvironmentUrl(project, environment)
    if (!environmentUrl && resolvedTestType === 'functional') {
      return new Response(
        JSON.stringify({ error: `No URL configured for ${environment} environment` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }}
      )
    }

    // Create test run record
    const { data: testRun, error: testRunError } = await supabaseClient
      .from('test_runs')
      .insert({
        project_id: projectId,
        name: `${resolvedTestType === 'load' ? 'Load' : 'Functional'} Test Run - ${environment} - ${new Date().toISOString().slice(0, 19)}`,
        environment: environment,
        status: 'running',
        test_type: resolvedTestType,
        trigger_type: 'manual',
        trigger_data: { 
          browserType, 
          testCaseIds, 
          environmentUrl,
          testType: resolvedTestType 
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
      return new Response(
        JSON.stringify({ error: 'Failed to create test run record' }), 
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }}
      )
    }

    // Use Server-Sent Events for real-time updates
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const initialData = JSON.stringify({
          success: true,
          testRunId: testRun.id,
          message: 'Test execution started',
          testType: resolvedTestType,
          environmentUrl
        })
        controller.enqueue(encoder.encode(`data: ${initialData}\n\n`))

        try {
          if (resolvedTestType === 'load') {
            // Execute JMeter load tests
            await executeLoadTests(
              supabaseClient,
              testRun.id,
              testCases.filter(tc => tc.test_type === 'load'),
              environmentUrl,
              (update) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(update)}\n\n`))
              }
            )
          } else {
            // Execute functional tests with LambdaTest
            await executeFunctionalTests(
              supabaseClient,
              testRun.id,
              testCases.filter(tc => tc.test_type !== 'load'),
              browserType,
              environmentUrl,
              (update) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(update)}\n\n`))
              }
            )
          }

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
            testType: resolvedTestType,
            message: 'Test execution completed'
          })}\n\n`))
        } catch (error) {
          console.error('Error during test execution:', error)
          
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
    console.error('Error in execute-tests function:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

// BlazeMeter API Client
class BlazeMeterClient {
  private apiKey: string;
  private apiUrl: string;

  constructor(apiKey: string, apiUrl: string = 'https://a.blazemeter.com/api/v4') {
    this.apiKey = apiKey;
    this.apiUrl = apiUrl;
  }

  async createTest(jmxContent: string, testName: string): Promise<string> {
    const response = await fetch(`${this.apiUrl}/tests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify({
        name: testName,
        configuration: {
          type: 'jmeter',
          script: jmxContent,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create test: ${response.statusText}`);
    }

    const data = await response.json();
    return data.result.id;
  }

  async startTest(testId: string): Promise<string> {
    const response = await fetch(`${this.apiUrl}/tests/${testId}/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to start test: ${response.statusText}`);
    }

    const data = await response.json();
    return data.result.sessionId;
  }

  async getTestStatus(sessionId: string): Promise<any> {
    const response = await fetch(`${this.apiUrl}/sessions/${sessionId}`, {
      headers: {
        'x-api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get test status: ${response.statusText}`);
    }

    return await response.json();
  }

  async getTestReport(sessionId: string): Promise<any> {
    const response = await fetch(`${this.apiUrl}/sessions/${sessionId}/reports/master`, {
      headers: {
        'x-api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get test report: ${response.statusText}`);
    }

    return await response.json();
  }

  async stopTest(sessionId: string): Promise<void> {
    await fetch(`${this.apiUrl}/sessions/${sessionId}/stop`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
      },
    });
  }
}

// Execute JMeter load tests
async function executeLoadTests(
  supabaseClient: any,
  testRunId: string,
  testCases: any[],
  environmentUrl: string,
  onProgress: (update: any) => void
) {
  const blazemeterApiKey = Deno.env.get('BLAZEMETER_API_KEY');
  if (!blazemeterApiKey) {
    throw new Error('BlazeMeter API key not configured');
  }

  const blazemeter = new BlazeMeterClient(blazemeterApiKey);

  for (const testCase of testCases) {
    try {
      onProgress({
        type: 'load_test_start',
        testCaseId: testCase.id,
        testName: testCase.name
      });

      // Generate JMX content
      const jmxContent = generateJMXContent({
        ...testCase.jmeter_config,
        endpoints: testCase.jmeter_config.endpoints.map((endpoint: any) => ({
          ...endpoint,
          url: endpoint.url.startsWith('http') ? endpoint.url : `${environmentUrl}${endpoint.url}`
        })),
        testName: testCase.name
      });

      // Create test in BlazeMeter
      const testId = await blazemeter.createTest(jmxContent, testCase.name);
      onProgress({
        type: 'load_test_created',
        testCaseId: testCase.id,
        testId
      });

      // Start the test
      const sessionId = await blazemeter.startTest(testId);
      onProgress({
        type: 'load_test_started',
        testCaseId: testCase.id,
        sessionId
      });

      // Poll for test completion
      let testStatus;
      let lastProgress = 0;
      do {
        await new Promise(resolve => setTimeout(resolve, 10000)); // Check every 10 seconds
        
        testStatus = await blazemeter.getTestStatus(sessionId);
        const progress = testStatus.result.progress || 0;
        
        if (progress > lastProgress) {
          onProgress({
            type: 'load_test_progress',
            testCaseId: testCase.id,
            progress,
            status: testStatus.result.status
          });
          lastProgress = progress;
        }
      } while (testStatus.result.status === 'IN_PROGRESS' || testStatus.result.status === 'STARTING');

      // Get final report
      const report = await blazemeter.getTestReport(sessionId);
      const metrics = extractBlazeMeterMetrics(report);

      // Store results in Supabase
      const { error } = await supabaseClient
        .from('test_results')
        .insert({
          test_run_id: testRunId,
          test_case_id: testCase.id,
          status: metrics.error_rate > 0 ? 'fail' : 'pass',
          duration_seconds: Math.round(metrics.duration / 1000),
          load_test_metrics: metrics,
          executed_at: new Date().toISOString(),
          artifacts: [{
            name: 'blazemeter-report.json',
            type: 'application/json',
            content: JSON.stringify(report),
            encoding: 'utf8'
          }]
        });

      if (error) throw error;

      onProgress({
        type: 'load_test_complete',
        testCaseId: testCase.id,
        metrics,
        status: metrics.error_rate > 0 ? 'fail' : 'pass'
      });

    } catch (error) {
      console.error(`Test case ${testCase.id} failed:`, error);
      onProgress({
        type: 'load_test_error',
        testCaseId: testCase.id,
        error: error.message
      });
    }
  }
}

function extractBlazeMeterMetrics(report: any): any {
  const summary = report.result.summary;
  
  return {
    requests_per_second: summary.rps,
    avg_response_time: summary.avgResponseTime,
    error_rate: summary.errorRate * 100, // Convert to percentage
    throughput: summary.throughput,
    percentile_90: summary.pct90,
    percentile_95: summary.pct95,
    percentile_99: summary.pct99,
    total_requests: summary.total,
    failed_requests: summary.errors,
    duration: summary.testDuration,
    vusers: summary.vusers,
    error_details: Object.entries(summary.errorsByType || {}).map(([type, count]) => ({
      type,
      count
    })),
    report_url: report.result.reportUrl
  };
}

// Generate JMX content from configuration
function generateJMXContent(config: any): string {
  // This is a simplified version - in production you'd use a proper JMX template
  return `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.5">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="${config.testName}" enabled="true">
      <stringProp name="TestPlan.comments">${config.description || 'Generated by QA Autopilot'}</stringProp>
      <boolProp name="TestPlan.functional_mode">false</boolProp>
      <boolProp name="TestPlan.serialize_threadgroups">false</boolProp>
    </TestPlan>
    <hashTree>
      <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="Thread Group" enabled="true">
        <stringProp name="ThreadGroup.on_sample_error">continue</stringProp>
        <elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">
          <boolProp name="LoopController.continue_forever">false</boolProp>
          <intProp name="LoopController.loops">-1</intProp>
        </elementProp>
        <stringProp name="ThreadGroup.num_threads">${config.threads}</stringProp>
        <stringProp name="ThreadGroup.ramp_time">${config.ramp_up}</stringProp>
        <stringProp name="ThreadGroup.duration">${config.duration}</stringProp>
        <stringProp name="ThreadGroup.delay">0</stringProp>
      </ThreadGroup>
      <hashTree>
        ${config.endpoints.map((endpoint: any) => `
        <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="${endpoint.method} ${endpoint.url}" enabled="true">
          <elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
            <collectionProp name="Arguments.arguments">
              ${endpoint.body ? `
              <elementProp name="" elementType="HTTPArgument">
                <boolProp name="HTTPArgument.always_encode">false</boolProp>
                <stringProp name="Argument.value">${endpoint.body}</stringProp>
                <stringProp name="Argument.metadata">=</stringProp>
              </elementProp>
              ` : ''}
            </collectionProp>
          </elementProp>
          <stringProp name="HTTPSampler.domain">${new URL(endpoint.url).hostname}</stringProp>
          <stringProp name="HTTPSampler.port">${new URL(endpoint.url).port || ''}</stringProp>
          <stringProp name="HTTPSampler.protocol">${new URL(endpoint.url).protocol.replace(':', '')}</stringProp>
          <stringProp name="HTTPSampler.path">${new URL(endpoint.url).pathname}</stringProp>
          <stringProp name="HTTPSampler.method">${endpoint.method}</stringProp>
          <stringProp name="HTTPSampler.follow_redirects">true</stringProp>
          <stringProp name="HTTPSampler.auto_redirects">false</stringProp>
          <stringProp name="HTTPSampler.use_keepalive">true</stringProp>
          <stringProp name="HTTPSampler.DO_MULTIPART_POST">false</stringProp>
          <stringProp name="HTTPSampler.connect_timeout">5000</stringProp>
          <stringProp name="HTTPSampler.response_timeout">15000</stringProp>
        </HTTPSamplerProxy>
        <hashTree>
          <HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="HTTP Header Manager" enabled="true">
            <collectionProp name="HeaderManager.headers">
              <elementProp name="" elementType="Header">
                <stringProp name="Header.name">Content-Type</stringProp>
                <stringProp name="Header.value">application/json</stringProp>
              </elementProp>
              ${Object.entries(endpoint.headers || {}).map(([name, value]) => `
              <elementProp name="" elementType="Header">
                <stringProp name="Header.name">${name}</stringProp>
                <stringProp name="Header.value">${value}</stringProp>
              </elementProp>
              `).join('')}
            </collectionProp>
          </HeaderManager>
          <hashTree/>
        </hashTree>
        `).join('')}
        
        <ResultCollector guiclass="ViewResultsFullVisualizer" testclass="ResultCollector" testname="View Results Tree" enabled="false">
          <boolProp name="ResultCollector.error_logging">false</boolProp>
          <objProp>
            <name>saveConfig</name>
            <value class="SampleSaveConfiguration">
              <time>true</time>
              <latency>true</latency>
              <timestamp>true</timestamp>
              <success>true</success>
              <label>true</label>
              <code>true</code>
              <message>true</message>
              <threadName>true</threadName>
              <dataType>true</dataType>
              <encoding>false</encoding>
              <assertions>true</assertions>
              <subresults>true</subresults>
              <responseData>false</responseData>
              <samplerData>false</samplerData>
              <xml>false</xml>
              <fieldNames>true</fieldNames>
              <responseHeaders>false</responseHeaders>
              <requestHeaders>false</requestHeaders>
              <responseDataOnError>false</responseDataOnError>
              <saveAssertionResultsFailureMessage>true</saveAssertionResultsFailureMessage>
              <assertionsResultsToSave>0</assertionsResultsToSave>
              <bytes>true</bytes>
              <sentBytes>true</sentBytes>
              <url>true</url>
              <threadCounts>true</threadCounts>
              <idleTime>true</idleTime>
              <connectTime>true</connectTime>
            </value>
          </objProp>
          <stringProp name="filename">results.jtl</stringProp>
        </ResultCollector>
        <hashTree/>
        
        <Summariser guiclass="SummariserGui" testclass="Summariser" testname="Generate Summary Results" enabled="true"/>
        <hashTree/>
      </hashTree>
    </hashTree>
  </hashTree>
</jmeterTestPlan>`
}

// Parse JMeter results file
async function parseJMeterResults(resultFile: string): Promise<any> {
  try {
    const resultContent = await Deno.readTextFile(resultFile)
    const lines = resultContent.split('\n').filter(line => line.trim() && !line.startsWith('timeStamp'))
    
    if (lines.length === 0) {
      throw new Error('No results in JMeter output file')
    }

    const results = lines.map(line => {
      const [
        timeStamp, elapsed, label, responseCode, responseMessage, 
        threadName, dataType, success, failureMessage, bytes, 
        sentBytes, grpThreads, allThreads, URL, Latency, 
        IdleTime, Connect
      ] = line.split(',')

      return {
        elapsed: parseInt(elapsed),
        responseCode,
        success: success === 'true',
        bytes: parseInt(bytes),
        latency: parseInt(Latency),
        connectTime: parseInt(Connect)
      }
    })

    const totalRequests = results.length
    const failedRequests = results.filter(r => !r.success).length
    const errorRate = (failedRequests / totalRequests) * 100
    const avgResponseTime = results.reduce((sum, r) => sum + r.elapsed, 0) / totalRequests
    const throughput = results.reduce((sum, r) => sum + r.bytes, 0) / 1024 // KB
    const requestsPerSecond = totalRequests / (results[results.length - 1].elapsed / 1000)

    // Calculate percentiles
    const sortedTimes = results.map(r => r.elapsed).sort((a, b) => a - b)
    const percentile90 = sortedTimes[Math.floor(sortedTimes.length * 0.9)]
    const percentile95 = sortedTimes[Math.floor(sortedTimes.length * 0.95)]
    const percentile99 = sortedTimes[Math.floor(sortedTimes.length * 0.99)]

    // Group errors
    const errorDetails = results
      .filter(r => !r.success)
      .reduce((acc: Record<string, {count: number, sample: any}>, r) => {
        const key = r.responseCode
        if (!acc[key]) {
          acc[key] = { count: 0, sample: r }
        }
        acc[key].count++
        return acc
      }, {})

    return {
      requests_per_second: parseFloat(requestsPerSecond.toFixed(2)),
      avg_response_time: parseFloat(avgResponseTime.toFixed(2)),
      error_rate: parseFloat(errorRate.toFixed(2)),
      throughput: parseFloat(throughput.toFixed(2)),
      percentile_90: percentile90,
      percentile_95: percentile95,
      percentile_99: percentile99,
      total_requests: totalRequests,
      failed_requests: failedRequests,
      error_details: Object.entries(errorDetails).map(([code, data]) => ({
        message: code,
        count: data.count,
        sample: data.sample
      }))
    }
  } catch (error) {
    console.error('Failed to parse JMeter results:', error)
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
      error_details: []
    }
  }
}

// Aggregate metrics from multiple load tests
function aggregateLoadTestMetrics(results: any[]): any {
  if (!results || results.length === 0) {
    return {
      requests_per_second: 0,
      avg_response_time: 0,
      error_rate: 0,
      throughput: 0,
      percentile_90: 0,
      percentile_95: 0,
      percentile_99: 0,
      total_requests: 0,
      failed_requests: 0
    }
  }

  const metrics = results
    .map(r => r.load_test_metrics)
    .filter(m => m)

  return {
    requests_per_second: average(metrics, 'requests_per_second'),
    avg_response_time: average(metrics, 'avg_response_time'),
    error_rate: average(metrics, 'error_rate'),
    throughput: average(metrics, 'throughput'),
    percentile_90: average(metrics, 'percentile_90'),
    percentile_95: average(metrics, 'percentile_95'),
    percentile_99: average(metrics, 'percentile_99'),
    total_requests: sum(metrics, 'total_requests'),
    failed_requests: sum(metrics, 'failed_requests')
  }
}

function average(items: any[], key: string): number {
  const values = items.map(i => i[key]).filter(v => v !== undefined)
  if (values.length === 0) return 0
  return parseFloat((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2))
}

function sum(items: any[], key: string): number {
  return items.map(i => i[key] || 0).reduce((a, b) => a + b, 0)
}

// REAL test execution with browser automation
async function executeRealTests(
  supabaseClient: any,
  testRunId: string,
  testCaseIds: string[],
  browserType: string,
  environmentUrl: string,
  onProgress: (update: any) => void
) {
  console.log(`Starting execution of ${testCaseIds.length} tests on ${environmentUrl}`)
  
  const results: TestResult[] = []
  const startTime = Date.now()
  let passedCount = 0
  let failedCount = 0

  // Validate inputs
  if (!testCaseIds.length) {
    onProgress({
      type: 'error',
      error: 'No test cases provided for execution'
    })
    return
  }

  // Get test cases from database
  const { data: testCases, error: testCasesError } = await supabaseClient
    .from('test_cases')
    .select('*')
    .in('id', testCaseIds)

  if (testCasesError || !testCases) {
    onProgress({
      type: 'error',
      error: `Failed to fetch test cases: ${testCasesError?.message || 'Unknown error'}`
    })
    return
  }

  if (testCases.length === 0) {
    onProgress({
      type: 'error',
      error: 'No test cases found with the provided IDs'
    })
    return
  }

  try {
    // Validate LambdaTest configuration
    const lambdaTestUser = Deno.env.get('LAMBDATEST_USERNAME')
    const lambdaTestAccessKey = Deno.env.get('LAMBDATEST_ACCESS_KEY')
    
    if (!lambdaTestUser || !lambdaTestAccessKey) {
      throw new Error('LambdaTest credentials not configured')
    }

    // Execute tests with LambdaTest
    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i]
      console.log(`Executing test ${i + 1}/${testCases.length}: ${testCase.name}`)
      
      const executionStartTime = Date.now()
      
      onProgress({
        type: 'progress',
        current: i + 1,
        total: testCases.length,
        testCaseId: testCase.id,
        testName: testCase.name,
        status: 'running'
      })
      
      let result: TestResult
      
      try {
        // Execute test using LambdaTest
        result = await executeTestWithLambdaTest(
          testCase,
          environmentUrl,
          lambdaTestUser,
          lambdaTestAccessKey,
          browserType,
          executionStartTime
        )
      } catch (error) {
        console.error(`Test execution failed:`, error)
        result = {
          test_case_id: testCase.id,
          status: 'fail',
          execution_time: Date.now() - executionStartTime,
          error_message: `Test failed: ${error.message}`,
          logs: [`Test execution failed: ${error.message}`]
        }
      }
      
      if (result.status === 'pass') {
        passedCount++
      } else {
        failedCount++
      }

      results.push(result)

      // Store test result in database
      try {
        const { error: resultError } = await supabaseClient
          .from('test_results')
          .insert({
            test_run_id: testRunId,
            test_case_id: testCase.id,
            status: result.status,
            duration_seconds: Math.round(result.execution_time / 1000),
            error_message: result.error_message,
            logs: result.logs?.join('\n') || '',
            screenshots: result.screenshot_url ? [result.screenshot_url] : [],
            executed_at: new Date().toISOString()
          })

        if (resultError) {
          console.error('Failed to store test result:', resultError)
        }
      } catch (dbError) {
        console.error('Database operation failed:', dbError)
      }

      // Update test run progress
      try {
        await supabaseClient
          .from('test_runs')
          .update({
            passed_tests: passedCount,
            failed_tests: failedCount,
          })
          .eq('id', testRunId)
      } catch (updateError) {
        console.error('Failed to update test run progress:', updateError)
      }

      onProgress({
        type: 'test_complete',
        testCaseId: testCase.id,
        testName: testCase.name,
        status: result.status,
        error: result.error_message,
        screenshot: result.screenshot_url,
        passed: passedCount,
        failed: failedCount,
        total: testCases.length
      })
      
      // Prevent rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    // Mark test run as completed
    const totalTime = Date.now() - startTime
    
    try {
      await supabaseClient
        .from('test_runs')
        .update({
          status: 'completed',
          total_tests: testCases.length,
          passed_tests: passedCount,
          failed_tests: failedCount,
          duration_seconds: Math.round(totalTime / 1000),
          completed_at: new Date().toISOString()
        })
        .eq('id', testRunId)
    } catch (updateError) {
      console.error('Failed to mark test run as completed:', updateError)
    }

    onProgress({
      type: 'complete',
      passed: passedCount,
      failed: failedCount,
      total: testCases.length,
      executionTime: totalTime
    })

  } catch (error) {
    console.error('Error during test execution:', error)
    
    try {
      await supabaseClient
        .from('test_runs')
        .update({
          status: 'failed',
          error_message: error.message,
          completed_at: new Date().toISOString()
        })
        .eq('id', testRunId)
    } catch (updateError) {
      console.error('Failed to mark test run as failed:', updateError)
    }
      
    onProgress({
      type: 'error',
      error: error.message || 'Test execution failed'
    })
  }
}

// Execute test using LambdaTest
async function executeTestWithLambdaTest(
  testCase: any,
  environmentUrl: string,
  username: string,
  accessKey: string,
  browserType: string,
  startTime: number
): Promise<TestResult> {
  const logs: string[] = []
  
  try {
    logs.push(`[LambdaTest] Starting test: ${testCase.name}`)
    logs.push(`[LambdaTest] Environment: ${environmentUrl}`)
    logs.push(`[LambdaTest] Browser: ${browserType}`)

    // LambdaTest capabilities
    const capabilities = {
      browserName: browserType,
      version: 'latest',
      platform: 'Windows 11',
      build: `Test Run - ${new Date().toISOString()}`,
      name: testCase.name,
      video: true,
      visual: true,
      network: true,
      console: true,
      terminal: true
    }

    // Create WebDriver script for LambdaTest
    const script = generateWebDriverScript(testCase, environmentUrl)
    
    // Execute via LambdaTest API
    const sessionId = await createLambdaTestSession(username, accessKey, capabilities)
    logs.push(`[LambdaTest] Session created: ${sessionId}`)
    
    // Execute test script
    const testResult = await executeLambdaTestScript(
      sessionId,
      script,
      username,
      accessKey,
      testCase,
      environmentUrl
    )
    
    if (testResult.error) {
      logs.push(`[LambdaTest] Test FAILED: ${testResult.error}`)
      
      // Get screenshot from LambdaTest
      const screenshotUrl = await getLambdaTestScreenshot(sessionId, username, accessKey)
      
      return {
        test_case_id: testCase.id,
        status: 'fail',
        execution_time: Date.now() - startTime,
        error_message: testResult.error,
        screenshot_url: screenshotUrl,
        logs,
        failure_details: testResult.failureDetails
      }
    }

    logs.push(`[LambdaTest] Test PASSED`)
    return {
      test_case_id: testCase.id,
      status: 'pass',
      execution_time: Date.now() - startTime,
      logs,
    }

  } catch (error) {
    logs.push(`[LambdaTest] Test FAILED: ${error.message}`)
    
    return {
      test_case_id: testCase.id,
      status: 'fail',
      execution_time: Date.now() - startTime,
      error_message: error.message,
      logs,
    }
  }
}

// Create LambdaTest session
async function createLambdaTestSession(
  username: string,
  accessKey: string,
  capabilities: any
): Promise<string> {
  const response = await fetch(
    `https://${username}:${accessKey}@hub.lambdatest.com/wd/hub/session`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        desiredCapabilities: capabilities,
        capabilities: {
          alwaysMatch: capabilities
        }
      })
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to create LambdaTest session: ${response.statusText}`)
  }

  const data = await response.json()
  return data.sessionId || data.value.sessionId
}

// Execute test script on LambdaTest
async function executeLambdaTestScript(
  sessionId: string,
  script: string,
  username: string,
  accessKey: string,
  testCase: any,
  environmentUrl: string
): Promise<any> {
  // This is a simplified version - in production, you'd use WebDriver commands
  // or LambdaTest's Selenium API to execute the actual test steps
  
  try {
    const baseUrl = `https://${username}:${accessKey}@hub.lambdatest.com/wd/hub/session/${sessionId}`
    
    // Navigate to URL
    await fetch(`${baseUrl}/url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: environmentUrl })
    })
    
    // Execute test steps
    for (const step of testCase.steps) {
      const result = await executeStepOnLambdaTest(
        sessionId,
        username,
        accessKey,
        step,
        testCase.test_data || {}
      )
      
      if (!result.success) {
        return {
          error: result.error,
          failureDetails: result.failureDetails
        }
      }
    }
    
    // Mark test as passed in LambdaTest
    await updateLambdaTestStatus(sessionId, username, accessKey, 'passed')
    
    return { success: true }
    
  } catch (error) {
    // Mark test as failed in LambdaTest
    await updateLambdaTestStatus(sessionId, username, accessKey, 'failed', error.message)
    
    return {
      error: error.message,
      failureDetails: {
        error: error.message,
        page_url: environmentUrl
      }
    }
  } finally {
    // Close session
    await fetch(
      `https://${username}:${accessKey}@hub.lambdatest.com/wd/hub/session/${sessionId}`,
      { method: 'DELETE' }
    )
  }
}

// Execute a single test step on LambdaTest
async function executeStepOnLambdaTest(
  sessionId: string,
  username: string,
  accessKey: string,
  step: any,
  testData: any
): Promise<any> {
  const baseUrl = `https://${username}:${accessKey}@hub.lambdatest.com/wd/hub/session/${sessionId}`
  
  try {
    const action = step.action.toLowerCase()
    
    if (action.includes('click')) {
      const selector = await findElementSelector(action)
      const element = await findElement(baseUrl, selector)
      
      if (!element) {
        return { success: false, error: `Element not found: ${selector}` }
      }
      
      // Click element
      await fetch(`${baseUrl}/element/${element}/click`, {
        method: 'POST'
      })
      
      return { success: true }
    }
    
    if (action.includes('enter') || action.includes('type')) {
      const { selector, value } = parseInputAction(action, testData)
      const element = await findElement(baseUrl, selector)
      
      if (!element) {
        return { success: false, error: `Input element not found: ${selector}` }
      }
      
      // Type into element
      await fetch(`${baseUrl}/element/${element}/value`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: value })
      })
      
      return { success: true }
    }
    
    if (action.includes('navigate')) {
      const url = extractUrl(action)
      await fetch(`${baseUrl}/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url })
      })
      
      return { success: true }
    }
    
    return { success: false, error: `Unknown action: ${action}` }
    
  } catch (error) {
    return { success: false, error: error.message }
  }
}

// Find element using WebDriver API
async function findElement(baseUrl: string, selector: string): Promise<string | null> {
  try {
    const response = await fetch(`${baseUrl}/element`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        using: 'css selector',
        value: selector
      })
    })
    
    if (response.ok) {
      const data = await response.json()
      return data.value.ELEMENT || data.value['element-6066-11e4-a52e-4f735466cecf']
    }
    
    // Try XPath if CSS selector fails
    const xpathResponse = await fetch(`${baseUrl}/element`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        using: 'xpath',
        value: `//*[contains(text(), '${selector}')]`
      })
    })
    
    if (xpathResponse.ok) {
      const data = await xpathResponse.json()
      return data.value.ELEMENT || data.value['element-6066-11e4-a52e-4f735466cecf']
    }
    
    return null
  } catch (error) {
    console.error('Error finding element:', error)
    return null
  }
}

// Get screenshot from LambdaTest
async function getLambdaTestScreenshot(
  sessionId: string,
  username: string,
  accessKey: string
): Promise<string | undefined> {
  try {
    const response = await fetch(
      `https://${username}:${accessKey}@hub.lambdatest.com/wd/hub/session/${sessionId}/screenshot`,
      { method: 'GET' }
    )
    
    if (response.ok) {
      const data = await response.json()
      return `data:image/png;base64,${data.value}`
    }
  } catch (error) {
    console.error('Failed to get screenshot:', error)
  }
  
  return undefined
}

// Update test status in LambdaTest dashboard
async function updateLambdaTestStatus(
  sessionId: string,
  username: string,
  accessKey: string,
  status: 'passed' | 'failed',
  reason?: string
): Promise<void> {
  try {
    await fetch(
      `https://api.lambdatest.com/automation/api/v1/sessions/${sessionId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Basic ${btoa(`${username}:${accessKey}`)}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          status_ind: status === 'passed' ? 'passed' : 'failed',
          ...(reason && { reason })
        })
      }
    )
  } catch (error) {
    console.error('Failed to update LambdaTest status:', error)
  }
}

// Generate WebDriver script for LambdaTest
function generateWebDriverScript(testCase: any, environmentUrl: string): string {
  // This would be more complex in production, but simplified for this example
  return JSON.stringify({
    testCase,
    environmentUrl,
    steps: testCase.steps
  })
}

// Helper functions
function findElementSelector(action: string): string {
  if (action.includes('button')) return 'button'
  if (action.includes('login')) return '[data-testid="login-button"], button:contains("Login"), button[type="submit"]'
  if (action.includes('submit')) return '[type="submit"], button:contains("Submit")'
  if (action.includes('link')) return 'a'
  return 'button'
}

function parseInputAction(action: string, testData: any): { selector: string; value: string } {
  let selector = 'input'
  let value = 'test'
  
  if (action.includes('email')) {
    selector = 'input[type="email"], input[name="email"], #email'
    value = testData.email || 'test@example.com'
  } else if (action.includes('password')) {
    selector = 'input[type="password"], input[name="password"], #password'
    value = testData.password || 'password123'
  } else if (action.includes('username')) {
    selector = 'input[name="username"], #username'
    value = testData.username || 'testuser'
  }
  
  return { selector, value }
}

function extractUrl(action: string): string {
  if (action.includes('login')) return '/login'
  if (action.includes('home')) return '/'
  if (action.includes('dashboard')) return '/dashboard'
  if (action.includes('profile')) return '/profile'
  
  // Try to extract URL from quotes
  const urlMatch = action.match(/["']([^"']+)["']/)
  if (urlMatch) return urlMatch[1]
  
  return '/'
}

// Get environment URL from project settings
function getEnvironmentUrl(project: any, environment: string): string | null {
  const urls = {
    local: 'http://localhost:3000',
    staging: project.settings?.staging_url,
    production: project.settings?.production_url,
  }
  
  return urls[environment as keyof typeof urls] || null
}

// Extract element identifiers from action text
function extractElementIdentifiers(action: string): string[] {
  const identifiers: string[] = []
  
  // Extract quoted text
  const quotedMatches = action.match(/"([^"]+)"/g)
  if (quotedMatches) {
    identifiers.push(...quotedMatches.map(m => m.replace(/"/g, '')))
  }
  
  // Extract common UI element terms
  const uiTerms = [
    'login', 'signin', 'signup', 'register', 'submit', 'save', 'cancel', 'delete',
    'edit', 'add', 'remove', 'search', 'filter', 'sort', 'menu', 'navigation',
    'home', 'profile', 'settings', 'logout', 'dashboard', 'admin'
  ]
  
  for (const term of uiTerms) {
    if (action.includes(term)) {
      identifiers.push(term)
    }
  }
  
  return [...new Set(identifiers)]
}

function extractElementName(action: string): string {
  const identifiers = extractElementIdentifiers(action)
  return identifiers[0] || 'unknown element'
}