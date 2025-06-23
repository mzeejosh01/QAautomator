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
        prompt = `Generate comprehensive test cases for the following feature description:\n\n${sourceData.description}`
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
          prompt = `Generate test cases for this GitHub Pull Request:\n\nTitle: ${prData.title}\n\nDescription: ${prData.body}\n\nChanged Files: ${prData.files.map(f => f.filename).join(', ')}`
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
        prompt = `Generate test cases based on this repository structure analysis:\n\n${JSON.stringify(sourceData.repositoryStructure, null, 2)}`
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

    // Enhanced prompt for better test generation
    const fullPrompt = `
${prompt}

IMPORTANT: You must return ONLY a valid JSON array. Do not include any explanations, markdown formatting, or text before/after the JSON.

Generate detailed test cases in JSON format. Each test case should include:
- test_name: A descriptive name for the test
- steps: Array of objects with 'action' and 'expected_result'
- test_data: Object with test data needed (usernames, emails, etc.)
- priority: 'Low', 'Medium', or 'High'
- category: The type of testing (e.g., 'Authentication', 'UI', 'API', 'Integration')

Focus on:
1. Happy path scenarios
2. Edge cases and error handling
3. Boundary value testing
4. User experience flows
5. Security considerations

Return ONLY the JSON array with no additional text:

[
  {
    "test_name": "User_Login_Valid_Credentials",
    "steps": [
      {"action": "Navigate to login page", "expected_result": "Login form is displayed"},
      {"action": "Enter valid email", "expected_result": "Email field accepts input"},
      {"action": "Enter valid password", "expected_result": "Password field accepts input"},
      {"action": "Click login button", "expected_result": "User is redirected to dashboard"}
    ],
    "test_data": {"email": "test@example.com", "password": "ValidPass123!"},
    "priority": "High",
    "category": "Authentication"
  }
]
`

    // Generate test cases using OpenAI
    console.log('Generating test cases with OpenAI (gpt-4o-mini)...')
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',  // Optimal choice: fast, cheap, excellent quality
      messages: [
        {
          role: 'system',
          content: 'You are an expert QA engineer. Generate comprehensive, practical test cases in the exact JSON format requested. Be thorough and consider real-world testing scenarios.'
        },
        {
          role: 'user',
          content: fullPrompt
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
          test_name: "Generated_Test_Case",
          steps: [
            { action: "Navigate to the application", expected_result: "Application loads successfully" },
            { action: "Perform the main functionality", expected_result: "Feature works as expected" },
            { action: "Verify the outcome", expected_result: "Expected results are achieved" }
          ],
          test_data: { "note": "Auto-generated due to parsing error" },
          priority: "Medium" as const,
          category: "General Testing"
        }
      ]
      
      // Still log the parsing error but don't throw - use fallback instead
      console.warn('Using fallback test case due to parsing error')
    }

    console.log(`Generated ${testCases.length} test cases`)

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

  return {
    title: prData.title,
    body: prData.body || '',
    files: files,
  }
}