/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Github,
  Search,
  Check,
  AlertCircle,
  Loader2,
  GitBranch,
  Star,
  Users,
  Calendar,
  Folder,
  Settings,
  ExternalLink,
  ChevronRight,
  Info,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useApp } from "@/App";
import { api, auth } from "@/lib/supabase";

interface Repository {
  id: number;
  name: string;
  full_name: string;
  description?: string;
  private: boolean;
  html_url: string;
  language?: string;
  stargazers_count: number;
  forks_count: number;
  updated_at: string;
  owner: {
    login: string;
    avatar_url: string;
  };
}

interface RepositoryAnalysis {
  framework: string;
  components: string[];
  pages: string[];
  testable_elements: number;
  complexity_score: number;
  recommended_tests: string[];
}

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { profile, refreshProjects } = useApp();

  // Steps in the creation flow
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);

  // GitHub integration state
  const [hasGitHubAccess, setHasGitHubAccess] = useState(false);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loadingRepos, setLoadingRepos] = useState(false);

  // Selected repository and analysis
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const [repoAnalysis, setRepoAnalysis] = useState<RepositoryAnalysis | null>(
    null
  );
  const [analyzingRepo, setAnalyzingRepo] = useState(false);

  // Project configuration
  const [projectConfig, setProjectConfig] = useState({
    name: "",
    description: "",
    staging_url: "",
    production_url: "",
    auto_run_on_pr: true,
    slack_notifications: true,
  });

  // Check GitHub access on mount
  useEffect(() => {
    if (isOpen && profile) {
      checkGitHubAccess();
    }
  }, [isOpen, profile]);

  // Load repositories when GitHub access is confirmed
  useEffect(() => {
    if (hasGitHubAccess) {
      loadRepositories();
    }
  }, [hasGitHubAccess]);

  // Auto-populate project name when repo is selected
  useEffect(() => {
    if (selectedRepo) {
      setProjectConfig((prev) => ({
        ...prev,
        name: selectedRepo.name
          .replace(/[-_]/g, " ")
          .replace(/\b\w/g, (l) => l.toUpperCase()),
        description:
          selectedRepo.description || `QA Automation for ${selectedRepo.name}`,
      }));
      analyzeRepository();
    }
  }, [selectedRepo]);

  const checkGitHubAccess = async () => {
    if (!profile?.github_token) {
      setHasGitHubAccess(false);
      return;
    }

    try {
      const response = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `token ${profile.github_token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      setHasGitHubAccess(response.ok);
    } catch (error) {
      setHasGitHubAccess(false);
    }
  };

  const connectGitHub = async () => {
    try {
      setIsLoading(true);

      // Redirect to GitHub OAuth with repo scope
      const { error } = await auth.signInWithGitHub();

      if (error) {
        toast({
          title: "GitHub Connection Failed",
          description: error.message,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to connect to GitHub",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadRepositories = async () => {
    if (!profile?.github_token) return;

    setLoadingRepos(true);
    try {
      const response = await fetch(
        "https://api.github.com/user/repos?sort=updated&per_page=50",
        {
          headers: {
            Authorization: `token ${profile.github_token}`,
            Accept: "application/vnd.github.v3+json",
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch repositories");
      }

      const repos = await response.json();
      setRepositories(repos);
    } catch (error: any) {
      toast({
        title: "Failed to load repositories",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoadingRepos(false);
    }
  };

  const analyzeRepository = async () => {
    if (!selectedRepo || !profile?.github_token) return;

    setAnalyzingRepo(true);
    try {
      const analysis = await api.analyzeRepository(
        selectedRepo.html_url,
        profile.github_token
      );

      // Simulate analysis results based on repository structure
      const mockAnalysis: RepositoryAnalysis = {
        framework: analysis.structure.dependencies.react
          ? "React"
          : analysis.structure.dependencies.vue
          ? "Vue"
          : analysis.structure.dependencies.angular
          ? "Angular"
          : "Web",
        components: analysis.structure.components.slice(0, 10),
        pages: analysis.structure.pages.slice(0, 10),
        testable_elements:
          analysis.structure.components.length +
          analysis.structure.pages.length,
        complexity_score: Math.min(
          10,
          Math.max(
            1,
            Math.round(
              analysis.structure.components.length * 0.3 +
                analysis.structure.pages.length * 0.5 +
                Object.keys(analysis.structure.dependencies).length * 0.1
            )
          )
        ),
        recommended_tests: [
          "Authentication Flow Tests",
          "Navigation Tests",
          "Form Validation Tests",
          "API Integration Tests",
          "Responsive Design Tests",
        ],
      };

      setRepoAnalysis(mockAnalysis);
    } catch (error: any) {
      toast({
        title: "Repository Analysis Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setAnalyzingRepo(false);
    }
  };

  const createProject = async () => {
    if (!selectedRepo) {
      toast({
        title: "Repository Required",
        description: "Please select a repository to continue.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      // Create project with repository information
      const newProject = await api.createProject({
        name: projectConfig.name,
        description: projectConfig.description,
        repository_url: selectedRepo.html_url,
        repository_name: selectedRepo.full_name,
        github_repo_id: selectedRepo.id,
        settings: {
          staging_url: projectConfig.staging_url || undefined,
          production_url: projectConfig.production_url || undefined,
          auto_run_on_pr: projectConfig.auto_run_on_pr,
          slack_notifications: projectConfig.slack_notifications,
          framework: repoAnalysis?.framework,
          complexity_score: repoAnalysis?.complexity_score,
        },
      });

      // Setup GitHub webhook automatically
      try {
        await api.setupGitHubWebhook(
          newProject.id,
          selectedRepo.html_url,
          profile!.github_token!
        );
      } catch (webhookError) {
        console.warn("Webhook setup failed:", webhookError);
        // Don't fail project creation if webhook fails
      }

      // Generate initial test cases based on repository analysis
      if (repoAnalysis) {
        try {
          await api.generateFunctionalTests(
            newProject.id,
            "repository_analysis",
            {
              repositoryStructure: {
                framework: repoAnalysis.framework,
                components: repoAnalysis.components,
                pages: repoAnalysis.pages,
                recommended_tests: repoAnalysis.recommended_tests,
              },
            }
          );
        } catch (generateError) {
          console.warn("Initial test generation failed:", generateError);
          // Don't fail project creation if test generation fails
        }
      }

      await refreshProjects();

      toast({
        title: "Project Created Successfully!",
        description: `${projectConfig.name} is ready for QA automation with ${
          repoAnalysis?.testable_elements || 0
        } testable elements identified.`,
      });

      onSuccess();
      handleClose();
    } catch (error: any) {
      toast({
        title: "Project Creation Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setCurrentStep(1);
    setSelectedRepo(null);
    setRepoAnalysis(null);
    setProjectConfig({
      name: "",
      description: "",
      staging_url: "",
      production_url: "",
      auto_run_on_pr: true,
      slack_notifications: true,
    });
    onClose();
  };

  const filteredRepositories = repositories.filter(
    (repo) =>
      repo.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      repo.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Github className="w-5 h-5" />
                Create New Project
              </CardTitle>
              <p className="text-sm text-gray-600 mt-1">
                Connect your GitHub repository for intelligent QA automation
              </p>
            </div>
            <Button variant="ghost" onClick={handleClose}>
              ×
            </Button>
          </div>

          {/* Progress Steps */}
          <div className="flex items-center gap-4 mt-4">
            <div
              className={`flex items-center gap-2 ${
                currentStep >= 1 ? "text-blue-600" : "text-gray-400"
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  currentStep >= 1 ? "bg-blue-600 text-white" : "bg-gray-200"
                }`}
              >
                {hasGitHubAccess ? <Check className="w-4 h-4" /> : "1"}
              </div>
              <span className="text-sm font-medium">Connect GitHub</span>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-400" />
            <div
              className={`flex items-center gap-2 ${
                currentStep >= 2 ? "text-blue-600" : "text-gray-400"
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  currentStep >= 2 ? "bg-blue-600 text-white" : "bg-gray-200"
                }`}
              >
                {selectedRepo ? <Check className="w-4 h-4" /> : "2"}
              </div>
              <span className="text-sm font-medium">Select Repository</span>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-400" />
            <div
              className={`flex items-center gap-2 ${
                currentStep >= 3 ? "text-blue-600" : "text-gray-400"
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  currentStep >= 3 ? "bg-blue-600 text-white" : "bg-gray-200"
                }`}
              >
                3
              </div>
              <span className="text-sm font-medium">Configure Project</span>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Step 1: GitHub Connection */}
          {!hasGitHubAccess && (
            <div className="text-center py-8">
              <Github className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                Connect Your GitHub Account
              </h3>
              <p className="text-gray-600 mb-6">
                We need access to your repositories to analyze code structure
                and set up automated testing.
              </p>

              <Alert className="mb-6 text-left">
                <Info className="h-4 w-4" />
                <AlertDescription>
                  <strong>Permissions needed:</strong>
                  <ul className="list-disc list-inside mt-2 text-sm">
                    <li>Read repository contents (for code analysis)</li>
                    <li>Create webhooks (for automatic test triggers)</li>
                    <li>Read pull requests (for PR-based testing)</li>
                  </ul>
                </AlertDescription>
              </Alert>

              <Button
                onClick={connectGitHub}
                disabled={isLoading}
                className="bg-black hover:bg-gray-800"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Github className="w-4 h-4 mr-2" />
                    Connect GitHub Account
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Step 2: Repository Selection */}
          {hasGitHubAccess && !selectedRepo && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-2">
                  Select Repository
                </h3>
                <p className="text-gray-600">
                  Choose the repository you want to create QA automation for.
                </p>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Search repositories..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>

              {loadingRepos ? (
                <div className="text-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
                  <p className="text-gray-600">Loading repositories...</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {filteredRepositories.map((repo) => (
                    <div
                      key={repo.id}
                      onClick={() => {
                        setSelectedRepo(repo);
                        setCurrentStep(2);
                      }}
                      className="p-4 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium">{repo.name}</span>
                            {repo.private && (
                              <Badge variant="secondary" className="text-xs">
                                Private
                              </Badge>
                            )}
                            {repo.language && (
                              <Badge variant="outline" className="text-xs">
                                {repo.language}
                              </Badge>
                            )}
                          </div>
                          {repo.description && (
                            <p className="text-sm text-gray-600 mb-2">
                              {repo.description}
                            </p>
                          )}
                          <div className="flex items-center gap-4 text-xs text-gray-500">
                            <span className="flex items-center gap-1">
                              <Star className="w-3 h-3" />
                              {repo.stargazers_count}
                            </span>
                            <span className="flex items-center gap-1">
                              <GitBranch className="w-3 h-3" />
                              {repo.forks_count}
                            </span>
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {new Date(repo.updated_at).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <ExternalLink className="w-4 h-4 text-gray-400" />
                      </div>
                    </div>
                  ))}

                  {filteredRepositories.length === 0 && !loadingRepos && (
                    <div className="text-center py-8">
                      <Folder className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-600">No repositories found.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Repository Analysis & Project Configuration */}
          {selectedRepo && (
            <div className="space-y-6">
              {/* Selected Repository Info */}
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium">Selected Repository</h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedRepo(null);
                      setRepoAnalysis(null);
                      setCurrentStep(1);
                    }}
                  >
                    Change
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Github className="w-4 h-4" />
                  <span className="font-medium">{selectedRepo.full_name}</span>
                  {selectedRepo.language && (
                    <Badge variant="outline" className="text-xs">
                      {selectedRepo.language}
                    </Badge>
                  )}
                </div>
                {selectedRepo.description && (
                  <p className="text-sm text-gray-600 mt-1">
                    {selectedRepo.description}
                  </p>
                )}
              </div>

              {/* Repository Analysis */}
              {analyzingRepo && (
                <div className="text-center py-6">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
                  <p className="font-medium">
                    Analyzing Repository Structure...
                  </p>
                  <p className="text-sm text-gray-600">
                    Identifying components, pages, and testable elements
                  </p>
                </div>
              )}

              {repoAnalysis && (
                <div className="space-y-4">
                  <h4 className="font-medium">Repository Analysis</h4>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center p-3 bg-gray-50 rounded-lg">
                      <div className="text-2xl font-bold text-blue-600">
                        {repoAnalysis.framework}
                      </div>
                      <div className="text-xs text-gray-600">Framework</div>
                    </div>
                    <div className="text-center p-3 bg-gray-50 rounded-lg">
                      <div className="text-2xl font-bold text-green-600">
                        {repoAnalysis.testable_elements}
                      </div>
                      <div className="text-xs text-gray-600">
                        Testable Elements
                      </div>
                    </div>
                    <div className="text-center p-3 bg-gray-50 rounded-lg">
                      <div className="text-2xl font-bold text-purple-600">
                        {repoAnalysis.complexity_score}/10
                      </div>
                      <div className="text-xs text-gray-600">Complexity</div>
                    </div>
                    <div className="text-center p-3 bg-gray-50 rounded-lg">
                      <div className="text-2xl font-bold text-orange-600">
                        {repoAnalysis.recommended_tests.length}
                      </div>
                      <div className="text-xs text-gray-600">Test Suites</div>
                    </div>
                  </div>

                  <div className="p-4 bg-green-50 rounded-lg">
                    <h5 className="font-medium text-green-800 mb-2">
                      Recommended Test Coverage
                    </h5>
                    <div className="flex flex-wrap gap-2">
                      {repoAnalysis.recommended_tests.map((test, index) => (
                        <Badge
                          key={index}
                          variant="secondary"
                          className="bg-green-100 text-green-800"
                        >
                          {test}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <Separator />

              {/* Project Configuration */}
              <div className="space-y-4">
                <h4 className="font-medium">Project Configuration</h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="project-name">Project Name</Label>
                    <Input
                      id="project-name"
                      value={projectConfig.name}
                      onChange={(e) =>
                        setProjectConfig((prev) => ({
                          ...prev,
                          name: e.target.value,
                        }))
                      }
                      placeholder="My QA Project"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="staging-url">Staging URL (Optional)</Label>
                    <Input
                      id="staging-url"
                      type="url"
                      value={projectConfig.staging_url}
                      onChange={(e) =>
                        setProjectConfig((prev) => ({
                          ...prev,
                          staging_url: e.target.value,
                        }))
                      }
                      placeholder="https://staging.myapp.com"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Input
                    id="description"
                    value={projectConfig.description}
                    onChange={(e) =>
                      setProjectConfig((prev) => ({
                        ...prev,
                        description: e.target.value,
                      }))
                    }
                    placeholder="QA automation for my application"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="production-url">
                    Production URL (Optional)
                  </Label>
                  <Input
                    id="production-url"
                    type="url"
                    value={projectConfig.production_url}
                    onChange={(e) =>
                      setProjectConfig((prev) => ({
                        ...prev,
                        production_url: e.target.value,
                      }))
                    }
                    placeholder="https://myapp.com"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  onClick={createProject}
                  disabled={isLoading || !projectConfig.name}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating Project...
                    </>
                  ) : (
                    <>
                      <Settings className="w-4 h-4 mr-2" />
                      Create Project & Setup Automation
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CreateProjectModal;
