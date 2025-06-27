/* eslint-disable @typescript-eslint/no-explicit-any */
// supabase/functions/generate-load-tests/index.ts

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import OpenAI from 'https://esm.sh/openai@4'

// CORS configuration - Fixed headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with, accept, accept-language, cache-control, pragma',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE, PATCH',
  'Access-Control-Max-Age': '86400',
}

interface LoadTestConfig {
  test_name: string;
  description: string;
  test_type: 'load';
  jmeter_config: {
    threads: number;
    ramp_up: number;
    duration: number;
    target_tps?: number;
    endpoints: Array<{
      url: string;
      method: 'GET' | 'POST' | 'PUT' | 'DELETE';
      body?: string;
      headers?: Record<string, string>;
      assertions?: Array<{
        field: string;
        pattern: string;
      }>;
    }>;
    timers?: {
      constant_delay: number;
      random_delay: number;
    };
    csv_data?: {
      filename: string;
      variables: string[];
    };
  };
}

interface GenerateLoadTestRequest {
  projectId: string;
  sourceType: 'api_endpoints' | 'url_analysis' | 'custom_config';
  sourceData: {
    description?: string;
    baseUrl?: string;
    endpoints?: Array<{
      url: string;
      method: 'GET' | 'POST' | 'PUT' | 'DELETE';
      body?: string;
      headers?: Record<string, string>;
    }>;
    config?: {
      threads?: number;
      ramp_up?: number;
      duration?: number;
      target_tps?: number;
    };
  };
}

const LOAD_TEST_PROMPT = `
You are an expert performance engineer specializing in Apache JMeter. Generate a comprehensive JMeter load test configuration based on the following requirements:

Test Configuration:
- Virtual Users (Threads): {threads}
- Ramp-up Period: {ramp_up} seconds
- Test Duration: {duration} seconds
- Target Throughput: {target_tps} transactions per second
- Base URL: {baseUrl}

API Endpoints to Test:
{endpoints}

Test Scenario Description:
{description}

Generate a complete JMeter test configuration that includes:

1. **Thread Group Configuration**:
   - Proper thread count, ramp-up, and duration settings
   - Loop controller if needed

2. **HTTP Request Samplers**:
   - One for each endpoint with proper method, path, and body
   - Appropriate headers (Content-Type, Authorization, etc.)
   - Query parameters if needed

3. **Timers**:
   - Constant timer for think time between requests
   - Random timer for realistic user behavior simulation

4. **Assertions**:
   - Response code assertions (200, 201, etc.)
   - Response time assertions
   - Content assertions for critical responses

5. **Data Management**:
   - CSV Data Set Config if test data is needed
   - Variable definitions for dynamic data

6. **Monitoring**:
   - Response time thresholds
   - Error rate monitoring
   - Throughput expectations

Return ONLY a JSON object with this exact structure:
{
  "test_name": "Load Test - [descriptive name]",
  "description": "Detailed description of what this load test validates...",
  "test_type": "load",
  "jmeter_config": {
    "threads": number,
    "ramp_up": number,
    "duration": number,
    "target_tps": number,
    "endpoints": [
      {
        "url": "string (full URL or path)",
        "method": "GET|POST|PUT|DELETE",
        "body": "string (JSON body for POST/PUT)",
        "headers": {
          "Content-Type": "application/json",
          "Authorization": "Bearer \${token}"
        },
        "assertions": [
          {
            "field": "response_code",
            "pattern": "200"
          },
          {
            "field": "response_time",
            "pattern": "< 2000"
          }
        ]
      }
    ],
    "timers": {
      "constant_delay": 500,
      "random_delay": 300
    },
    "csv_data": {
      "filename": "test_data.csv",
      "variables": ["userId", "email", "token"]
    }
  }
}

Focus on realistic load patterns and proper performance testing practices. Include appropriate assertions and data management for a production-ready load test.
`;

