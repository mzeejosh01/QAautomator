/* eslint-disable @typescript-eslint/no-explicit-any */
// supabase/functions/generate-tests/index.ts

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import OpenAI from 'https://esm.sh/openai@4'

// CORS configuration - adjust origins based on your environment
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // or specify your domain
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
  'Access-Control-Max-Age': '86400', // 24 hours
}

interface TestCase {
  test_name: string;
  steps: Array<{
    action: string;
    expected_result: string;
  }>;
  test_data: Record<string, string>;
  priority: 'Low' | 'Medium' | 'High';
  category: string;
}

interface GenerateTestsRequest {
  projectId: string;
  sourceType: 'description' | 'github_pr' | 'repository_analysis';
  sourceData: {
    description?: string;
    prUrl?: string;
    repositoryStructure?: any;
  };
}

// Define valid action patterns for LambdaTest
const VALID_ACTION_PATTERNS = {
  navigate: /^navigate to\s+/i,
  click: /^click\s+/i,
  type: /^(type|enter)\s+.+\s+in\s+/i,
};

const ACTION_FORMAT_GUIDE = `
IMPORTANT: Use ONLY these specific action formats that LambdaTest can understand:

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

serve(async (req) => {
  console.log(`${req.method} ${req.url}`)
  
  // Handle CORS preflight requests FIRST
  if (req.method === 'OPTIONS') {
    console.log('Handling CORS preflight request')
    return new Response(null, { 
      status: 200,
      headers: corsHeaders 
    })
  }

  // Only allow POST requests for the main functionality
  if (req.method !== 'POST') {
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
    let requestData: GenerateTestsRequest
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
        prompt = `Generate comprehensive test cases for the following feature description:

${sourceData.description}

${ACTION_FORMAT_GUIDE}

Generate test cases that:
1. Cover happy path scenarios
2. Include edge cases and error conditions
3. Verify the main functionality described
4. Consider different user interactions
5. Include both positive and negative test scenarios

EXAMPLE of a properly formatted test case:
{
  "test_name": "Verify contact form submission with valid data",
  "steps": [
    {"action": "navigate to /contact", "expected_result": "Contact page is displayed"},
    {"action": "type John Doe in name field", "expected_result": "Name field contains John Doe"},
    {"action": "type john@example.com in email field", "expected_result": "Email field contains john@example.com"},
    {"action": "type Hello, this is a test message in message field", "expected_result": "Message field contains the text"},
    {"action": "click submit button", "expected_result": "Form is submitted successfully"},
    {"action": "navigate to /thank-you", "expected_result": "Thank you page is displayed"}
  ],
  "test_data": {"name": "John Doe", "email": "john@example.com", "message": "Hello, this is a test message"},
  "priority": "High",
  "category": "UI"
}

Return ONLY a JSON array of test cases with the exact structure shown above. Each action MUST follow the format guide.`
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
          prompt = `Analyze this GitHub Pull Request and generate comprehensive test cases:

PR Title: ${prData.title}
PR Description: ${prData.body || 'No description provided'}
Changed Files: ${prData.files.map(f => f.filename).join(', ')}

Key Changes:
${prData.files.map(f => `- ${f.filename} (${f.status}): ${f.patch || 'No diff available'}`).join('\n')}

${ACTION_FORMAT_GUIDE}

Generate test cases that:
1. Specifically target the changed functionality
2. Include both happy path and edge cases for new features
3. Verify bug fixes if mentioned in the PR
4. Cover any modified UI components
5. Include API tests if backend changes are detected

Break down complex workflows into simple actions. For example:
- Instead of "complete user registration flow"
- Use: "navigate to /register", "type email in email field", "type password in password field", "click register button"

Return ONLY a JSON array of test cases. Each action MUST use only: navigate to, click, type/enter in.`
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
        prompt = `Generate test cases based on this repository structure analysis:

${JSON.stringify(sourceData.repositoryStructure, null, 2)}

${ACTION_FORMAT_GUIDE}

Generate test cases that:
1. Cover the main application functionality
2. Test key UI interactions
3. Verify user flows step by step
4. Include form validations and error handling
5. Test navigation between pages

Remember to break down ALL complex actions into simple steps using ONLY:
- "navigate to [path]" for page navigation
- "click [element]" for all clicks
- "type [value] in [field]" or "enter [value] in [field]" for text input

Return ONLY a JSON array of test cases with properly formatted actions.`
        break

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid source type' }),
          { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        )
    }

    // Generate test cases using OpenAI
    console.log('Generating test cases with OpenAI (gpt-4o-mini)...')
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',  // Optimal choice: fast, cheap, excellent quality
      messages: [
        {
          role: 'system',
          content: `You are an expert QA engineer who MUST generate test cases using ONLY these exact action formats:
1. "navigate to [url/path]" - for navigation
2. "click [element]" - for clicking
3. "type [value] in [field]" OR "enter [value] in [field]" - for text input

