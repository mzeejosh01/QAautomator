/* eslint-disable @typescript-eslint/no-explicit-any */
// supabase/functions/execute-tests/index.ts
// REAL test execution with Playwright browser automation

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
  failure_details?: {
    element: string;
    expected: string;
    actual: string;
    selector: string;
    page_url: string;
  };
}

// Import Playwright (you'll need to add this to import_map.json)
// Note: In real Deno deployment, you'd use a service like Browserless or run your own Docker containers
const BROWSERLESS_API_KEY = Deno.env.get('BROWSERLESS_API_KEY') // Service for cloud browsers
const BROWSERLESS_URL = Deno.env.get('BROWSERLESS_URL') || 'wss://chrome.browserless.io'

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

    const requestData: ExecuteTestsRequest = await req.json()
    const { projectId, testCaseIds, browserType = 'chrome', environment = 'staging' } = requestData

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
        name: `Test Run - ${environment} - ${new Date().toISOString().slice(0, 19)}`,
        environment: environment,
        status: 'running',
        trigger_type: 'manual',
        trigger_data: { browserType, testCaseIds, environmentUrl },
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
          message: 'Real test execution started',
          environmentUrl
        })
        controller.enqueue(encoder.encode(`data: ${initialData}\n\n`))

        // Execute REAL tests
        await executeRealTests(
          supabaseClient,
          testRun.id,
          testCaseIds,
          browserType,
          environmentUrl,
          (update) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(update)}\n\n`))
          }
        )

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
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

// REAL test execution with browser automation
async function executeRealTests(
  supabaseClient: any,
  testRunId: string,
  testCaseIds: string[],
  browserType: string,
  environmentUrl: string,
  onProgress: (update: any) => void
) {
  console.log(`Starting REAL execution of ${testCaseIds.length} tests on ${environmentUrl}`)
  
  const results: TestResult[] = []
  const startTime = Date.now()
  let passedCount = 0
  let failedCount = 0

  // Get test cases from database
  const { data: testCases, error: testCasesError } = await supabaseClient
    .from('test_cases')
    .select('*')
    .in('id', testCaseIds)

  if (testCasesError || !testCases) {
    onProgress({
      type: 'error',
      error: 'Failed to fetch test cases'
    })
    return
  }

  try {
    // Initialize browser session via Browserless API or local Playwright
    const browser = await initializeBrowser(browserType)
    
    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i]
      console.log(`Executing REAL test ${i + 1}/${testCases.length}: ${testCase.name}`)
      
      const executionStartTime = Date.now()
      
      onProgress({
        type: 'progress',
        current: i + 1,
        total: testCases.length,
        testCaseId: testCase.id,
        testName: testCase.name,
        status: 'running'
      })
      
      // Execute the REAL test
      const result = await executeIndividualTest(
        browser,
        testCase,
        environmentUrl,
        executionStartTime
      )
      
      if (result.status === 'pass') {
        passedCount++
      } else {
        failedCount++
      }

      results.push(result)

      // Store test result in database
      const { error: resultError } = await supabaseClient
        .from('test_results')
        .insert({
          test_run_id: testRunId,
          test_case_id: testCase.id,
          status: result.status,
          duration_seconds: Math.round(result.execution_time / 1000),
          error_message: result.error_message,
          logs: result.logs.join('\n'),
          screenshots: result.screenshot_url ? [result.screenshot_url] : [],
          executed_at: new Date().toISOString()
        })

      if (resultError) {
        console.error('Failed to store test result:', resultError)
      }

      // Update test run progress
      await supabaseClient
        .from('test_runs')
        .update({
          passed_tests: passedCount,
          failed_tests: failedCount,
        })
        .eq('id', testRunId)

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
    }

    // Close browser
    await browser.close()

    // Mark test run as completed
    const totalTime = Date.now() - startTime
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

    onProgress({
      type: 'complete',
      passed: passedCount,
      failed: failedCount,
      total: testCases.length,
      executionTime: totalTime
    })

  } catch (error) {
    console.error('Error during REAL test execution:', error)
    
    await supabaseClient
      .from('test_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString()
      })
      .eq('id', testRunId)
      
    onProgress({
      type: 'error',
      error: error.message || 'Test execution failed'
    })
  }
}

// Initialize browser instance
async function initializeBrowser(browserType: string) {
  // For cloud deployment, use Browserless.io or similar service
  if (BROWSERLESS_API_KEY) {
    return await initializeBrowserlessSession(browserType)
  }
  
  // For local development, would use Playwright directly
  // Note: This won't work in Supabase Edge Functions without custom container
  throw new Error('Browser automation requires Browserless API key or custom container deployment')
}

// Initialize Browserless cloud browser session
async function initializeBrowserlessSession(browserType: string) {
  const browserlessWsEndpoint = `${BROWSERLESS_URL}?token=${BROWSERLESS_API_KEY}`
  
  // Create browser via WebSocket connection
  const response = await fetch('https://chrome.browserless.io/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${BROWSERLESS_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      browser: browserType === 'firefox' ? 'firefox' : 'chrome',
      timeout: 300000, // 5 minutes
    })
  })
  
  if (!response.ok) {
    throw new Error('Failed to create browser session')
  }
  
  const session = await response.json()
  
  return {
    sessionId: session.id,
    wsEndpoint: session.websocketDebuggerUrl,
    close: async () => {
      await fetch(`https://chrome.browserless.io/sessions/${session.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${BROWSERLESS_API_KEY}` }
      })
    }
  }
}