// Helper functions
function validateLoadTestConfig(config: any): LoadTestConfig {
  // Ensure required fields exist with defaults
  const validatedConfig: LoadTestConfig = {
    test_name: config.test_name || `Load Test - ${new Date().toISOString()}`,
    description: config.description || 'Generated API load test',
    test_type: 'load',
    jmeter_config: {
      threads: config.jmeter_config?.threads || 10,
      ramp_up: config.jmeter_config?.ramp_up || 30,
      duration: config.jmeter_config?.duration || 300,
      target_tps: config.jmeter_config?.target_tps || undefined,
      endpoints: [],
      timers: {
        constant_delay: config.jmeter_config?.timers?.constant_delay || 500,
        random_delay: config.jmeter_config?.timers?.random_delay || 300
      },
      csv_data: config.jmeter_config?.csv_data || undefined
    }
  };

  // Validate and fix endpoints
  if (config.jmeter_config?.endpoints && Array.isArray(config.jmeter_config.endpoints)) {
    validatedConfig.jmeter_config.endpoints = config.jmeter_config.endpoints.map((endpoint: any) => ({
      url: endpoint.url || '/',
      method: ['GET', 'POST', 'PUT', 'DELETE'].includes(endpoint.method) ? endpoint.method : 'GET',
      body: endpoint.body || undefined,
      headers: endpoint.headers || { 'Content-Type': 'application/json' },
      assertions: Array.isArray(endpoint.assertions) ? endpoint.assertions : [
        { field: 'response_code', pattern: '200' },
        { field: 'response_time', pattern: '< 3000' }
      ]
    }));
  } else {
    // Default endpoint if none provided
    validatedConfig.jmeter_config.endpoints = [{
      url: '/',
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      assertions: [
        { field: 'response_code', pattern: '200' },
        { field: 'response_time', pattern: '< 3000' }
      ]
    }];
  }

  return validatedConfig;
}

function buildLoadTestPrompt(requestData: GenerateLoadTestRequest): string {
  const { sourceData } = requestData;
  
  const config = {
    threads: sourceData.config?.threads || 10,
    ramp_up: sourceData.config?.ramp_up || 30,
    duration: sourceData.config?.duration || 300,
    target_tps: sourceData.config?.target_tps || 10,
    ...sourceData.config
  };

  let endpointsString = 'No specific endpoints provided';
  if (sourceData.endpoints && sourceData.endpoints.length > 0) {
    endpointsString = sourceData.endpoints.map(ep => 
      `${ep.method} ${ep.url}${ep.body ? ' (with body: ' + JSON.stringify(ep.body) + ')' : ''}`
    ).join('\n');
  }

  return LOAD_TEST_PROMPT
    .replace('{threads}', config.threads.toString())
    .replace('{ramp_up}', config.ramp_up.toString())
    .replace('{duration}', config.duration.toString())
    .replace('{target_tps}', config.target_tps?.toString() || 'not specified')
    .replace('{baseUrl}', sourceData.baseUrl || 'https://api.example.com')
    .replace('{endpoints}', endpointsString)
    .replace('{description}', sourceData.description || 'General API performance testing');
}

function createDefaultLoadTestConfig(sourceData: any): LoadTestConfig {
  return {
    test_name: `Load Test - ${new Date().toISOString().split('T')[0]}`,
    description: sourceData.description || 'API load test configuration',
    test_type: 'load',
    jmeter_config: {
      threads: sourceData.config?.threads || 10,
      ramp_up: sourceData.config?.ramp_up || 30,
      duration: sourceData.config?.duration || 300,
      target_tps: sourceData.config?.target_tps || undefined,
      endpoints: sourceData.endpoints || [{
        url: '/',
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        assertions: [
          { field: 'response_code', pattern: '200' },
          { field: 'response_time', pattern: '< 2000' }
        ]
      }],
      timers: {
        constant_delay: 500,
        random_delay: 300
      }
    }
  };
}

