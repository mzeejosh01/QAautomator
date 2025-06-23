/* eslint-disable @typescript-eslint/no-explicit-any */
// supabase/functions/github-integration/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-github-event, x-hub-signature-256',
}

interface AnalyzeRepositoryRequest {
  repositoryUrl: string;
  githubToken: string;
}

interface RepositoryStructure {
  components: string[];
  pages: string[];
  routes: Array<{ path: string; component: string }>;
  apis: string[];
  dependencies: Record<string, string>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const pathname = url.pathname

  if (pathname.endsWith('/webhook')) {
    return handleGitHubWebhook(req)
  } else if (pathname.endsWith('/analyze')) {
    return handleRepositoryAnalysis(req)
  } else if (pathname.endsWith('/setup-webhook')) {
    return handleWebhookSetup(req)
  }

  return new Response('Not found', { status: 404, headers: corsHeaders })
})

async function handleGitHubWebhook(req: Request) {
  try {
    const signature = req.headers.get('x-hub-signature-256')
    const event = req.headers.get('x-github-event')
    const body = await req.text()

    console.log(`Received GitHub webhook: ${event}`)

    // Initialize Supabase
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    if (event === 'pull_request') {
      const payload = JSON.parse(body)
      
      // Only process opened PRs
      if (payload.action === 'opened') {
        await handlePullRequestOpened(supabaseClient, payload)
      }
    }

    return new Response('OK', { headers: corsHeaders })

  } catch (error) {
    console.error('Webhook error:', error)
    return new Response('Internal server error', { status: 500, headers: corsHeaders })
  }
}