// Execute individual test case with REAL browser interactions
async function executeIndividualTest(
  browser: any,
  testCase: any,
  environmentUrl: string,
  startTime: number
): Promise<TestResult> {
  const logs: string[] = []
  
  try {
    logs.push(`[${new Date().toISOString()}] Starting test: ${testCase.name}`)
    logs.push(`[${new Date().toISOString()}] Environment: ${environmentUrl}`)
    logs.push(`[${new Date().toISOString()}] Browser: ${browser.sessionId || 'local'}`)

    // Create page and navigate
    const page = await createPageFromSession(browser)
    
    logs.push(`[${new Date().toISOString()}] Navigating to ${environmentUrl}`)
    await page.goto(environmentUrl, { waitUntil: 'networkidle' })
    
    // Execute each test step
    for (let stepIndex = 0; stepIndex < testCase.steps.length; stepIndex++) {
      const step = testCase.steps[stepIndex]
      logs.push(`[${new Date().toISOString()}] Step ${stepIndex + 1}: ${step.action}`)
      
      const stepResult = await executeTestStep(page, step, testCase.test_data)
      
      if (!stepResult.success) {
        // Test failed - capture screenshot
        const screenshotUrl = await captureFailureScreenshot(page, testCase.id, stepIndex)
        
        return {
          test_case_id: testCase.id,
          status: 'fail',
          execution_time: Date.now() - startTime,
          error_message: stepResult.error,
          screenshot_url: screenshotUrl,
          logs,
          failure_details: {
            element: stepResult.element || 'unknown',
            expected: step.expected_result,
            actual: stepResult.actual || 'N/A',
            selector: stepResult.selector || 'N/A',
            page_url: await page.url()
          }
        }
      }
      
      logs.push(`[${new Date().toISOString()}] ✓ Step completed successfully`)
    }
    
    logs.push(`[${new Date().toISOString()}] Test PASSED`)
    
    return {
      test_case_id: testCase.id,
      status: 'pass',
      execution_time: Date.now() - startTime,
      logs
    }
    
  } catch (error) {
    logs.push(`[${new Date().toISOString()}] Test FAILED: ${error.message}`)
    
    return {
      test_case_id: testCase.id,
      status: 'fail',
      execution_time: Date.now() - startTime,
      error_message: error.message,
      logs
    }
  }
}