// Main handler
serve(async (req) => {
  console.log(`${req.method} ${req.url}`)
  
  // Handle CORS preflight requests - FIXED
  if (req.method === 'OPTIONS') {
    console.log('Handling CORS preflight request')
    return new Response(null, { 
      status: 200,
      headers: corsHeaders 
    })
  }

  try {
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

    console.log('Processing load test generation request...')
    
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
    let requestData: GenerateLoadTestRequest
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

    // Validate source type
    if (!['api_endpoints', 'url_analysis', 'custom_config'].includes(sourceType)) {
      return new Response(
        JSON.stringify({ error: 'Invalid source type. Supported: api_endpoints, url_analysis, custom_config' }),
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

    console.log('Generating JMeter load test configuration...');
    
    let loadTestConfig: LoadTestConfig;

    try {
      // Build the prompt based on source data
      const prompt = buildLoadTestPrompt(requestData);

      // Generate load test configuration using OpenAI
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a performance testing expert specializing in Apache JMeter. ' +
              'Generate comprehensive, production-ready JMeter test plans with proper thread groups, ' +
              'HTTP samplers, timers, assertions, and data management. ' +
              'Return ONLY valid JSON configuration matching the exact required structure. ' +
              'Focus on realistic load patterns and include appropriate performance thresholds.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1, // Lower temperature for more precise configurations
        max_tokens: 3000,
        response_format: { type: "json_object" },
      });

      const generatedContent = completion.choices[0]?.message?.content;
      if (!generatedContent) {
        throw new Error('Failed to generate load test configuration');
      }

      // Parse and validate the generated configuration
      const parsedConfig = JSON.parse(generatedContent);
      loadTestConfig = validateLoadTestConfig(parsedConfig);

    } catch (generationError) {
      console.error('Failed to generate load test config with AI:', generationError);
      
      // Fallback to default configuration
      console.log('Using default load test configuration...');
      loadTestConfig = createDefaultLoadTestConfig(sourceData);
    }

    // Enhanced configuration based on source type
    switch (sourceType) {
      case 'api_endpoints':
        loadTestConfig.description = `API endpoint performance test covering ${loadTestConfig.jmeter_config.endpoints.length} endpoints`;
        loadTestConfig.jmeter_config.csv_data = {
          filename: 'api_test_data.csv',
          variables: ['userId', 'authToken', 'requestId']
        };
        break;
        
      case 'url_analysis':
        loadTestConfig.description = `Website performance analysis for ${sourceData.baseUrl || 'target application'}`;
        if (sourceData.baseUrl) {
          loadTestConfig.jmeter_config.endpoints = loadTestConfig.jmeter_config.endpoints.map(ep => ({
            ...ep,
            url: ep.url.startsWith('http') ? ep.url : `${sourceData.baseUrl}${ep.url}`
          }));
        }
        break;
        
      case 'custom_config':
        loadTestConfig.description = sourceData.description || 'Custom load test configuration';
        break;
    }

    // Store the load test configuration
    const { data: insertedTestCase, error: insertError } = await supabaseClient
      .from('test_cases')
      .insert({
        project_id: projectId,
        name: loadTestConfig.test_name,
        description: loadTestConfig.description,
        test_type: 'load',
        jmeter_config: loadTestConfig.jmeter_config,
        priority: 'High',
        category: 'Performance',
        created_by: user.id,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Failed to save load test:', insertError);
      throw new Error(`Failed to save load test: ${insertError.message}`);
    }

    // Store AI generation record
    const { error: aiRecordError } = await supabaseClient
      .from('ai_features')
      .insert({
        project_id: projectId,
        source_type: sourceType,
        source_data: sourceData,
        generated_test_cases: [loadTestConfig],
        created_by: user.id,
      })

    if (aiRecordError) {
      console.error('Failed to store AI generation record:', aiRecordError)
    }

    console.log('Successfully created load test configuration:', insertedTestCase.id);

    return new Response(
      JSON.stringify({
        success: true,
        testCase: insertedTestCase,
        loadTestConfig: loadTestConfig,
        generatedCount: 1,
        testType: 'load',
        jmeterInfo: {
          threads: loadTestConfig.jmeter_config.threads,
          duration: loadTestConfig.jmeter_config.duration,
          endpoints: loadTestConfig.jmeter_config.endpoints.length,
          expectedTps: loadTestConfig.jmeter_config.target_tps
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error in generate-load-tests function:', error)
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