NEVER use any other action format. Break down complex actions into these simple steps.
Always be specific about element names (e.g., "login button", "email field", "submit button").
Generate practical, executable test cases in valid JSON format.`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 4000,
    })

    const generatedContent = completion.choices[0]?.message?.content
    if (!generatedContent) {
      throw new Error('Failed to generate test cases')
    }

    console.log('Parsing generated test cases...')
    console.log('Raw OpenAI response:', generatedContent)
    
    // Parse the JSON response with robust error handling
    let testCases: TestCase[]
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
      
      // Clean up common issues
      jsonContent = jsonContent
        .replace(/,\s*\]/g, ']')  // Remove trailing commas
        .replace(/,\s*\}/g, '}')  // Remove trailing commas in objects
      
      console.log('Cleaned JSON content:', jsonContent)
      
      testCases = JSON.parse(jsonContent)
      
      // Validate the structure
      if (!Array.isArray(testCases)) {
        throw new Error('Response is not an array')
      }
      
      // Validate each test case has required fields
      testCases.forEach((tc, index) => {
        if (!tc.test_name || !tc.steps || !tc.priority || !tc.category) {
          throw new Error(`Test case at index ${index} is missing required fields`)
        }
      })
      
    } catch (parseError) {
      console.error('Failed to parse OpenAI response:', parseError)
      console.error('Generated content:', generatedContent)
      
      // Fallback: create a basic test case from the description
      console.log('Creating fallback test cases...')
      testCases = [
        {
          test_name: "Basic Application Test",
          steps: [
            { action: "navigate to /", expected_result: "Application loads successfully" },
            { action: "click login button", expected_result: "Login page is displayed" },
            { action: "type test@example.com in email field", expected_result: "Email is entered" },
            { action: "type password123 in password field", expected_result: "Password is entered" },
            { action: "click submit button", expected_result: "Login is attempted" }
          ],
          test_data: { 
            "email": "test@example.com",
            "password": "password123",
            "note": "Auto-generated due to parsing error" 
          },
          priority: "Medium" as const,
          category: "UI"
        }
      ]
      
      // Still log the parsing error but don't throw - use fallback instead
      console.warn('Using fallback test case due to parsing error')
    }

    // Validate and fix action formats
    console.log('Validating action formats...')
    testCases = testCases.map((tc, tcIndex) => {
      const validatedSteps = tc.steps.map((step, stepIndex) => {
        const action = step.action.trim();
        const actionLower = action.toLowerCase();
        
        // Check if action matches valid patterns
        const isValidNavigate = VALID_ACTION_PATTERNS.navigate.test(action);
        const isValidClick = VALID_ACTION_PATTERNS.click.test(action);
        const isValidType = VALID_ACTION_PATTERNS.type.test(action);
        
        if (!isValidNavigate && !isValidClick && !isValidType) {
          console.warn(`Test case ${tcIndex}, step ${stepIndex} has invalid action format: ${action}`);
          
          // Try to auto-fix common patterns
          let fixedAction = action;
          
          // Fix navigation patterns
          if (actionLower.includes('go to') || actionLower.includes('open') || actionLower.includes('visit')) {
            fixedAction = action.replace(/go to|open|visit/gi, 'navigate to');
          }
          // Fix click patterns
          else if (actionLower.includes('press') || actionLower.includes('tap') || actionLower.includes('select')) {
            fixedAction = action.replace(/press|tap|select/gi, 'click');
          }
          // Fix input patterns
          else if (actionLower.includes('input') || actionLower.includes('fill') || actionLower.includes('write')) {
            // Try to extract field and value
            const fieldMatch = action.match(/(?:in|into|to)\s+(\w+)/i);
            const valueMatch = action.match(/"([^"]+)"|'([^']+)'|(\S+)/);
            
            if (fieldMatch && valueMatch) {
              const field = fieldMatch[1];
              const value = valueMatch[1] || valueMatch[2] || valueMatch[3];
              fixedAction = `type ${value} in ${field} field`;
            } else {
              fixedAction = `type value in field`; // Generic fallback
            }
          }
          // If still doesn't match, try to categorize
          else if (actionLower.includes('button') || actionLower.includes('link')) {
            fixedAction = `click ${action}`;
          }
          else if (actionLower.includes('field') || actionLower.includes('input')) {
            fixedAction = `type text in ${action}`;
          }
          else {
            // Last resort - assume it's a click action
            fixedAction = `click ${action}`;
          }
          
          console.log(`Auto-fixed action: "${action}" -> "${fixedAction}"`);
          return { ...step, action: fixedAction };
        }
        
        return step;
      });
      
      return { ...tc, steps: validatedSteps };
    });

    console.log(`Generated and validated ${testCases.length} test cases`)

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
      description: `Generated from ${sourceType}`,
      steps: tc.steps,
      test_data: tc.test_data,
      priority: tc.priority,
      category: tc.category,
      created_by: user.id,
    }))

    console.log('Saving test cases to database...')
    const { data: insertedTestCases, error: insertError } = await supabaseClient
      .from('test_cases')
      .insert(testCaseInserts)
      .select()

    if (insertError) {
      console.error('Failed to insert test cases:', insertError)
      throw new Error('Failed to save test cases')
    }

    console.log(`Successfully saved ${insertedTestCases.length} test cases`)

    return new Response(
      JSON.stringify({
        success: true,
        testCases: insertedTestCases,
        generatedCount: testCases.length,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Error in generate-tests function:', error)
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