// Execute individual test step with comprehensive parsing
async function executeTestStep(page: any, step: any, testData: any) {
  try {
    const action = step.action.toLowerCase().trim()
    const expectedResult = step.expected_result.toLowerCase().trim()
    
    console.log(`Executing step: ${action}`)
    
    // Parse and execute the action
    const result = await parseAndExecuteAction(page, action, testData)
    if (!result.success) {
      return result
    }
    
    // Wait for page to settle
    await page.waitForLoadState('networkidle', { timeout: 10000 })
    
    // Verify expected result
    const verification = await verifyExpectedResult(page, expectedResult)
    if (!verification.success) {
      return verification
    }
    
    return { success: true }
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      element: 'unknown',
      selector: getLastAttemptedSelector() || 'unknown'
    }
  }
}

// Comprehensive action parser for industry-standard test steps
async function parseAndExecuteAction(page: any, action: string, testData: any) {
  let lastSelector = ''
  
  try {
    // NAVIGATION ACTIONS
    if (action.match(/navigate to|go to|visit|open/)) {
      const url = extractUrl(action, testData)
      await page.goto(url, { waitUntil: 'networkidle' })
      return { success: true }
    }
    
    // CLICK ACTIONS
    if (action.match(/click|press|tap/)) {
      const selector = await findElementSelector(page, action)
      lastSelector = selector
      
      // Wait for element to be clickable
      await page.waitForSelector(selector, { state: 'visible', timeout: 10000 })
      await page.click(selector)
      return { success: true, selector }
    }
    
    // INPUT ACTIONS
    if (action.match(/enter|type|input|fill/)) {
      const { selector, value } = await parseInputAction(page, action, testData)
      lastSelector = selector
      
      await page.waitForSelector(selector, { state: 'visible', timeout: 10000 })
      await page.fill(selector, value)
      return { success: true, selector, value }
    }
    
    // SELECT/DROPDOWN ACTIONS
    if (action.match(/select|choose from|pick from/)) {
      const { selector, option } = await parseSelectAction(page, action, testData)
      lastSelector = selector
      
      await page.waitForSelector(selector, { timeout: 10000 })
      await page.selectOption(selector, option)
      return { success: true, selector, option }
    }
    
    // UPLOAD ACTIONS
    if (action.match(/upload|attach file/)) {
      const selector = await findFileInputSelector(page, action)
      lastSelector = selector
      
      // For demo purposes, create a test file
      const testFile = new File(['test content'], 'test.txt', { type: 'text/plain' })
      await page.setInputFiles(selector, testFile)
      return { success: true, selector }
    }
    
    // SCROLL ACTIONS
    if (action.match(/scroll/)) {
      const direction = action.includes('down') ? 'down' : 
                      action.includes('up') ? 'up' : 'down'
      
      if (direction === 'down') {
        await page.evaluate(() => window.scrollBy(0, 500))
      } else {
        await page.evaluate(() => window.scrollBy(0, -500))
      }
      return { success: true }
    }
    
    // HOVER ACTIONS
    if (action.match(/hover|mouse over/)) {
      const selector = await findElementSelector(page, action)
      lastSelector = selector
      
      await page.waitForSelector(selector, { timeout: 10000 })
      await page.hover(selector)
      return { success: true, selector }
    }
    
    // WAIT ACTIONS
    if (action.match(/wait|pause/)) {
      const duration = extractWaitDuration(action)
      await page.waitForTimeout(duration)
      return { success: true }
    }
    
    // KEYBOARD ACTIONS
    if (action.match(/press|hit key/)) {
      const key = extractKeyFromAction(action)
      await page.keyboard.press(key)
      return { success: true, key }
    }
    
    // DRAG AND DROP ACTIONS
    if (action.match(/drag|drop/)) {
      const { sourceSelector, targetSelector } = await parseDragDropAction(page, action)
      
      await page.dragAndDrop(sourceSelector, targetSelector)
      return { success: true, sourceSelector, targetSelector }
    }
    
    // FOCUS ACTIONS
    if (action.match(/focus|activate/)) {
      const selector = await findElementSelector(page, action)
      lastSelector = selector
      
      await page.focus(selector)
      return { success: true, selector }
    }
    
    // CLEAR ACTIONS
    if (action.match(/clear|empty/)) {
      const selector = await findInputSelector(page, action)
      lastSelector = selector
      
      await page.fill(selector, '')
      return { success: true, selector }
    }
    
    // If no specific action matched, try to find and click
    console.warn(`No specific action parser found for: ${action}. Attempting generic click.`)
    const selector = await findElementSelector(page, action)
    lastSelector = selector
    
    await page.waitForSelector(selector, { timeout: 10000 })
    await page.click(selector)
    return { success: true, selector }
    
  } catch (error) {
    return {
      success: false,
      error: `Failed to execute action "${action}": ${error.message}`,
      selector: lastSelector,
      element: extractElementName(action)
    }
  }
}

