/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Header from "@/components/Header";
import Dashboard from "@/components/Dashboard";
import History from "@/components/History";
import Settings from "@/components/Settings";
import { useApp } from "@/App";
import { api } from "@/lib/supabase";
import { toast } from "@/hooks/use-toast";

const Index = () => {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [projectForm, setProjectForm] = useState({
    name: "",
    description: "",
    repositoryUrl: "",
  });

  const { currentProject, refreshProjects, setCurrentProject, isLoading } =
    useApp();

  const handleCreateProject = () => {
    setShowCreateProject(true);
  };

  const handleCloseCreateProject = () => {
    setShowCreateProject(false);
    setProjectForm({ name: "", description: "", repositoryUrl: "" });
  };

  const handleSubmitProject = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!projectForm.name.trim()) {
      toast({
        title: "Error",
        description: "Project name is required.",
        variant: "destructive",
      });
      return;
    }

    setIsCreating(true);

    try {
      const newProject = await api.createProject({
        name: projectForm.name.trim(),
        description: projectForm.description.trim() || undefined,
        repository_url: projectForm.repositoryUrl.trim() || undefined,
        settings: {},
      });

      await refreshProjects();
      setCurrentProject(newProject);

      toast({
        title: "Project created",
        description: `Successfully created ${newProject.name}`,
      });

      handleCloseCreateProject();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create project.",
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
            <div className="w-16 h-16 bg-gray-100 rounded-full mx-auto mb-6 flex items-center justify-center">
              <span className="text-gray-400 font-bold text-xl">QA</span>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Welcome to QA Autopilot
            </h2>
            <p className="text-gray-600 mb-8">
              Get started by creating your first project to begin automating
              your QA processes.
            </p>
            <Button
              onClick={handleCreateProject}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Create Your First Project
            </Button>
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

      {/* Create Project Dialog */}
      <Dialog open={showCreateProject} onOpenChange={setShowCreateProject}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleSubmitProject}>
            <DialogHeader>
              <DialogTitle>Create New Project</DialogTitle>
              <DialogDescription>
                Create a new QA automation project to get started with test
                generation and execution.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Project Name *</Label>
                <Input
                  id="name"
                  name="name"
                  placeholder="My Awesome Project"
                  value={projectForm.name}
                  onChange={handleInputChange}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  name="description"
                  placeholder="Brief description of your project..."
                  value={projectForm.description}
                  onChange={handleInputChange}
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="repositoryUrl">Repository URL (Optional)</Label>
                <Input
                  id="repositoryUrl"
                  name="repositoryUrl"
                  type="url"
                  placeholder="https://github.com/username/repository"
                  value={projectForm.repositoryUrl}
                  onChange={handleInputChange}
                />
              </div>
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
              <Button
                type="submit"
                disabled={isCreating}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {isCreating ? "Creating..." : "Create Project"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Index;
