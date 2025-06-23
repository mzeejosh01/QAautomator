/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { useApp } from "@/App";
import { api } from "@/lib/supabase";
import GitHubIntegration from "@/components/GitHubIntegration";

const Settings = () => {
  const { profile, currentProject, refreshProjects } = useApp();
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Profile settings
  const [profileForm, setProfileForm] = useState({
    full_name: "",
    github_token: "",
    slack_webhook_url: "",
  });

  // Project settings
  const [projectForm, setProjectForm] = useState({
    name: "",
    description: "",
    staging_url: "",
    production_url: "",
    auto_run_on_pr: false,
    slack_notifications: true,
    email_notifications: false,
  });

  // Load initial data
  useEffect(() => {
    if (profile) {
      setProfileForm({
        full_name: profile.full_name || "",
        github_token: profile.github_token || "",
        slack_webhook_url: profile.slack_webhook_url || "",
      });
    }
  }, [profile]);

  useEffect(() => {
    if (currentProject) {
      setProjectForm({
        name: currentProject.name || "",
        description: currentProject.description || "",
        staging_url: currentProject.settings?.staging_url || "",
        production_url: currentProject.settings?.production_url || "",
        auto_run_on_pr: currentProject.settings?.auto_run_on_pr || false,
        slack_notifications:
          currentProject.settings?.slack_notifications || true,
        email_notifications:
          currentProject.settings?.email_notifications || false,
      });
    }
  }, [currentProject]);

  const handleProfileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setProfileForm((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const handleProjectInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setProjectForm((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const handleProjectSwitchChange = (name: string, checked: boolean) => {
    setProjectForm((prev) => ({
      ...prev,
      [name]: checked,
    }));
  };

  const handleSaveProfile = async () => {
    setIsSaving(true);

    try {
      await api.updateProfile({
        full_name: profileForm.full_name.trim() || undefined,
        github_token: profileForm.github_token.trim() || undefined,
        slack_webhook_url: profileForm.slack_webhook_url.trim() || undefined,
      });

      toast({
        title: "Profile Updated",
        description: "Your profile settings have been saved successfully.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update profile settings.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveProject = async () => {
    if (!currentProject) {
      toast({
        title: "No project selected",
        description: "Please select a project to update settings.",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);

    try {
      const updatedSettings = {
        ...currentProject.settings,
        staging_url: projectForm.staging_url.trim() || undefined,
        production_url: projectForm.production_url.trim() || undefined,
        auto_run_on_pr: projectForm.auto_run_on_pr,
        slack_notifications: projectForm.slack_notifications,
        email_notifications: projectForm.email_notifications,
      };

      await api.updateProject(currentProject.id, {
        name: projectForm.name.trim(),
        description: projectForm.description.trim() || undefined,
        settings: updatedSettings,
      });

      await refreshProjects();

      toast({
        title: "Project Updated",
        description: "Project settings have been saved successfully.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update project settings.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestSlack = async () => {
    if (!profileForm.slack_webhook_url.trim()) {
      toast({
        title: "No Slack webhook URL",
        description: "Please enter a Slack webhook URL first.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    toast({
      title: "Testing Slack Integration",
      description: "Sending test message...",
    });

    try {
      const response = await fetch(profileForm.slack_webhook_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: "🧪 QA Autopilot Test Message",
          attachments: [
            {
              color: "good",
              fields: [
                {
                  title: "Status",
                  value: "Slack integration is working correctly!",
                  short: false,
                },
              ],
            },
          ],
        }),
      });

      if (response.ok) {
        toast({
          title: "Slack Test Successful",
          description: "Test message sent successfully!",
        });
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error: any) {
      toast({
        title: "Slack Test Failed",
        description: error.message || "Failed to send test message.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestGitHub = async () => {
    if (!profileForm.github_token.trim()) {
      toast({
        title: "No GitHub token",
        description: "Please enter a GitHub token first.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    toast({
      title: "Testing GitHub Integration",
      description: "Validating GitHub token...",
    });

    try {
      const response = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `token ${profileForm.github_token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (response.ok) {
        const userData = await response.json();
        toast({
          title: "GitHub Test Successful",
          description: `Connected as ${userData.login}`,
        });
      } else {
        throw new Error(`HTTP ${response.status}: Invalid token`);
      }
    } catch (error: any) {
      toast({
        title: "GitHub Test Failed",
        description: error.message || "Failed to validate GitHub token.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      <h1 className="text-3xl font-bold text-gray-900">Settings</h1>

      {/* Profile Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Profile Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="full_name">Full Name</Label>
            <Input
              id="full_name"
              name="full_name"
              value={profileForm.full_name}
              onChange={handleProfileInputChange}
              placeholder="Your full name"
            />
          </div>

          <Separator />

          <div className="space-y-4">
            <h3 className="text-lg font-medium">GitHub Integration</h3>
            <div className="space-y-2">
              <Label htmlFor="github_token">GitHub Personal Access Token</Label>
              <div className="flex gap-2">
                <Input
                  id="github_token"
                  name="github_token"
                  type="password"
                  value={profileForm.github_token}
                  onChange={handleProfileInputChange}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  onClick={handleTestGitHub}
                  disabled={isLoading || !profileForm.github_token.trim()}
                >
                  Test
                </Button>
              </div>
              <p className="text-sm text-gray-500">
                Required permissions: repo, pull_requests.{" "}
                <a
                  href="https://github.com/settings/tokens"
                  className="text-blue-600 hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Generate token
                </a>
              </p>
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <h3 className="text-lg font-medium">Slack Integration</h3>
            <div className="space-y-2">
              <Label htmlFor="slack_webhook_url">Slack Webhook URL</Label>
              <div className="flex gap-2">
                <Input
                  id="slack_webhook_url"
                  name="slack_webhook_url"
                  type="password"
                  value={profileForm.slack_webhook_url}
                  onChange={handleProfileInputChange}
                  placeholder="https://hooks.slack.com/services/..."
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  onClick={handleTestSlack}
                  disabled={isLoading || !profileForm.slack_webhook_url.trim()}
                >
                  Test
                </Button>
              </div>
              <p className="text-sm text-gray-500">
                Messages will be sent to the configured channel when tests
                complete.
              </p>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleSaveProfile}
              disabled={isSaving}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isSaving ? "Saving..." : "Save Profile"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* GitHub Repository Integration */}
      <GitHubIntegration />

      {/* Project Settings */}
      {currentProject && (
        <Card>
          <CardHeader>
            <CardTitle>Project Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="project_name">Project Name</Label>
                <Input
                  id="project_name"
                  name="name"
                  value={projectForm.name}
                  onChange={handleProjectInputChange}
                  placeholder="Project name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="project_description">Description</Label>
                <Input
                  id="project_description"
                  name="description"
                  value={projectForm.description}
                  onChange={handleProjectInputChange}
                  placeholder="Project description"
                />
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <h3 className="text-lg font-medium">Environment URLs</h3>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="staging_url">Staging Environment</Label>
                  <Input
                    id="staging_url"
                    name="staging_url"
                    type="url"
                    value={projectForm.staging_url}
                    onChange={handleProjectInputChange}
                    placeholder="https://staging.yourapp.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="production_url">Production Environment</Label>
                  <Input
                    id="production_url"
                    name="production_url"
                    type="url"
                    value={projectForm.production_url}
                    onChange={handleProjectInputChange}
                    placeholder="https://yourapp.com"
                  />
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <h3 className="text-lg font-medium">Automation Settings</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">
                      Auto-run tests on PR creation
                    </div>
                    <div className="text-sm text-gray-500">
                      Automatically generate and run tests when a new PR is
                      created
                    </div>
                  </div>
                  <Switch
                    checked={projectForm.auto_run_on_pr}
                    onCheckedChange={(checked) =>
                      handleProjectSwitchChange("auto_run_on_pr", checked)
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Slack notifications</div>
                    <div className="text-sm text-gray-500">
                      Get notified in Slack when test runs complete
                    </div>
                  </div>
                  <Switch
                    checked={projectForm.slack_notifications}
                    onCheckedChange={(checked) =>
                      handleProjectSwitchChange("slack_notifications", checked)
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Email notifications</div>
                    <div className="text-sm text-gray-500">
                      Receive email alerts for failed test runs
                    </div>
                  </div>
                  <Switch
                    checked={projectForm.email_notifications}
                    onCheckedChange={(checked) =>
                      handleProjectSwitchChange("email_notifications", checked)
                    }
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleSaveProject}
                disabled={isSaving}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {isSaving ? "Saving..." : "Save Project Settings"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* System Information */}
      <Card>
        <CardHeader>
          <CardTitle>System Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="font-medium">Version</span>
                <Badge variant="outline">v1.0.0</Badge>
              </div>
              <div className="flex justify-between">
                <span className="font-medium">Last Updated</span>
                <span className="text-gray-600">June 22, 2025</span>
              </div>
              <div className="flex justify-between">
                <span className="font-medium">AI Model</span>
                <span className="text-gray-600">GPT-4</span>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="font-medium">Test Runner</span>
                <span className="text-gray-600">Selenium 4.15.0</span>
              </div>
              <div className="flex justify-between">
                <span className="font-medium">Status</span>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-green-600">Online</span>
                </div>
              </div>
              <div className="flex justify-between">
                <span className="font-medium">User ID</span>
                <span className="text-gray-600 font-mono text-xs">
                  {profile?.id?.slice(0, 8)}...
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Settings;