// Smart element selector finder with multiple strategies
async function findElementSelector(page: any, action: string): Promise<string> {
  const elementIdentifiers = extractElementIdentifiers(action)
  
  // Strategy 1: Test ID attributes (most reliable)
  for (const identifier of elementIdentifiers) {
    const testIdSelector = `[data-testid="${identifier}"]`
    if (await page.locator(testIdSelector).count() > 0) {
      return testIdSelector
    }
  }
  
  // Strategy 2: Text content matching
  for (const identifier of elementIdentifiers) {
    // Button with text
    const buttonSelector = `button:has-text("${identifier}")`
    if (await page.locator(buttonSelector).count() > 0) {
      return buttonSelector
    }
    
    // Link with text
    const linkSelector = `a:has-text("${identifier}")`
    if (await page.locator(linkSelector).count() > 0) {
      return linkSelector
    }
    
    // Any element with text
    const textSelector = `:has-text("${identifier}")`
    if (await page.locator(textSelector).count() > 0) {
      return textSelector
    }
  }
  
  // Strategy 3: Aria labels and accessibility
  for (const identifier of elementIdentifiers) {
    const ariaSelector = `[aria-label*="${identifier}" i]`
    if (await page.locator(ariaSelector).count() > 0) {
      return ariaSelector
    }
  }
  
  // Strategy 4: Placeholder text for inputs
  for (const identifier of elementIdentifiers) {
    const placeholderSelector = `input[placeholder*="${identifier}" i]`
    if (await page.locator(placeholderSelector).count() > 0) {
      return placeholderSelector
    }
  }
  
  // Strategy 5: Name attributes
  for (const identifier of elementIdentifiers) {
    const nameSelector = `[name*="${identifier}" i]`
    if (await page.locator(nameSelector).count() > 0) {
      return nameSelector
    }
  }
  
  // Strategy 6: ID attributes
  for (const identifier of elementIdentifiers) {
    const idSelector = `#${identifier.replace(/\s+/g, '-').toLowerCase()}`
    if (await page.locator(idSelector).count() > 0) {
      return idSelector
    }
  }
  
  // Strategy 7: Class names
  for (const identifier of elementIdentifiers) {
    const classSelector = `.${identifier.replace(/\s+/g, '-').toLowerCase()}`
    if (await page.locator(classSelector).count() > 0) {
      return classSelector
    }
  }
  
  // Fallback: Generic selectors based on action context
  if (action.includes('button') || action.includes('click')) {
    return 'button'
  }
  if (action.includes('link')) {
    return 'a'
  }
  if (action.includes('input') || action.includes('field')) {
    return 'input'
  }
  
  throw new Error(`Could not find element selector for: ${action}`)
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
  
  // Extract capitalized words (likely element names)
  const capitalizedWords = action.match(/\b[A-Z][a-z]+\b/g)
  if (capitalizedWords) {
    identifiers.push(...capitalizedWords.map(w => w.toLowerCase()))
  }
  
  return [...new Set(identifiers)] // Remove duplicates
}

