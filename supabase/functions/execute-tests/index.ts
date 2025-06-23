/* eslint-disable @typescript-eslint/no-explicit-any */
// supabase/functions/execute-tests/index.ts
// Fixed version with correct table names and data structure

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
}

interface TestResult {
  test_case_id: string;
  status: 'pass' | 'fail' | 'skip';
  execution_time: number;
  error_message?: string;
  screenshot_url?: string;
  logs: string[];
}

serve(async (req) => {
  console.log(`${req.method} ${req.url}`)
  
  if (req.method === 'OPTIONS') {
    console.log('Handling CORS preflight request')
    return new Response(null, { 
      status: 200,
      headers: corsHeaders 
    })
  }

  if (req.method !== 'POST') {
    console.log(`Method ${req.method} not allowed`)
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { 
        status: 405, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }

  try {
    console.log('Processing POST request...')
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing required environment variables')
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Parse request body
    let requestData: ExecuteTestsRequest
    try {
      requestData = await req.json()
    } catch (parseError) {
      console.error('Failed to parse request body:', parseError)
      return new Response(
        JSON.stringify({ error: 'Invalid request body' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    const { 
      projectId,
      testCaseIds,
      browserType = 'chrome', 
      environment = 'staging' 
    } = requestData

    if (!projectId || !testCaseIds || testCaseIds.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: projectId, testCaseIds' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Use service role key for database operations
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey)

    // Get the authenticated user from the request
    const authHeader = req.headers.get('Authorization')
    let userId = null
    
    if (authHeader) {
      try {
        const userClient = createClient(supabaseUrl, supabaseServiceKey)
        const token = authHeader.replace('Bearer ', '')
        const { data: { user } } = await userClient.auth.getUser(token)
        userId = user?.id
      } catch (error) {
        console.error('Failed to get user from token:', error)
      }
    }

    console.log('Creating test run record...')
    
    // Create test run record (using correct table name)
    const { data: testRun, error: testRunError } = await supabaseClient
      .from('test_runs')
      .insert({
        project_id: projectId,
        name: `Manual Test Run - ${new Date().toISOString().slice(0, 19)}`,
        environment: environment,
        status: 'running',
        trigger_type: 'manual',
        trigger_data: {
          browserType,
          testCaseIds
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
        JSON.stringify({ error: 'Failed to create test run record', details: testRunError?.message }), 
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    console.log('Test run record created:', testRun.id)

    // Use Server-Sent Events to keep connection alive while executing tests
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        // Send initial response with test run ID
        const initialData = JSON.stringify({
          success: true,
          testRunId: testRun.id,
          message: 'Test execution started'
        })
        controller.enqueue(encoder.encode(`data: ${initialData}\n\n`))

        // Execute tests with real-time updates
        await executeTests(
          supabaseClient,
          testRun.id,
          testCaseIds,
          browserType,
          environment,
          (update) => {
            // Send progress updates via SSE
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(update)}\n\n`))
          }
        )

        // Close the stream
        controller.close()
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
      JSON.stringify({
        error: error.message || 'Internal server error',
        details: error.toString()
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})

// Execute tests with real-time updates
async function executeTests(
  supabaseClient: any,
  testRunId: string,
  testCaseIds: string[],
  browserType: string,
  environment: string,
  onProgress: (update: any) => void
) {
  console.log(`Starting execution of ${testCaseIds.length} tests...`)
  
  const results: TestResult[] = []
  const startTime = Date.now()
  let passedCount = 0
  let failedCount = 0
  const skippedCount = 0

  try {
    for (let i = 0; i < testCaseIds.length; i++) {
      const testCaseId = testCaseIds[i]
      console.log(`Executing test ${i + 1}/${testCaseIds.length}: ${testCaseId}`)
      
      const executionStartTime = Date.now()
      
      // Send progress update
      onProgress({
        type: 'progress',
        current: i + 1,
        total: testCaseIds.length,
        testCaseId: testCaseId,
        status: 'running'
      })
      
      // Simulate test execution with delay (2-4 seconds per test)
      const executionDelay = Math.random() * 2000 + 2000
      await new Promise(resolve => setTimeout(resolve, executionDelay))
      
      const executionTime = Date.now() - executionStartTime
      
      // Simulate 85% success rate
      const success = Math.random() > 0.15
      
      if (success) {
        passedCount++
      } else {
        failedCount++
      }

      const result: TestResult = {
        test_case_id: testCaseId,
        status: success ? 'pass' : 'fail',
        execution_time: executionTime,
        error_message: success ? undefined : `Simulated test failure: Element not found`,
        logs: [
          `[${new Date().toISOString()}] Starting test case ${testCaseId}`,
          `[${new Date().toISOString()}] Browser: ${browserType}`,
          `[${new Date().toISOString()}] Environment: ${environment}`,
          `[${new Date().toISOString()}] Navigating to application...`,
          `[${new Date().toISOString()}] Executing test steps...`,
          `[${new Date().toISOString()}] Test ${success ? 'PASSED' : 'FAILED'} in ${executionTime}ms`
        ]
      }
      
      results.push(result)

      // Store individual test result (using correct table name and field names)
      const { error: resultError } = await supabaseClient
        .from('test_results')
        .insert({
          test_run_id: testRunId, // Correct field name
          test_case_id: testCaseId,
          status: result.status,
          duration_seconds: Math.round(result.execution_time / 1000), // Convert to seconds
          error_message: result.error_message,
          logs: result.logs.join('\n'), // Store as string
          screenshots: [], // Empty array as required by schema
          executed_at: new Date().toISOString()
        })

      if (resultError) {
        console.error('Failed to store test result:', resultError)
      }

      // Update test run progress in real-time
      const { error: updateError } = await supabaseClient
        .from('test_runs')
        .update({
          passed_tests: passedCount,
          failed_tests: failedCount,
          // Note: no skipped_tests field in the schema, so we don't update it
        })
        .eq('id', testRunId)

      if (updateError) {
        console.error('Failed to update test run progress:', updateError)
      } else {
        console.log(`Progress updated: ${passedCount + failedCount}/${testCaseIds.length} completed`)
        
        // Send detailed progress update
        onProgress({
          type: 'test_complete',
          testCaseId: testCaseId,
          status: result.status,
          passed: passedCount,
          failed: failedCount,
          skipped: skippedCount,
          total: testCaseIds.length
        })
      }
    }

    // Mark test run as completed
    const totalTime = Date.now() - startTime
    const { error: finalUpdateError } = await supabaseClient
      .from('test_runs')
      .update({
        status: 'completed',
        total_tests: testCaseIds.length,
        passed_tests: passedCount,
        failed_tests: failedCount,
        duration_seconds: Math.round(totalTime / 1000), // Convert to seconds
        completed_at: new Date().toISOString()
      })
      .eq('id', testRunId)

    if (finalUpdateError) {
      console.error('Failed to complete test run:', finalUpdateError)
    } else {
      console.log(`Test execution completed: ${passedCount} passed, ${failedCount} failed, total time: ${totalTime}ms`)
      
      // Send completion update
      onProgress({
        type: 'complete',
        passed: passedCount,
        failed: failedCount,
        skipped: skippedCount,
        total: testCaseIds.length,
        executionTime: totalTime
      })
    }

  } catch (error) {
    console.error('Error during test execution:', error)
    
    // Mark test run as failed
    await supabaseClient
      .from('test_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString()
      })
      .eq('id', testRunId)
      
    // Send error update
    onProgress({
      type: 'error',
      error: error.message || 'Test execution failed'
    })
  }
}