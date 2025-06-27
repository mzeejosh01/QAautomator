/* eslint-disable @typescript-eslint/no-explicit-any */
// supabase/functions/generate-functional-tests/index.ts

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import OpenAI from 'https://esm.sh/openai@4'

// CORS configuration
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with, accept, accept-language, cache-control, pragma',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE, PATCH',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Allow-Credentials': 'false',
}

interface FunctionalTestCase {
  test_name: string;
  steps: Array<{
    action: string;
    expected_result: string;
  }>;
  test_data: Record<string, string>;
  priority: 'Low' | 'Medium' | 'High';
  category: string;
  test_type: 'functional';
}

interface GenerateFunctionalTestsRequest {
  projectId: string;
  sourceType: 'description' | 'github_pr' | 'repository_analysis';
  sourceData: {
    description?: string;
    prUrl?: string;
    repositoryStructure?: any;
  };
}

// Define valid action patterns for LambdaTest/Selenium
const VALID_ACTION_PATTERNS = {
  navigate: /^navigate to\s+(?:https?:\/\/)?[^\s]+/i,
  click: /^click\s+(?:the\s+)?[\w\s]+(?: button| link| icon| element)?$/i,
  type: /^(?:type|enter)\s+.+\s+in\s+(?:the\s+)?[\w\s]+(?: field| input| box| textarea)?$/i,
};

const ACTION_FORMAT_GUIDE = `
IMPORTANT: Use ONLY these specific action formats that LambdaTest/Selenium can understand:

1. NAVIGATION: "navigate to [url or path]"
   Examples:
   - "navigate to /login"
   - "navigate to https://example.com"
   - "navigate to /dashboard"

2. CLICKING: "click [element description]"
   Examples:
   - "click login button"
   - "click submit button"
   - "click cancel link"
   - "click menu icon"

3. TEXT INPUT: "type [value] in [field name]" OR "enter [value] in [field name]"
   Examples:
   - "type test@example.com in email field"
   - "enter password123 in password field"
   - "type John Doe in name input"
   - "enter Hello World in message textarea"

DO NOT USE complex actions like:
- "fill in the form" (break it down to individual field entries)
- "complete the registration" (break it down to specific clicks and types)
- "verify the page" (use specific expected results instead)
- "wait for page to load" (this is handled automatically)
`;

// Helper functions
function validateTestCases(testCases: any[]): FunctionalTestCase[] {
  return testCases.map(tc => {
    // Ensure required fields exist
    if (!tc.test_name) tc.test_name = `Test Case ${Math.random().toString(36).substring(7)}`;
    if (!tc.steps || !Array.isArray(tc.steps)) tc.steps = [];
    if (!tc.priority) tc.priority = 'Medium';
    if (!tc.category) tc.category = 'UI';
    if (!tc.test_data) tc.test_data = {};
    
    // Validate and fix steps
    tc.steps = tc.steps.map((step: any) => {
      if (typeof step !== 'object') {
        return {
          action: 'navigate to /',
          expected_result: 'Page loads'
        };
      }
      
      return {
        action: step.action ? fixActionFormat(step.action) : 'navigate to /',
        expected_result: step.expected_result || 'Step completed'
      };
    });
    
    return {
      ...tc,
      test_type: 'functional'
    } as FunctionalTestCase;
  });
}

function fixActionFormat(action: string): string {
  const actionLower = action.toLowerCase();
  
  // Navigation fixes
  if (actionLower.includes('go to') || actionLower.includes('navigate') || 
      actionLower.includes('open') || actionLower.includes('visit')) {
    const urlMatch = action.match(/(https?:\/\/[^\s]+)|(\/[^\s]*)/i);
    const path = urlMatch ? urlMatch[0] : '/';
    return `navigate to ${path}`;
  }
  
  // Click fixes
  if (actionLower.includes('click') || actionLower.includes('press') || 
      actionLower.includes('tap') || actionLower.includes('select')) {
    const element = action.replace(/click|press|tap|select/gi, '').trim();
    return `click ${element}`;
  }
  
  // Input fixes
  if (actionLower.includes('type') || actionLower.includes('enter') || 
      actionLower.includes('input') || actionLower.includes('fill')) {
    const valueMatch = action.match(/"([^"]+)"|'([^']+)'|(\S+)/);
    const fieldMatch = action.match(/(?:in|into|to)\s+([^\s]+)/i);
    
    const value = valueMatch ? (valueMatch[1] || valueMatch[2] || valueMatch[3]) : 'value';
    const field = fieldMatch ? fieldMatch[1] : 'field';
    
    return `type ${value} in ${field}`;
  }
  
  // Default to click action
  return `click ${action}`;
}