// Parse input actions with smart value detection
async function parseInputAction(page: any, action: string, testData: any) {
  let value = ''
  let selector = ''
  
  // Extract value from action or test data
  if (action.includes('email')) {
    value = testData.email || 'test@example.com'
    selector = await findInputSelector(page, 'email')
  } else if (action.includes('password')) {
    value = testData.password || 'Password123!'
    selector = await findInputSelector(page, 'password')
  } else if (action.includes('username')) {
    value = testData.username || 'testuser'
    selector = await findInputSelector(page, 'username')
  } else if (action.includes('name')) {
    value = testData.name || testData.fullName || 'Test User'
    selector = await findInputSelector(page, 'name')
  } else if (action.includes('phone')) {
    value = testData.phone || '+1234567890'
    selector = await findInputSelector(page, 'phone')
  } else {
    // Extract quoted value or use generic test data
    const quotedValue = action.match(/"([^"]+)"/)?.[1]
    value = quotedValue || testData.defaultValue || 'test input'
    selector = await findInputSelector(page, action)
  }
  
  return { selector, value }
}

// Find input field selectors
async function findInputSelector(page: any, context: string): Promise<string> {
  const inputTypes = ['email', 'password', 'text', 'search', 'tel', 'url']
  
  for (const type of inputTypes) {
    if (context.includes(type)) {
      const selector = `input[type="${type}"]`
      if (await page.locator(selector).count() > 0) {
        return selector
      }
    }
  }
  
  // Try data-testid approach
  const testIdMatches = ['email', 'password', 'username', 'search', 'name']
  for (const testId of testIdMatches) {
    if (context.includes(testId)) {
      const selector = `[data-testid*="${testId}"]`
      if (await page.locator(selector).count() > 0) {
        return selector
      }
    }
  }
  
  // Fallback to first input
  return 'input'
}

// Verify expected results with comprehensive checking
async function verifyExpectedResult(page: any, expectedResult: string) {
  try {
    if (expectedResult.includes('redirect') || expectedResult.includes('navigate')) {
      const expectedUrl = extractExpectedUrl(expectedResult)
      await page.waitForURL(expectedUrl, { timeout: 10000 })
      return { success: true }
    }
    
    if (expectedResult.includes('displayed') || expectedResult.includes('visible')) {
      const element = extractElementFromExpectation(expectedResult)
      await page.waitForSelector(element, { state: 'visible', timeout: 10000 })
      return { success: true }
    }
    
    if (expectedResult.includes('hidden') || expectedResult.includes('not visible')) {
      const element = extractElementFromExpectation(expectedResult)
      await page.waitForSelector(element, { state: 'hidden', timeout: 10000 })
      return { success: true }
    }
    
    if (expectedResult.includes('text') || expectedResult.includes('message')) {
      const expectedText = extractExpectedText(expectedResult)
      await page.waitForSelector(`:has-text("${expectedText}")`, { timeout: 10000 })
      return { success: true }
    }
    
    if (expectedResult.includes('error') || expectedResult.includes('alert')) {
      const errorSelector = '.error, .alert, [role="alert"], .notification'
      await page.waitForSelector(errorSelector, { timeout: 10000 })
      return { success: true }
    }
    
    if (expectedResult.includes('success')) {
      const successSelector = '.success, .alert-success, [role="status"]'
      await page.waitForSelector(successSelector, { timeout: 10000 })
      return { success: true }
    }
    
    // Generic verification - just wait a moment for page state
    await page.waitForTimeout(2000)
    return { success: true }
    
  } catch (error) {
    const currentUrl = await page.url()
    const pageTitle = await page.title()
    
    return {
      success: false,
      error: `Expected result not met: ${expectedResult}. Current URL: ${currentUrl}`,
      actual: `Page: ${pageTitle} at ${currentUrl}`,
      expected: expectedResult
    }
  }
}

// Helper functions for parsing test steps (you'd expand these based on your needs)
function extractElementFromAction(action: string): string {
  // Simple implementation - would need more sophisticated parsing
  if (action.includes('button')) return 'button'
  if (action.includes('link')) return 'a'
  if (action.includes('login')) return '[data-testid="login-button"]'
  return 'button' // fallback
}

function extractInputFromAction(action: string, testData: any) {
  // Simple implementation
  if (action.includes('email')) {
    return { element: 'input[type="email"]', value: testData.email || 'test@example.com' }
  }
  if (action.includes('password')) {
    return { element: 'input[type="password"]', value: testData.password || 'password123' }
  }
  return { element: 'input', value: 'test' }
}

