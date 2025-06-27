/* eslint-disable @typescript-eslint/no-explicit-any */
// supabase/functions/execute-functional-tests/index.ts
// Functional test execution with LambdaTest browser automation

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
  'Access-Control-Max-Age': '86400',
}

interface ExecuteFunctionalTestsRequest {
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
  failure_details?: {
    element: string;
    expected: string;
    actual: string;
    selector: string;
    page_url: string;
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

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }}
      )
    }

    const requestData: ExecuteFunctionalTestsRequest = await req.json()
    const { 
      projectId, 
      testCaseIds, 
      browserType = 'chrome', 
      environment = 'staging'
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

    // Get test cases
    const { data: testCases, error: testCasesError } = await supabaseClient
      .from('test_cases')
      .select('*')
      .in('id', testCaseIds)
      .neq('test_type', 'load') // Only functional tests

    if (testCasesError || !testCases || testCases.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No functional test cases found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }}
      )
    }

    // Get environment URL
    const environmentUrl = getEnvironmentUrl(project, environment)
    if (!environmentUrl) {
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
        name: `Functional Test Run - ${environment} - ${new Date().toISOString().slice(0, 19)}`,
        environment: environment,
        status: 'running',
        test_type: 'functional',
        trigger_type: 'manual',
        trigger_data: { 
          browserType, 
          testCaseIds, 
          environmentUrl
        },
        started_by: userId,
        started_at: new Date().toISOString(),
        total_tests: testCases.length,
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
          message: 'Functional test execution started',
          environmentUrl,
          browserType
        })
        controller.enqueue(encoder.encode(`data: ${initialData}\n\n`))

        try {
          await executeFunctionalTests(
            supabaseClient,
            testRun.id,
            testCases,
            browserType,
            environmentUrl,
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
            message: 'Functional test execution completed'
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
    console.error('Error in execute-functional-tests function:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

// Execute functional tests with LambdaTest
async function executeFunctionalTests(
  supabaseClient: any,
  testRunId: string,
  testCases: any[],
  browserType: string,
  environmentUrl: string,
  onProgress: (update: any) => void
) {
  console.log(`Starting execution of ${testCases.length} functional tests on ${environmentUrl}`)
  
  const startTime = Date.now()
  let passedCount = 0
  let failedCount = 0

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

  // Final progress update
  const totalTime = Date.now() - startTime
  
  try {
    await supabaseClient
      .from('test_runs')
      .update({
        total_tests: testCases.length,
        passed_tests: passedCount,
        failed_tests: failedCount,
        duration_seconds: Math.round(totalTime / 1000),
      })
      .eq('id', testRunId)
  } catch (updateError) {
    console.error('Failed to update final test run stats:', updateError)
  }

  onProgress({
    type: 'complete',
    passed: passedCount,
    failed: failedCount,
    total: testCases.length,
    executionTime: totalTime
  })
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
      build: `Functional Test Run - ${new Date().toISOString()}`,
      name: testCase.name,
      video: true,
      visual: true,
      network: true,
      console: true,
      terminal: true
    }
    
    // Execute via LambdaTest API
    const sessionId = await createLambdaTestSession(username, accessKey, capabilities)
    logs.push(`[LambdaTest] Session created: ${sessionId}`)
    
    // Execute test script
    const testResult = await executeLambdaTestScript(
      sessionId,
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
  username: string,
  accessKey: string,
  testCase: any,
  environmentUrl: string
): Promise<any> {
  try {
    const baseUrl = `https://${username}:${accessKey}@hub.lambdatest.com/wd/hub/session/${sessionId}`
    
    // Navigate to URL
    await fetch(`${baseUrl}/url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: environmentUrl })
    })
    
    // Execute test steps
    for (const step of testCase.steps || []) {
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
    try {
      await fetch(
        `https://${username}:${accessKey}@hub.lambdatest.com/wd/hub/session/${sessionId}`,
        { method: 'DELETE' }
      )
    } catch (error) {
      console.error('Failed to close LambdaTest session:', error)
    }
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
    const action = step.action?.toLowerCase() || ''
    
    if (action.includes('click')) {
      const selector = findElementSelector(action)
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
      
      // Clear and type into element
      await fetch(`${baseUrl}/element/${element}/clear`, { method: 'POST' })
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
    
    if (action.includes('wait')) {
      const seconds = extractWaitTime(action)
      await new Promise(resolve => setTimeout(resolve, seconds * 1000))
      return { success: true }
    }
    
    return { success: false, error: `Unknown action: ${action}` }
    
  } catch (error) {
    return { 
      success: false, 
      error: error.message,
      failureDetails: {
        element: step.action,
        error: error.message,
        page_url: environmentUrl
      }
    }
  }
}

// Find element using WebDriver API
async function findElement(baseUrl: string, selector: string): Promise<string | null> {
  try {
    // Try CSS selector first
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

function extractWaitTime(action: string): number {
  const timeMatch = action.match(/(\d+)/)
  return timeMatch ? parseInt(timeMatch[1]) : 2
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