async function fetchGitHubPR(prUrl: string, githubToken: string) {
  // Extract owner, repo, and PR number from URL
  const urlMatch = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (!urlMatch) {
    throw new Error('Invalid GitHub PR URL')
  }

  const [, owner, repo, prNumber] = urlMatch

  if (!githubToken) {
    throw new Error('GitHub token is required for PR analysis')
  }

  // Fetch PR data from GitHub API
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
    headers: {
      'Authorization': `token ${githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch GitHub PR data: ${response.status} ${response.statusText}`)
  }

  const prData = await response.json()

  // Fetch changed files
  const filesResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files`, {
    headers: {
      'Authorization': `token ${githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  })

  if (!filesResponse.ok) {
    throw new Error(`Failed to fetch PR files: ${filesResponse.status} ${filesResponse.statusText}`)
  }

  const files = await filesResponse.json()

  // Get file contents for changed files
  const filesWithContent = await Promise.all(
    files.map(async (file: any) => {
      if (file.status === 'modified' || file.status === 'added') {
        try {
          const contentResponse = await fetch(file.contents_url, {
            headers: {
              'Authorization': `token ${githubToken}`,
              'Accept': 'application/vnd.github.v3.raw',
            },
          })
          if (contentResponse.ok) {
            const content = await contentResponse.text()
            return { ...file, content }
          }
        } catch (error) {
          console.warn(`Failed to fetch content for ${file.filename}:`, error)
        }
      }
      return file
    })
  )

  return {
    title: prData.title,
    body: prData.body || '',
    files: filesWithContent,
    changedLines: files.reduce((acc: number, file: any) => acc + file.changes, 0),
    additions: prData.additions,
    deletions: prData.deletions
  }
}