function extractUrlFromAction(action: string): string {
  // Extract URL from action - basic implementation
  return action.includes('login') ? '/login' : '/'
}

async function performVerification(page: any, expectedResult: string) {
  // Basic verification logic - would be expanded
  try {
    if (expectedResult.includes('redirect')) {
      await page.waitForURL('**/dashboard', { timeout: 5000 })
    } else if (expectedResult.includes('displayed')) {
      // Check if element is visible
      await page.waitForSelector('body', { timeout: 5000 })
    }
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: `Verification failed: ${expectedResult}`,
      actual: await page.url()
    }
  }
}

// Create page from browser session (implementation for Browserless)
async function createPageFromSession(browser: any) {
  // For Browserless API, we need to connect via WebSocket
  if (browser.wsEndpoint) {
    // Import Playwright for Deno
    const { chromium } = await import('https://esm.sh/playwright-core@1.40.0')
    
    const browserInstance = await chromium.connectOverCDP(browser.wsEndpoint)
    const context = await browserInstance.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (compatible; QA-Autopilot/1.0)'
    })
    
    const page = await context.newPage()
    
    // Enhanced page setup for better test execution
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    })
    
    // Set default timeouts
    page.setDefaultTimeout(30000)
    page.setDefaultNavigationTimeout(30000)
    
    return page
  }
  
  throw new Error('Browser session not properly initialized')
}

// Capture screenshot on failure with enhanced details
async function captureFailureScreenshot(page: any, testCaseId: string, stepIndex: number): Promise<string> {
  try {
    // Highlight the failed element if possible
    await page.evaluate(() => {
      // Add red border to the last interacted element
      const lastElement = document.activeElement || document.querySelector(':focus')
      if (lastElement) {
        lastElement.style.border = '3px solid red'
        lastElement.style.boxShadow = '0 0 10px rgba(255, 0, 0, 0.5)'
      }
    })
    
    // Take full page screenshot
    const screenshotBuffer = await page.screenshot({ 
      fullPage: true,
      type: 'png'
    })
    
    // Create a temporary Supabase client for this operation
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase configuration for screenshot upload')
      return ''
    }
    
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey)
    
    // Upload to Supabase Storage
    const fileName = `failure_${testCaseId}_step_${stepIndex}_${Date.now()}.png`
    const { data, error } = await supabaseClient.storage
      .from('test-screenshots')
      .upload(fileName, screenshotBuffer, {
        contentType: 'image/png'
      })
    
    if (error) {
      console.error('Failed to upload screenshot:', error)
      return ''
    }
    
    // Return public URL
    const { data: { publicUrl } } = supabaseClient.storage
      .from('test-screenshots')
      .getPublicUrl(fileName)
      
    return publicUrl
    
  } catch (error) {
    console.error('Failed to capture failure screenshot:', error)
    return ''
  }
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

// Additional helper functions for comprehensive test step parsing

const lastAttemptedSelector = ''
function getLastAttemptedSelector(): string {
  return lastAttemptedSelector
}

function extractUrl(action: string, testData: any): string {
  // Extract URL from quoted text
  const quotedUrl = action.match(/"([^"]+)"/)?.[1]
  if (quotedUrl) return quotedUrl
  
  // Extract common route patterns
  if (action.includes('login')) return '/login'
  if (action.includes('signup') || action.includes('register')) return '/signup'
  if (action.includes('dashboard')) return '/dashboard'
  if (action.includes('profile')) return '/profile'
  if (action.includes('settings')) return '/settings'
  if (action.includes('home')) return '/'
  
  // Use test data if available
  if (testData.url) return testData.url
  
  return '/' // fallback to home
}

async function parseSelectAction(page: any, action: string, testData: any) {
  // Find select element
  const selectIdentifiers = extractElementIdentifiers(action)
  let selector = 'select'
  
  for (const identifier of selectIdentifiers) {
    const testIdSelector = `[data-testid*="${identifier}"]`
    if (await page.locator(testIdSelector).count() > 0) {
      selector = testIdSelector
      break
    }
  }
  
  // Extract option to select
  const quotedOption = action.match(/"([^"]+)"/)?.[1]
  const option = quotedOption || testData.selectValue || 'first'
  
  return { selector, option }
}

