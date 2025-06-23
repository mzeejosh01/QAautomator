/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Github,
  Search,
  Check,
  AlertCircle,
  Loader2,
  GitBranch,
  Star,
  Calendar,
  Folder,
  Cog,
  ExternalLink,
  ChevronRight,
  Info,
  Users,
} from "lucide-react";
import Header from "@/components/Header";
import Dashboard from "@/components/Dashboard";
import History from "@/components/History";
import Settings from "@/components/Settings";
import { useApp } from "@/App";
import { api, auth } from "@/lib/supabase";
import { toast } from "@/hooks/use-toast";

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

const Index = () => {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // Enhanced project creation state
  const [currentStep, setCurrentStep] = useState(1);
  const [hasGitHubAccess, setHasGitHubAccess] = useState(false);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const [repoAnalysis, setRepoAnalysis] = useState<RepositoryAnalysis | null>(
    null
  );
  const [analyzingRepo, setAnalyzingRepo] = useState(false);

  const [projectForm, setProjectForm] = useState({
    name: "",
    description: "",
    staging_url: "",
    production_url: "",
    auto_run_on_pr: true,
    slack_notifications: true,
  });

  const {
    currentProject,
    refreshProjects,
    setCurrentProject,
    isLoading,
    profile,
  } = useApp();

  // Check GitHub access when dialog opens
  useEffect(() => {
    if (showCreateProject && profile) {
      checkGitHubAccess();
    }
  }, [showCreateProject, profile]);

  // Load repositories when GitHub access is confirmed
  useEffect(() => {
    if (hasGitHubAccess) {
      loadRepositories();
    }
  }, [hasGitHubAccess]);

  // Auto-populate project name when repo is selected
  useEffect(() => {
    if (selectedRepo) {
      setProjectForm((prev) => ({
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

  const handleCreateProject = () => {
    setShowCreateProject(true);
    setCurrentStep(1);
  };

  const handleCloseCreateProject = () => {
    setShowCreateProject(false);
    setCurrentStep(1);
    setSelectedRepo(null);
    setRepoAnalysis(null);
    setRepositories([]);
    setSearchTerm("");
    setProjectForm({
      name: "",
      description: "",
      staging_url: "",
      production_url: "",
      auto_run_on_pr: true,
      slack_notifications: true,
    });
  };

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
      setIsCreating(true);

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
      setIsCreating(false);
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

      // Create analysis results based on repository structure
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
      setCurrentStep(3); // Move to configuration step
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

  const handleSubmitProject = async () => {
    if (!selectedRepo) {
      toast({
        title: "Repository Required",
        description: "Please select a repository to continue.",
        variant: "destructive",
      });
      return;
    }

    setIsCreating(true);
    try {
      // Create project with repository information
      const newProject = await api.createProject({
        name: projectForm.name,
        description: projectForm.description,
        repository_url: selectedRepo.html_url,
        repository_name: selectedRepo.full_name,
        github_repo_id: selectedRepo.id,
        settings: {
          staging_url: projectForm.staging_url || undefined,
          production_url: projectForm.production_url || undefined,
          auto_run_on_pr: projectForm.auto_run_on_pr,
          slack_notifications: projectForm.slack_notifications,
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
      }

      // Generate initial test cases
      if (repoAnalysis) {
        try {
          await api.generateTests(newProject.id, "repository_analysis", {
            repositoryStructure: {
              framework: repoAnalysis.framework,
              components: repoAnalysis.components,
              pages: repoAnalysis.pages,
              recommended_tests: repoAnalysis.recommended_tests,
            },
          });
        } catch (generateError) {
          console.warn("Initial test generation failed:", generateError);
        }
      }

      await refreshProjects();
      setCurrentProject(newProject);

      toast({
        title: "Project Created Successfully!",
        description: `${projectForm.name} is ready for QA automation with ${
          repoAnalysis?.testable_elements || 0
        } testable elements identified.`,
      });

      handleCloseCreateProject();
    } catch (error: any) {
      toast({
        title: "Project Creation Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setProjectForm((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const filteredRepositories = repositories.filter(
    (repo) =>
      repo.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      repo.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading...</p>
          </div>
        </div>
      );
    }

    if (!currentProject) {
      return (
        <div className="max-w-4xl mx-auto px-6 py-16">
          <div className="text-center">
            <div className="w-16 h-16 bg-blue-600 rounded-lg mx-auto mb-6 flex items-center justify-center">
              <span className="text-white font-bold text-xl">QA</span>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Welcome to QA Autopilot!
            </h2>
            <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
              Let's get started by connecting your first GitHub repository.
              We'll analyze your code and create intelligent test cases
              automatically.
            </p>

            <div className="bg-white rounded-lg shadow-sm border p-6 mb-8 text-left max-w-md mx-auto">
              <h3 className="font-semibold mb-3">What happens next:</h3>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  Connect your GitHub repository
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  AI analyzes your code structure
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  Intelligent test cases are generated
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  Automated testing begins!
                </li>
              </ul>
            </div>

            <Button
              onClick={handleCreateProject}
              className="bg-blue-600 hover:bg-blue-700 px-8 py-3 text-lg"
            >
              Create Your First Project
            </Button>

            {!profile?.github_token && (
              <p className="text-sm text-gray-500 mt-4">
                You'll need to connect your GitHub account first
              </p>
            )}
          </div>
        </div>
      );
    }

    switch (activeTab) {
      case "dashboard":
        return <Dashboard />;
      case "history":
        return <History />;
      case "settings":
        return <Settings />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onCreateProject={handleCreateProject}
      />
      <main>{renderContent()}</main>

      {/* Enhanced Create Project Dialog */}
      <Dialog open={showCreateProject} onOpenChange={setShowCreateProject}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="flex items-center gap-2">
                  <Github className="w-5 h-5" />
                  Create New Project
                </DialogTitle>
                <DialogDescription>
                  Connect your GitHub repository for intelligent QA automation
                </DialogDescription>
              </div>
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
          </DialogHeader>

          <div className="space-y-6 py-4">
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
                  disabled={isCreating}
                  className="bg-black hover:bg-gray-800"
                >
                  {isCreating ? (
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
                  <div className="space-y-2 max-h-64 overflow-y-auto">
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
                    <span className="font-medium">
                      {selectedRepo.full_name}
                    </span>
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
                        name="name"
                        value={projectForm.name}
                        onChange={handleInputChange}
                        placeholder="My QA Project"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="staging-url">
                        Staging URL (Optional)
                      </Label>
                      <Input
                        id="staging-url"
                        name="staging_url"
                        type="url"
                        value={projectForm.staging_url}
                        onChange={handleInputChange}
                        placeholder="https://staging.myapp.com"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      name="description"
                      value={projectForm.description}
                      onChange={handleInputChange}
                      placeholder="QA automation for my application"
                      rows={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="production-url">
                      Production URL (Optional)
                    </Label>
                    <Input
                      id="production-url"
                      name="production_url"
                      type="url"
                      value={projectForm.production_url}
                      onChange={handleInputChange}
                      placeholder="https://myapp.com"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleCloseCreateProject}
              disabled={isCreating}
            >
              Cancel
            </Button>
            {selectedRepo && repoAnalysis && (
              <Button
                onClick={handleSubmitProject}
                disabled={isCreating || !projectForm.name}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating Project...
                  </>
                ) : (
                  <>
                    <Cog className="w-4 h-4 mr-2" />
                    Create Project & Setup Automation
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Index;
