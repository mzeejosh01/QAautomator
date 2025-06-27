/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Types for our database
export interface Profile {
  id: string
  email: string
  full_name?: string
  avatar_url?: string
  github_token?: string
  slack_webhook_url?: string
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  name: string
  description?: string
  repository_url?: string
  repository_name?: string
  github_repo_id?: number
  owner_id: string
  settings: Record<string, any>
  created_at: string
  updated_at: string
}

export interface TestCase {
  id: string
  project_id: string
  name: string
  description?: string
  test_type?: 'functional' | 'load'
  steps: Array<{
    action: string
    expected_result: string
  }>
  test_data: Record<string, any>
  jmeter_config?: {
    test_plan?: string
    threads: number
    ramp_up: number
    duration: number
    target_tps?: number
    endpoints?: Array<{
      url: string
      method: string
      body?: string
      headers?: Record<string, string>
    }>
  }
  priority: 'Low' | 'Medium' | 'High'
  category?: string
  created_by?: string
  created_at: string
  updated_at: string
}

export interface TestRun {
  id: string
  project_id: string
  name: string
  environment: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  test_type: 'functional' | 'load'
  trigger_type: 'manual' | 'github_pr' | 'scheduled'
  trigger_data: Record<string, any>
  started_by?: string
  started_at: string
  completed_at?: string
  total_tests: number
  passed_tests: number
  failed_tests: number
  duration_seconds?: number
  load_test_metrics?: {
    requests_per_second: number
    avg_response_time: number
    error_rate: number
    percentile_90: number
    percentile_95: number
    percentile_99: number
    throughput: number
    total_requests: number
    total_errors: number
  }
}

export interface TestResult {
  id: string
  test_run_id: string
  test_case_id: string
  status: 'pass' | 'fail' | 'skip'
  error_message?: string
  logs?: string
  screenshots: string[]
  duration_seconds?: number
  executed_at: string
  load_test_metrics?: {
    response_time: number
    latency: number
    bytes: number
    success: boolean
  }
}

// Auth helpers
export const auth = {
  signUp: async (email: string, password: string, fullName?: string) => {
    return await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    })
  },

  signIn: async (email: string, password: string) => {
    return await supabase.auth.signInWithPassword({
      email,
      password,
    })
  },

  signInWithGitHub: async () => {
    return await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        scopes: 'repo',
      },
    })
  },

  signOut: async () => {
    return await supabase.auth.signOut()
  },

  getUser: async () => {
    return await supabase.auth.getUser()
  },

  onAuthStateChange: (callback: (event: string, session: any) => void) => {
    return supabase.auth.onAuthStateChange(callback)
  },
}