// Main handler
serve(async (req) => {
  console.log(`${req.method} ${req.url}`)
  
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    console.log('Handling CORS preflight request')
    return new Response(null, { 
      status: 200,
      headers: corsHeaders 
    })
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    console.log('Method not allowed:', req.method)
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 405,
      }
    )
  }

  try {
    console.log('Processing functional test generation request...')
    
    // Validate environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')

    if (!supabaseUrl || !supabaseAnonKey || !openaiApiKey) {
      console.error('Missing required environment variables')
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Initialize Supabase client
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization header required' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    })

    // Get user from token
    console.log('Authenticating user...')
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()

    if (userError || !user) {
      console.error('Authentication failed:', userError)
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }), 
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    console.log('User authenticated:', user.id)

    // Parse request body
    let requestData: GenerateFunctionalTestsRequest
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

    const { projectId, sourceType, sourceData } = requestData

    if (!projectId || !sourceType || !sourceData) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: projectId, sourceType, sourceData' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Verify user owns the project
    console.log('Verifying project ownership...')
    const { data: project, error: projectError } = await supabaseClient
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('owner_id', user.id)
      .single()

    if (projectError || !project) {
      console.error('Project verification failed:', projectError)
      return new Response(
        JSON.stringify({ error: 'Project not found or access denied' }), 
        { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    console.log('Project verified:', project.id)

    // Initialize OpenAI
    const openai = new OpenAI({
      apiKey: openaiApiKey,
    })

    let prompt = ''

    // Build prompt based on source type
    switch (sourceType) {
      case 'description':
        if (!sourceData.description) {
          return new Response(
            JSON.stringify({ error: 'Description is required for description source type' }),
            { 
              status: 400, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
          )
        }
        prompt = `Generate comprehensive functional test cases for Selenium/LambdaTest execution based on this feature description:

${sourceData.description}

${ACTION_FORMAT_GUIDE}

Generate test cases that:
1. Cover happy path scenarios for UI interactions
2. Include edge cases and error conditions
3. Verify form validations and user inputs
4. Test navigation flows between pages
5. Include both positive and negative test scenarios
6. Focus on user-facing functionality that can be automated with Selenium

EXAMPLE of a properly formatted functional test case:
{
  "test_name": "Verify user login with valid credentials",
  "steps": [
    {"action": "navigate to /login", "expected_result": "Login page is displayed"},
    {"action": "type john@example.com in email field", "expected_result": "Email field contains john@example.com"},
    {"action": "type password123 in password field", "expected_result": "Password field is filled"},
    {"action": "click login button", "expected_result": "User is redirected to dashboard"},
    {"action": "navigate to /dashboard", "expected_result": "Dashboard page loads with user data"}
  ],
  "test_data": {"email": "john@example.com", "password": "password123"},
  "priority": "High",
  "category": "Authentication"
}

Return ONLY a JSON array of functional test cases. Each action MUST follow the format guide exactly.`
        break
      
      case 'github_pr': {
        if (!sourceData.prUrl) {
          return new Response(
            JSON.stringify({ error: 'PR URL is required for github_pr source type' }),
            { 
              status: 400, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
          )
        }
        try {
          const prData = await fetchGitHubPR(sourceData.prUrl, project.github_token)
          prompt = `Generate functional test cases for Selenium/LambdaTest based on this GitHub Pull Request:

PR Title: ${prData.title}
PR Description: ${prData.body || 'No description provided'}
Changed Files: ${prData.files.map(f => f.filename).join(', ')}

Key Changes:
${prData.files.map(f => `- ${f.filename} (${f.status}): ${f.patch || 'No diff available'}`).join('\n')}

${ACTION_FORMAT_GUIDE}

Generate functional test cases that:
1. Target UI changes and new user-facing features
2. Test form interactions and validations
3. Verify navigation changes
4. Cover both happy path and error scenarios for new functionality
5. Focus on features that can be automated with Selenium WebDriver
6. Include regression tests for existing functionality that might be affected

Break down complex workflows into simple, testable actions. Focus on what users can see and interact with in the browser.

Return ONLY a JSON array of functional test cases. Each action MUST use only: navigate to, click, type/enter in.`
        } catch (prError) {
          console.error('Failed to fetch GitHub PR:', prError)
          return new Response(
            JSON.stringify({ error: 'Failed to fetch GitHub PR data' }),
            { 
              status: 400, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
          )
        }
        break
      }
      
      case 'repository_analysis':
        if (!sourceData.repositoryStructure) {
          return new Response(
            JSON.stringify({ error: 'Repository structure is required for repository_analysis source type' }),
            { 
              status: 400, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
          )
        }
        prompt = `Generate functional test cases for Selenium/LambdaTest based on this repository structure:

${JSON.stringify(sourceData.repositoryStructure, null, 2)}

${ACTION_FORMAT_GUIDE}

Generate functional test cases that:
1. Cover main user journeys and workflows
2. Test key UI components and interactions
3. Verify form submissions and validations
4. Test navigation between different sections
5. Include authentication flows if present
6. Focus on end-to-end user scenarios

Remember to break down ALL complex actions into simple, Selenium-compatible steps using ONLY:
- "navigate to [path]" for page navigation
- "click [element]" for all clicking actions
- "type [value] in [field]" or "enter [value] in [field]" for text input

Return ONLY a JSON array of functional test cases with properly formatted actions for automated execution.`
        break

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid source type. Supported: description, github_pr, repository_analysis' }),
          { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        )
    }

    // Generate functional test cases using OpenAI
    console.log('Generating functional test cases with OpenAI...')
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an expert QA automation engineer specializing in Selenium WebDriver and LambdaTest. 
You MUST generate functional test cases using ONLY these exact action formats:
1. "navigate to [url/path]" - for navigation
2. "click [element]" - for clicking elements
3. "type [value] in [field]" OR "enter [value] in [field]" - for text input

NEVER use any other action format. Break down complex user flows into these simple, automatable steps.
Always be specific about element names (e.g., "login button", "email field", "submit button").
Generate practical, executable test cases that focus on UI interactions and user workflows.
Return only valid JSON format without code blocks or explanations.`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.2, // Lower temperature for more consistent formatting
      max_tokens: 4000,
    })

    const generatedContent = completion.choices[0]?.message?.content
    if (!generatedContent) {
      throw new Error('Failed to generate functional test cases')
    }

    console.log('Parsing generated functional test cases...')
    
    // Parse the JSON response with robust error handling
    let testCases: FunctionalTestCase[]
    try {
      let jsonContent = generatedContent.trim()
      
      // Remove markdown code blocks if present
      if (jsonContent.includes('```json')) {
        const jsonMatch = jsonContent.match(/```json\s*([\s\S]*?)\s*```/)
        if (jsonMatch) {
          jsonContent = jsonMatch[1].trim()
        }
      } else if (jsonContent.includes('```')) {
        const jsonMatch = jsonContent.match(/```\s*([\s\S]*?)\s*```/)
        if (jsonMatch) {
          jsonContent = jsonMatch[1].trim()
        }
      }
      
      // Try to find JSON array pattern
      const arrayMatch = jsonContent.match(/\[[\s\S]*\]/)
      if (arrayMatch) {
        jsonContent = arrayMatch[0]
      }
      
      // Clean up common JSON issues
      jsonContent = jsonContent
        .replace(/,\s*\]/g, ']')  // Remove trailing commas
        .replace(/,\s*\}/g, '}')  // Remove trailing commas in objects
      
      testCases = JSON.parse(jsonContent)
      
      // Validate the structure
      if (!Array.isArray(testCases)) {
        throw new Error('Response is not an array')
      }
      
      // Validate and fix test cases
      testCases = validateTestCases(testCases);
      
    } catch (parseError) {
      console.error('Failed to parse OpenAI response:', parseError)
      
      // Fallback: create basic functional test cases
      console.log('Creating fallback functional test cases...')
      testCases = [
        {
          test_name: "Basic Navigation Test",
          steps: [
            { action: "navigate to /", expected_result: "Homepage loads successfully" },
            { action: "click about link", expected_result: "About page is displayed" }
          ],
          test_data: { "note": "Auto-generated fallback test" },
          priority: "Medium" as const,
          category: "Navigation",
          test_type: "functional" as const
        },
        {
          test_name: "Basic Form Interaction Test",
          steps: [
            { action: "navigate to /contact", expected_result: "Contact form is displayed" },
            { action: "type John Doe in name field", expected_result: "Name is entered" },
            { action: "type john@example.com in email field", expected_result: "Email is entered" },
            { action: "click submit button", expected_result: "Form submission is attempted" }
          ],
          test_data: { 
            "name": "John Doe",
            "email": "john@example.com",
            "note": "Auto-generated fallback test" 
          },
          priority: "High" as const,
          category: "Forms",
          test_type: "functional" as const
        }
      ]
    }

    console.log(`Generated and validated ${testCases.length} functional test cases`)

    // Store AI generation record
    const { error: aiRecordError } = await supabaseClient
      .from('ai_features')
      .insert({
        project_id: projectId,
        source_type: sourceType,
        source_data: sourceData,
        generated_test_cases: testCases,
        created_by: user.id,
      })

    if (aiRecordError) {
      console.error('Failed to store AI generation record:', aiRecordError)
    }

    // Store test cases in database
    const testCaseInserts = testCases.map(tc => ({
      project_id: projectId,
      name: tc.test_name,
      description: `Functional test generated from ${sourceType}`,
      steps: tc.steps,
      test_data: tc.test_data,
      test_type: 'functional',
      priority: tc.priority,
      category: tc.category,
      created_by: user.id,
    }))

    console.log('Saving functional test cases to database...')
    const { data: insertedTestCases, error: insertError } = await supabaseClient
      .from('test_cases')
      .insert(testCaseInserts)
      .select()

    if (insertError) {
      console.error('Failed to insert functional test cases:', insertError)
      throw new Error('Failed to save functional test cases')
    }

    console.log(`Successfully saved ${insertedTestCases.length} functional test cases`)

    return new Response(
      JSON.stringify({
        success: true,
        testCases: insertedTestCases,
        generatedCount: testCases.length,
        testType: 'functional'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Error in generate-functional-tests function:', error)
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