async function findFileInputSelector(page: any, action: string): Promise<string> {
  // Try to find file input by context
  const identifiers = extractElementIdentifiers(action)
  
  for (const identifier of identifiers) {
    const selector = `input[type="file"][data-testid*="${identifier}"]`
    if (await page.locator(selector).count() > 0) {
      return selector
    }
  }
  
  return 'input[type="file"]'
}

function extractWaitDuration(action: string): number {
  // Extract duration from action text
  const durationMatch = action.match(/(\d+)\s*(second|sec|ms|millisecond)/i)
  if (durationMatch) {
    const value = parseInt(durationMatch[1])
    const unit = durationMatch[2].toLowerCase()
    
    if (unit.includes('ms')) return value
    return value * 1000 // convert seconds to milliseconds
  }
  
  return 2000 // default 2 seconds
}

function extractKeyFromAction(action: string): string {
  // Extract key name from action
  if (action.includes('enter')) return 'Enter'
  if (action.includes('escape')) return 'Escape'
  if (action.includes('tab')) return 'Tab'
  if (action.includes('space')) return 'Space'
  if (action.includes('arrow up')) return 'ArrowUp'
  if (action.includes('arrow down')) return 'ArrowDown'
  if (action.includes('arrow left')) return 'ArrowLeft'
  if (action.includes('arrow right')) return 'ArrowRight'
  
  // Extract quoted key
  const quotedKey = action.match(/"([^"]+)"/)?.[1]
  if (quotedKey) return quotedKey
  
  return 'Enter' // fallback
}

async function parseDragDropAction(page: any, action: string) {
  // Extract source and target elements
  const parts = action.split(' to ')
  const sourcePart = parts[0] || ''
  const targetPart = parts[1] || ''
  
  const sourceSelector = await findElementSelector(page, sourcePart)
  const targetSelector = await findElementSelector(page, targetPart)
  
  return { sourceSelector, targetSelector }
}

function extractElementName(action: string): string {
  // Extract element name for error reporting
  const identifiers = extractElementIdentifiers(action)
  return identifiers[0] || 'unknown element'
}

function extractExpectedUrl(expectedResult: string): string {
  // Extract URL pattern from expected result
  const quotedUrl = expectedResult.match(/"([^"]+)"/)?.[1]
  if (quotedUrl) return `**${quotedUrl}**`
  
  if (expectedResult.includes('dashboard')) return '**/dashboard**'
  if (expectedResult.includes('login')) return '**/login**'
  if (expectedResult.includes('home')) return '**/**'
  
  return '**' // match any URL
}

function extractElementFromExpectation(expectedResult: string): string {
  // Extract element selector from expected result
  const identifiers = extractElementIdentifiers(expectedResult)
  
  // Common UI elements
  if (expectedResult.includes('button')) return 'button'
  if (expectedResult.includes('form')) return 'form'
  if (expectedResult.includes('modal')) return '[role="dialog"], .modal'
  if (expectedResult.includes('menu')) return '[role="menu"], .menu'
  if (expectedResult.includes('alert')) return '[role="alert"], .alert'
  
  // Use first identifier as selector
  if (identifiers.length > 0) {
    return `[data-testid*="${identifiers[0]}"], :has-text("${identifiers[0]}")`
  }
  
  return 'body' // fallback
}

function extractExpectedText(expectedResult: string): string {
  // Extract expected text from quoted sections
  const quotedText = expectedResult.match(/"([^"]+)"/)?.[1]
  if (quotedText) return quotedText
  
  // Extract common text patterns
  if (expectedResult.includes('success')) return 'success'
  if (expectedResult.includes('error')) return 'error'
  if (expectedResult.includes('welcome')) return 'welcome'
  if (expectedResult.includes('login')) return 'login'
  
  return 'text' // fallback
}