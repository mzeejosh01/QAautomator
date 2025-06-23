/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "@/hooks/use-toast";
import {
  Github,
  GitBranch,
  Folder,
  ExternalLink,
  CheckCircle,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { useApp } from "@/App";
import { api } from "@/lib/supabase";

interface RepositoryStructure {
  components: string[];
  pages: string[];
  routes: Array<{ path: string; component: string }>;
  apis: string[];
  dependencies: Record<string, string>;
}

const GitHubIntegration = () => {
  const { profile, currentProject, refreshProjects } = useApp();
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSettingUpWebhook, setIsSettingUpWebhook] = useState(false);
  const [repoStructure, setRepoStructure] =
    useState<RepositoryStructure | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const hasGitHubToken = !!profile?.github_token;
  const projectHasRepo = !!currentProject?.repository_url;

  const handleAnalyzeRepository = async () => {
    if (!hasGitHubToken) {
      toast({
        title: "GitHub token required",
        description:
          "Please configure your GitHub token in profile settings first.",
        variant: "destructive",
      });
      return;
    }

    if (!repositoryUrl.trim()) {
      toast({
        title: "Repository URL required",
        description: "Please enter a GitHub repository URL.",
        variant: "destructive",
      });
      return;
    }

    // Validate GitHub URL format
    const githubUrlPattern = /^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/;
    if (!githubUrlPattern.test(repositoryUrl.trim())) {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid GitHub repository URL.",
        variant: "destructive",
      });
      return;
    }

    setIsAnalyzing(true);
    setAnalysisError(null);
    setRepoStructure(null);

    try {
      toast({
        title: "Analyzing repository...",
        description:
          "Scanning code structure and identifying testable components.",
      });

      const result = await api.analyzeRepository(
        repositoryUrl.trim(),
        profile!.github_token!
      );

      setRepoStructure(result.structure);

      toast({
        title: "Repository Analyzed!",
        description: `Found ${result.structure.components.length} components and ${result.structure.pages.length} pages ready for testing.`,
      });
    } catch (error: any) {
      const errorMessage = error.message || "Failed to analyze repository";
      setAnalysisError(errorMessage);

      toast({
        title: "Analysis Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSetupWebhook = async () => {
    if (!currentProject) {
      toast({
        title: "No project selected",
        description: "Please select a project first.",
        variant: "destructive",
      });
      return;
    }

    if (!hasGitHubToken) {
      toast({
        title: "GitHub token required",
        description:
          "Please configure your GitHub token in profile settings first.",
        variant: "destructive",
      });
      return;
    }

    const urlToUse = repositoryUrl.trim() || currentProject.repository_url;
    if (!urlToUse) {
      toast({
        title: "Repository URL required",
        description:
          "Please enter a repository URL or set one in project settings.",
        variant: "destructive",
      });
      return;
    }

    setIsSettingUpWebhook(true);

    try {
      toast({
        title: "Setting up webhook...",
        description:
          "Configuring GitHub webhook for automatic test generation.",
      });

      const result = await api.setupGitHubWebhook(
        currentProject.id,
        urlToUse,
        profile!.github_token!
      );

      await refreshProjects();

      toast({
        title: "Webhook Setup Complete!",
        description:
          "Tests will now be automatically generated for new pull requests.",
      });
    } catch (error: any) {
      toast({
        title: "Webhook Setup Failed",
        description: error.message || "Failed to setup GitHub webhook.",
        variant: "destructive",
      });
    } finally {
      setIsSettingUpWebhook(false);
    }
  };

  const handleGenerateFromAnalysis = async () => {
    if (!currentProject || !repoStructure) return;

    try {
      toast({
        title: "Generating tests from repository...",
        description: "Creating test cases based on analyzed code structure.",
      });

      await api.generateTests(currentProject.id, "repository_analysis", {
        repositoryStructure: repoStructure,
      });

      toast({
        title: "Tests Generated!",
        description:
          "Test cases have been created based on your repository structure.",
      });
    } catch (error: any) {
      toast({
        title: "Generation Failed",
        description:
          error.message || "Failed to generate tests from repository analysis.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Status Alert */}
      {!hasGitHubToken && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            GitHub integration requires a personal access token. Please
            configure it in your profile settings above.
          </AlertDescription>
        </Alert>
      )}

      {/* Repository Analysis */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Github className="w-5 h-5" />
            Repository Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-gray-600">
            Analyze your GitHub repository to understand its structure and
            generate intelligent test cases.
          </p>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Repository URL</label>
              <Input
                type="url"
                placeholder="https://github.com/username/repository"
                value={repositoryUrl}
                onChange={(e) => setRepositoryUrl(e.target.value)}
                disabled={isAnalyzing}
              />
            </div>

            <div className="space-y-2">
              <h4 className="font-medium">What we'll analyze:</h4>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• React/Vue components and their props</li>
                <li>• Form elements and interactive buttons</li>
                <li>• API endpoints and integrations</li>
                <li>• Route structure and navigation paths</li>
                <li>• Dependencies and frameworks used</li>
              </ul>
            </div>

            <Button
              onClick={handleAnalyzeRepository}
              disabled={isAnalyzing || !hasGitHubToken}
              className="w-full"
            >
              {isAnalyzing ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing Repository...
                </>
              ) : (
                <>
                  <Github className="w-4 h-4 mr-2" />
                  Analyze Repository
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Analysis Error */}
      {analysisError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{analysisError}</AlertDescription>
        </Alert>
      )}

      {/* Repository Analysis Results */}
      {repoStructure && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Repository Analysis Results</CardTitle>
            <Button
              onClick={handleGenerateFromAnalysis}
              disabled={!currentProject}
            >
              Generate Tests from Analysis
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Components */}
            <div>
              <h4 className="font-medium mb-3 flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                Testable Components ({repoStructure.components.length})
              </h4>
              {repoStructure.components.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                  {repoStructure.components
                    .slice(0, 20)
                    .map((component, index) => (
                      <div
                        key={index}
                        className="text-sm bg-gray-50 p-2 rounded border"
                      >
                        <span className="font-mono">{component}</span>
                      </div>
                    ))}
                  {repoStructure.components.length > 20 && (
                    <div className="text-sm text-gray-500 col-span-2">
                      ... and {repoStructure.components.length - 20} more
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-500">No components found</p>
              )}
            </div>

            {/* Pages */}
            <div>
              <h4 className="font-medium mb-3 flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                Pages ({repoStructure.pages.length})
              </h4>
              {repoStructure.pages.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                  {repoStructure.pages.slice(0, 20).map((page, index) => (
                    <div
                      key={index}
                      className="text-sm bg-gray-50 p-2 rounded border"
                    >
                      <span className="font-mono">{page}</span>
                    </div>
                  ))}
                  {repoStructure.pages.length > 20 && (
                    <div className="text-sm text-gray-500 col-span-2">
                      ... and {repoStructure.pages.length - 20} more
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-500">No pages found</p>
              )}
            </div>

            {/* Routes */}
            {repoStructure.routes.length > 0 && (
              <div>
                <h4 className="font-medium mb-3 flex items-center gap-2">
                  <GitBranch className="w-4 h-4" />
                  Discovered Routes ({repoStructure.routes.length})
                </h4>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {repoStructure.routes.slice(0, 10).map((route, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between text-sm bg-gray-50 p-2 rounded border"
                    >
                      <span className="font-mono">{route.path}</span>
                      <span className="text-gray-600">{route.component}</span>
                    </div>
                  ))}
                  {repoStructure.routes.length > 10 && (
                    <div className="text-sm text-gray-500">
                      ... and {repoStructure.routes.length - 10} more routes
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* APIs */}
            {repoStructure.apis.length > 0 && (
              <div>
                <h4 className="font-medium mb-3 flex items-center gap-2">
                  <ExternalLink className="w-4 h-4" />
                  API Endpoints ({repoStructure.apis.length})
                </h4>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {repoStructure.apis.slice(0, 10).map((api, index) => (
                    <div
                      key={index}
                      className="text-sm bg-gray-50 p-2 rounded border"
                    >
                      <span className="font-mono">{api}</span>
                    </div>
                  ))}
                  {repoStructure.apis.length > 10 && (
                    <div className="text-sm text-gray-500">
                      ... and {repoStructure.apis.length - 10} more endpoints
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Dependencies */}
            {Object.keys(repoStructure.dependencies).length > 0 && (
              <div>
                <h4 className="font-medium mb-3 flex items-center gap-2">
                  <Folder className="w-4 h-4" />
                  Key Dependencies
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-32 overflow-y-auto">
                  {Object.entries(repoStructure.dependencies)
                    .slice(0, 12)
                    .map(([name, version]) => (
                      <Badge key={name} variant="outline" className="text-xs">
                        {name}@{version}
                      </Badge>
                    ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Webhook Setup */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Github className="w-5 h-5" />
            Automatic Test Generation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            {projectHasRepo ? (
              <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
            )}
            <div className="flex-1">
              <p className="text-gray-600 mb-4">
                Set up a GitHub webhook to automatically generate test cases
                when new pull requests are created.
              </p>

              {projectHasRepo && (
                <div className="mb-4">
                  <p className="text-sm text-green-600 mb-2">
                    ✓ Repository configured: {currentProject?.repository_name}
                  </p>
                </div>
              )}

              <Button
                onClick={handleSetupWebhook}
                disabled={
                  isSettingUpWebhook || !hasGitHubToken || !currentProject
                }
                variant={projectHasRepo ? "outline" : "default"}
              >
                {isSettingUpWebhook ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Setting up webhook...
                  </>
                ) : (
                  <>
                    <Github className="w-4 h-4 mr-2" />
                    {projectHasRepo ? "Update Webhook" : "Setup Webhook"}
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="text-sm text-gray-500 space-y-1">
            <p>
              <strong>What happens:</strong>
            </p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Webhook monitors your repository for new pull requests</li>
              <li>AI analyzes PR changes and generates relevant test cases</li>
              <li>Tests are automatically added to your project</li>
              <li>
                Optional: Tests can be automatically executed on your chosen
                environment
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default GitHubIntegration;