async function handleRepositoryAnalysis(req: Request) {
  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    const {
      data: { user },
    } = await supabaseClient.auth.getUser()

    if (!user) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    }

    const { repositoryUrl, githubToken }: AnalyzeRepositoryRequest = await req.json()

    // Extract owner and repo from URL
    const urlMatch = repositoryUrl.match(/github\.com\/([^/]+)\/([^/]+)/)
    if (!urlMatch) {
      return new Response('Invalid GitHub URL', { status: 400, headers: corsHeaders })
    }

    const [, owner, repo] = urlMatch

    console.log(`Analyzing repository: ${owner}/${repo}`)

    // Analyze repository structure
    const structure = await analyzeRepositoryStructure(owner, repo, githubToken)

    return new Response(
      JSON.stringify({
        success: true,
        structure,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Repository analysis error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
}

async function handleWebhookSetup(req: Request) {
  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    const {
      data: { user },
    } = await supabaseClient.auth.getUser()

    if (!user) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    }

    const { projectId, repositoryUrl, githubToken } = await req.json()

    // Verify project ownership
    const { data: project, error: projectError } = await supabaseClient
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('owner_id', user.id)
      .single()

    if (projectError || !project) {
      return new Response('Project not found', { status: 404, headers: corsHeaders })
    }

    const urlMatch = repositoryUrl.match(/github\.com\/([^/]+)\/([^/]+)/)
    if (!urlMatch) {
      return new Response('Invalid GitHub URL', { status: 400, headers: corsHeaders })
    }

    const [, owner, repo] = urlMatch

    // Create webhook on GitHub
    const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/github-integration/webhook`
    const webhookSecret = crypto.randomUUID()

    const webhookResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/hooks`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'web',
          active: true,
          events: ['pull_request'],
          config: {
            url: webhookUrl,
            content_type: 'json',
            secret: webhookSecret,
          },
        }),
      }
    )

    if (!webhookResponse.ok) {
      const error = await webhookResponse.text()
      throw new Error(`Failed to create webhook: ${error}`)
    }

    const webhook = await webhookResponse.json()

    // Get repository info
    const repoResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      {
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      }
    )

    const repoData = await repoResponse.json()

    // Store webhook in database
    await supabaseClient
      .from('github_webhooks')
      .insert({
        project_id: projectId,
        webhook_id: webhook.id,
        repository_id: repoData.id,
        secret: webhookSecret,
      })

    // Update project with repository info
    await supabaseClient
      .from('projects')
      .update({
        repository_url: repositoryUrl,
        repository_name: `${owner}/${repo}`,
        github_repo_id: repoData.id,
      })
      .eq('id', projectId)

    return new Response(
      JSON.stringify({
        success: true,
        webhookId: webhook.id,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Webhook setup error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
}

async function analyzeRepositoryStructure(
  owner: string,
  repo: string,
  githubToken: string
): Promise<RepositoryStructure> {
  
  // Get repository contents
  const contentsResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents`,
    {
      headers: {
        'Authorization': `token ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    }
  )

  if (!contentsResponse.ok) {
    throw new Error('Failed to fetch repository contents')
  }

  // Recursively scan for files
  const files = await scanRepositoryFiles(owner, repo, '', githubToken)
  
  // Analyze file structure
  const structure: RepositoryStructure = {
    components: [],
    pages: [],
    routes: [],
    apis: [],
    dependencies: {},
  }

  // Find React/Vue components
  structure.components = files
    .filter(file => 
      file.includes('/components/') && 
      (file.endsWith('.tsx') || file.endsWith('.jsx') || file.endsWith('.vue'))
    )
    .slice(0, 20) // Limit for display

  // Find pages
  structure.pages = files
    .filter(file => 
      (file.includes('/pages/') || file.includes('/views/')) && 
      (file.endsWith('.tsx') || file.endsWith('.jsx') || file.endsWith('.vue'))
    )
    .slice(0, 20)

  // Find API routes
  structure.apis = files
    .filter(file => 
      file.includes('/api/') || 
      file.includes('/routes/') ||
      file.includes('route') ||
      file.includes('controller')
    )
    .slice(0, 20)

  // Extract routes from routing files
  const routingFiles = files.filter(file => 
    file.includes('router') || 
    file.includes('route') || 
    file.includes('App.tsx') ||
    file.includes('App.jsx')
  )

  // Simple route extraction (would need more sophisticated parsing in reality)
  structure.routes = structure.pages.map(page => {
    const pageName = page.split('/').pop()?.replace(/\.(tsx|jsx|vue)$/, '') || ''
    return {
      path: `/${pageName.toLowerCase()}`,
      component: pageName,
    }
  }).slice(0, 10)

  // Get package.json for dependencies
  try {
    const packageResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/package.json`,
      {
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      }
    )

    if (packageResponse.ok) {
      const packageData = await packageResponse.json()
      const packageContent = JSON.parse(atob(packageData.content))
      structure.dependencies = {
        ...packageContent.dependencies,
        ...packageContent.devDependencies,
      }
    }
  } catch (error) {
    console.log('Could not read package.json:', error)
  }

  return structure
}

async function scanRepositoryFiles(
  owner: string,
  repo: string,
  path: string,
  githubToken: string,
  maxDepth: number = 3,
  currentDepth: number = 0
): Promise<string[]> {
  
  if (currentDepth >= maxDepth) {
    return []
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`
  const response = await fetch(url, {
    headers: {
      'Authorization': `token ${githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  })

  if (!response.ok) {
    return []
  }

  const contents = await response.json()
  const files: string[] = []

  for (const item of contents) {
    if (item.type === 'file') {
      files.push(item.path)
    } else if (item.type === 'dir' && !item.name.startsWith('.') && item.name !== 'node_modules') {
      const subFiles = await scanRepositoryFiles(
        owner, 
        repo, 
        item.path, 
        githubToken, 
        maxDepth, 
        currentDepth + 1
      )
      files.push(...subFiles)
    }
  }

  return files
}

async function handlePullRequestOpened(supabaseClient: any, payload: any) {
  const repoId = payload.repository.id
  const prNumber = payload.number
  const prTitle = payload.pull_request.title
  const prBody = payload.pull_request.body

  // Find project by repository ID
  const { data: project } = await supabaseClient
    .from('projects')
    .select('*, profiles!projects_owner_id_fkey(github_token)')
    .eq('github_repo_id', repoId)
    .single()

  if (!project) {
    console.log(`No project found for repository ID: ${repoId}`)
    return
  }

  // Check if auto-run is enabled in project settings
  if (!project.settings?.auto_run_on_pr) {
    console.log('Auto-run on PR is disabled for this project')
    return
  }

  console.log(`Auto-generating tests for PR #${prNumber}: ${prTitle}`)

  // Trigger test generation for this PR
  const generateTestsUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-tests`
  
  try {
    await fetch(generateTestsUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectId: project.id,
        sourceType: 'github_pr',
        sourceData: {
          prUrl: payload.pull_request.html_url,
          prTitle,
          prBody,
        },
      }),
    })

    console.log('Successfully triggered test generation for PR')
  } catch (error) {
    console.error('Failed to trigger test generation for PR:', error)
  }
}