// API helpers
export const api = {
  getProjects: async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('User must be authenticated')
    
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data
  },

  createProject: async (project: Partial<Project>) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('User must be authenticated to create a project')

    const { data, error } = await supabase
      .from('projects')
      .insert({
        ...project,
        owner_id: user.id,
      })
      .select()
      .single()
    
    if (error) throw error
    return data
  },

  updateProject: async (id: string, updates: Partial<Project>) => {
    const { data, error } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error
    return data
  },

  getTestCases: async (projectId: string) => {
    const { data, error } = await supabase
      .from('test_cases')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data
  },

  uploadJMeterTestPlan: async (
    projectId: string,
    jmxContent: string,
    config: {
      name: string
      description?: string
      threads: number
      ramp_up: number
      duration: number
    }
  ) => {
    const { data, error } = await supabase
      .from('test_cases')
      .insert({
        project_id: projectId,
        name: config.name,
        description: config.description || `JMeter load test - ${config.name}`,
        test_type: 'load',
        jmeter_config: {
          test_plan: jmxContent,
          threads: config.threads,
          ramp_up: config.ramp_up,
          duration: config.duration,
        },
        priority: 'Medium',
      })
      .select()
      .single()
    
    if (error) throw error
    return data
  },

  getTestRuns: async (projectId?: string) => {
    let query = supabase
      .from('test_runs')
      .select('*')
      .order('created_at', { ascending: false })
    
    if (projectId) {
      query = query.eq('project_id', projectId)
    }
    
    const { data, error } = await query
    if (error) throw error
    return data
  },

  getTestResults: async (testRunId: string) => {
    const { data, error } = await supabase
      .from('test_results')
      .select('*')
      .eq('test_run_id', testRunId)
      .order('executed_at', { ascending: false })
    
    if (error) throw error
    return data
  },

  getProfile: async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .single()
    
    if (error) throw error
    return data
  },

  updateProfile: async (updates: Partial<Profile>) => {
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', (await supabase.auth.getUser()).data.user?.id)
      .select()
      .single()
    
    if (error) throw error
    return data
  },

 generateFunctionalTests: async (
    projectId: string,
    sourceType: 'description' | 'github_pr' | 'repository_analysis',
    sourceData: {
      description?: string;
      prUrl?: string;
      repositoryStructure?: any;
    }
  ) => {
    const { data, error } = await supabase.functions.invoke('generate-functional-tests', {
      body: {
        projectId,
        sourceType,
        sourceData,
      },
    });
    
    if (error) throw error;
    return data;
  },

   generateLoadTests: async (
    projectId: string,
    sourceType: 'api_endpoints' | 'url_analysis' | 'custom_config',
    sourceData: any
  ) => {
    const { data, error } = await supabase.functions.invoke('generate-load-tests', {
      body: {
        projectId,
        sourceType,
        sourceData,
      },
    });
    
    if (error) throw error;
    return data;
  },

  executeTests: async (
    projectId: string,
    testCaseIds: string[],
    environment: string,
    testType: 'functional' | 'load' = 'functional',
    triggerType: 'manual' | 'github_pr' | 'scheduled' = 'manual',
    triggerData?: any
  ) => {
    const { data, error } = await supabase.functions.invoke('execute-tests', {
      body: {
        projectId,
        testCaseIds,
        environment,
        testType,
        triggerType,
        triggerData,
      },
    })

    
    
    if (error) throw error
    return data
  },

  executeFunctionalTests: async (
  projectId: string,
  testCaseIds: string[],
  environment: string,
  browserType: string = 'chrome'
) => {
  const { data, error } = await supabase.functions.invoke('execute-functional-tests', {
    body: {
      projectId,
      testCaseIds,
      environment,
      browserType
    },
  });
  
  if (error) throw error;
  return data;
},

 // In your API helpers section, replace executeTests with:
executeLoadTests: async (
  projectId: string,
  testCaseIds: string[],
  environment: string,
  config?: {
    threads?: number;
    rampUp?: number;
    duration?: number;
  }
) => {
  const { data, error } = await supabase.functions.invoke('execute-load-tests', {
    body: {
      projectId,
      testCaseIds,
      environment,
      loadTestConfig: config,
    },
  });
  
  if (error) throw error;
  return data;
},

  executeJMeterTest: async (
    projectId: string,
    testCaseId: string,
    environment: string,
    config?: {
      threads?: number
      ramp_up?: number
      duration?: number
    }
  ) => {
    const { data, error } = await supabase.functions.invoke('execute-jmeter-test', {
      body: {
        projectId,
        testCaseId,
        environment,
        config,
      },
    })
    
    if (error) throw error
    return data
  },

  analyzeRepository: async (repositoryUrl: string, githubToken: string) => {
    const { data, error } = await supabase.functions.invoke('github-integration/analyze', {
      body: {
        repositoryUrl,
        githubToken,
      },
    })
    
    if (error) throw error
    return data
  },

  setupGitHubWebhook: async (projectId: string, repositoryUrl: string, githubToken: string) => {
    const { data, error } = await supabase.functions.invoke('github-integration/setup-webhook', {
      body: {
        projectId,
        repositoryUrl,
        githubToken,
      },
    })
    
    if (error) throw error
    return data
  },

}

// Real-time subscriptions
export const subscriptions = {
  subscribeToTestRuns: (projectId: string, callback: (payload: any) => void) => {
    return supabase
      .channel('test_runs')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'test_runs',
          filter: `project_id=eq.${projectId}`,
        },
        callback
      )
      .subscribe()
  },

  subscribeToTestResults: (testRunId: string, callback: (payload: any) => void) => {
    return supabase
      .channel('test_results')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'test_results',
          filter: `test_run_id=eq.${testRunId}`,
        },
        callback
      )
      .subscribe()
  },

  subscribeToJMeterTest: (testRunId: string, callback: (payload: any) => void) => {
    return supabase
      .channel('jmeter_test')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'test_runs',
          filter: `id=eq.${testRunId}`,
        },
        callback
      )
      .subscribe()
  },
}