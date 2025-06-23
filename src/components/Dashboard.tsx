/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Upload,
  RefreshCw,
  Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { useApp } from "@/App";
import {
  api,
  supabase, // Direct import for auth
  subscriptions,
  type TestCase,
  type TestRun,
} from "@/lib/supabase";

const Dashboard = () => {
  const { currentProject } = useApp();
  const [input, setInput] = useState("");
  const [environment, setEnvironment] = useState("staging");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [selectedTestCases, setSelectedTestCases] = useState<Set<string>>(
    new Set()
  );
  const [currentTestRun, setCurrentTestRun] = useState<TestRun | null>(null);
  const [expandedTests, setExpandedTests] = useState<Set<string>>(new Set());
  const [testProgress, setTestProgress] = useState({
    current: 0,
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
  });

  // Load test cases when project changes
  useEffect(() => {
    if (currentProject) {
      loadTestCases();
    }
  }, [currentProject]);

  // Subscribe to test run updates
  useEffect(() => {
    if (!currentProject || !currentTestRun) return;

    const subscription = subscriptions.subscribeToTestRuns(
      currentProject.id,
      (payload) => {
        if (payload.new && payload.new.id === currentTestRun.id) {
          setCurrentTestRun(payload.new);

          // Update progress from realtime subscription
          setTestProgress((prev) => ({
            ...prev,
            passed: payload.new.passed_tests || 0,
            failed: payload.new.failed_tests || 0,
            skipped: 0, // Not tracked in the schema
          }));

          if (
            payload.new.status === "completed" ||
            payload.new.status === "failed"
          ) {
            setIsRunning(false);
            toast({
              title: "Test Run Complete",
              description: `${payload.new.passed_tests}/${payload.new.total_tests} tests passed`,
            });

            // Reload test history after completion
            setTimeout(() => {
              loadTestCases();
            }, 1000);
          }
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [currentProject, currentTestRun]);

  const loadTestCases = async () => {
    if (!currentProject) return;

    try {
      const data = await api.getTestCases(currentProject.id);
      setTestCases(data);

      // Select all test cases by default
      setSelectedTestCases(new Set(data.map((tc) => tc.id)));
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to load test cases",
        variant: "destructive",
      });
    }
  };

  const handleGenerateTests = async () => {
    if (!currentProject) {
      toast({
        title: "No project selected",
        description: "Please select a project first",
        variant: "destructive",
      });
      return;
    }

    if (!input.trim()) {
      toast({
        title: "Please enter a feature description or GitHub PR URL",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);

    try {
      let sourceType: "description" | "github_pr" | "repository_analysis" =
        "description";
      let sourceData: any = { description: input.trim() };

      // Check if input looks like a GitHub PR URL
      if (input.includes("github.com") && input.includes("pull")) {
        sourceType = "github_pr";
        sourceData = { prUrl: input.trim() };
        toast({ title: "Fetching PR description..." });
      }

      const result = await api.generateTests(
        currentProject.id,
        sourceType,
        sourceData
      );

      await loadTestCases(); // Reload test cases

      toast({
        title: "Tests Generated!",
        description: `Generated ${result.generatedCount} test cases`,
      });

      setInput(""); // Clear input after successful generation
    } catch (error: any) {
      toast({
        title: "Generation Failed",
        description: error.message || "Failed to generate test cases",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRunTests = async () => {
    if (!currentProject) {
      toast({
        title: "No project selected",
        description: "Please select a project first",
        variant: "destructive",
      });
      return;
    }

    if (selectedTestCases.size === 0) {
      toast({
        title: "No tests selected",
        description: "Please select at least one test to run",
        variant: "destructive",
      });
      return;
    }

    setIsRunning(true);
    setTestProgress({
      current: 0,
      total: selectedTestCases.size,
      passed: 0,
      failed: 0,
      skipped: 0,
    });

    try {
      // Get the current session/token from Supabase using direct import
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        throw new Error("No active session");
      }

      // Call the execute tests API with SSE support
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/execute-tests`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            projectId: currentProject.id,
            testCaseIds: Array.from(selectedTestCases),
            browserType: "chrome",
            environment: environment,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to start test execution");
      }

      // Handle Server-Sent Events
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("No response body");
      }

      let buffer = "";
      let testRunId: string | null = null;

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              // Handle initial response
              if (data.testRunId && !testRunId) {
                testRunId = data.testRunId;
                setCurrentTestRun({ id: testRunId } as TestRun);
                toast({
                  title: "Test execution started",
                  description: `Running ${selectedTestCases.size} tests on ${environment} environment`,
                });
              }

              // Handle progress updates
              if (data.type === "progress" || data.type === "test_complete") {
                setTestProgress({
                  current:
                    data.current ||
                    (data.passed || 0) +
                      (data.failed || 0) +
                      (data.skipped || 0),
                  total: data.total,
                  passed: data.passed || 0,
                  failed: data.failed || 0,
                  skipped: data.skipped || 0,
                });
              }

              // Handle completion
              if (data.type === "complete") {
                setIsRunning(false);
                setCurrentTestRun(null);
                toast({
                  title: "Test Run Complete",
                  description: `${data.passed}/${data.total} tests passed in ${(
                    data.executionTime / 1000
                  ).toFixed(1)}s`,
                  variant: data.failed > 0 ? "destructive" : "default",
                });

                // Reload test cases to refresh any data
                setTimeout(() => {
                  loadTestCases();
                }, 1000);
              }

              // Handle errors
              if (data.type === "error") {
                setIsRunning(false);
                setCurrentTestRun(null);
                toast({
                  title: "Test execution failed",
                  description: data.error,
                  variant: "destructive",
                });
              }
            } catch (e) {
              console.error("Failed to parse SSE data:", e);
            }
          }
        }
      }
    } catch (error: any) {
      setIsRunning(false);
      setCurrentTestRun(null);
      toast({
        title: "Execution Failed",
        description: error.message || "Failed to start test execution",
        variant: "destructive",
      });
    }
  };

  const toggleTestExpansion = (testId: string) => {
    const newExpanded = new Set(expandedTests);
    if (newExpanded.has(testId)) {
      newExpanded.delete(testId);
    } else {
      newExpanded.add(testId);
    }
    setExpandedTests(newExpanded);
  };

  const toggleTestSelection = (testId: string) => {
    const newSelected = new Set(selectedTestCases);
    if (newSelected.has(testId)) {
      newSelected.delete(testId);
    } else {
      newSelected.add(testId);
    }
    setSelectedTestCases(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedTestCases.size === testCases.length) {
      setSelectedTestCases(new Set());
    } else {
      setSelectedTestCases(new Set(testCases.map((tc) => tc.id)));
    }
  };

  const handleExport = (format: "selenium" | "postman") => {
    if (selectedTestCases.size === 0) {
      toast({
        title: "No tests selected",
        description: "Please select tests to export",
        variant: "destructive",
      });
      return;
    }

    const selectedTests = testCases.filter((tc) =>
      selectedTestCases.has(tc.id)
    );

    let content = "";
    let filename = "";

    if (format === "selenium") {
      content = generateSeleniumCode(selectedTests);
      filename = "qa_autopilot_tests.py";
    } else {
      content = generatePostmanCollection(selectedTests);
      filename = "qa_autopilot_tests.json";
    }

    downloadFile(content, filename);
    toast({
      title: `${
        format === "selenium" ? "Selenium" : "Postman"
      } tests exported!`,
    });
  };

  const generateSeleniumCode = (tests: TestCase[]) => {
    return `from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import unittest

class QAAutopilotTests(unittest.TestCase):
    def setUp(self):
        self.driver = webdriver.Chrome()
        self.driver.get("${getEnvironmentUrl(environment)}")

    ${tests
      .map(
        (test) => `
    def test_${test.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}(self):
        """${test.description || test.name}"""
        driver = self.driver
        ${test.steps
          .map(
            (step, index) => `
        # Step ${index + 1}: ${step.action}
        # Expected: ${step.expected_result}`
          )
          .join("")}
        
        # Test implementation would go here
        pass`
      )
      .join("")}

    def tearDown(self):
        self.driver.quit()

if __name__ == "__main__":
    unittest.main()`;
  };

  const generatePostmanCollection = (tests: TestCase[]) => {
    return JSON.stringify(
      {
        info: {
          name: "QA Autopilot Tests",
          description: `Generated test collection for ${currentProject?.name}`,
          schema:
            "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        item: tests.map((test) => ({
          name: test.name,
          request: {
            method: "POST",
            header: [{ key: "Content-Type", value: "application/json" }],
            body: {
              mode: "raw",
              raw: JSON.stringify(test.test_data),
            },
            url: {
              raw: `${getEnvironmentUrl(environment)}/api/test`,
              host: [getEnvironmentUrl(environment)],
              path: ["api", "test"],
            },
          },
          event: [
            {
              listen: "test",
              script: {
                exec: [
                  'pm.test("Status code is 200", function () {',
                  "    pm.response.to.have.status(200);",
                  "});",
                ],
              },
            },
          ],
        })),
      },
      null,
      2
    );
  };

  const getEnvironmentUrl = (env: string) => {
    const urls = {
      local: "http://localhost:3000",
      staging:
        currentProject?.settings?.staging_url || "https://staging.yourapp.com",
      production:
        currentProject?.settings?.production_url || "https://yourapp.com",
    };
    return urls[env as keyof typeof urls] || urls.local;
  };

  const downloadFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!currentProject) {
    return null; // This will be handled by the Index component
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
      {/* Input Section */}
      <Card>
        <CardHeader>
          <CardTitle>Generate Test Cases</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            placeholder="Enter feature description or paste GitHub PR URL (e.g., https://github.com/user/repo/pull/123)..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="min-h-[120px]"
          />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">Environment:</label>
              <Select value={environment} onValueChange={setEnvironment}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">Local</SelectItem>
                  <SelectItem value="staging">Staging</SelectItem>
                  <SelectItem value="production">Production</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleGenerateTests}
              disabled={isGenerating}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                "Generate Tests"
              )}
            </Button>
            <Button
              onClick={handleRunTests}
              disabled={isRunning || selectedTestCases.size === 0}
              variant="outline"
            >
              {isRunning ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Run Tests ({selectedTestCases.size})
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Test Cases */}
      {testCases.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center space-x-4">
              <CardTitle>Test Cases ({testCases.length})</CardTitle>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="select-all"
                  checked={selectedTestCases.size === testCases.length}
                  onCheckedChange={toggleSelectAll}
                />
                <label htmlFor="select-all" className="text-sm font-medium">
                  Select All
                </label>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport("selenium")}
                disabled={selectedTestCases.size === 0}
              >
                <Download className="w-4 h-4 mr-2" />
                Export Selenium
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport("postman")}
                disabled={selectedTestCases.size === 0}
              >
                <Download className="w-4 h-4 mr-2" />
                Export Postman
              </Button>
              <Button variant="outline" size="sm" onClick={loadTestCases}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {testCases.map((test) => (
                <div key={test.id} className="border rounded-lg">
                  <div className="flex items-center justify-between p-4 hover:bg-gray-50">
                    <div className="flex items-center space-x-4">
                      <Checkbox
                        checked={selectedTestCases.has(test.id)}
                        onCheckedChange={() => toggleTestSelection(test.id)}
                      />
                      <button
                        onClick={() => toggleTestExpansion(test.id)}
                        className="flex items-center space-x-2"
                      >
                        {expandedTests.has(test.id) ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                        <span className="font-medium">{test.name}</span>
                      </button>
                      <span
                        className={`px-2 py-1 text-xs rounded ${
                          test.priority === "High"
                            ? "bg-red-100 text-red-800"
                            : test.priority === "Medium"
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-green-100 text-green-800"
                        }`}
                      >
                        {test.priority}
                      </span>
                      {test.category && (
                        <span className="px-2 py-1 text-xs rounded bg-blue-100 text-blue-800">
                          {test.category}
                        </span>
                      )}
                    </div>
                  </div>
                  {expandedTests.has(test.id) && (
                    <div className="border-t p-4 bg-gray-50">
                      <div className="space-y-3">
                        {test.description && (
                          <div>
                            <h4 className="font-medium text-sm mb-2">
                              Description:
                            </h4>
                            <p className="text-sm text-gray-600">
                              {test.description}
                            </p>
                          </div>
                        )}
                        <div>
                          <h4 className="font-medium text-sm mb-2">
                            Test Steps:
                          </h4>
                          <ol className="list-decimal list-inside space-y-1 text-sm">
                            {test.steps.map((step, stepIndex) => (
                              <li key={stepIndex}>
                                <span className="font-medium">
                                  {step.action}
                                </span>
                                <span className="text-gray-600">
                                  {" "}
                                  → {step.expected_result}
                                </span>
                              </li>
                            ))}
                          </ol>
                        </div>
                        {Object.keys(test.test_data).length > 0 && (
                          <div>
                            <h4 className="font-medium text-sm mb-2">
                              Test Data:
                            </h4>
                            <div className="bg-white p-2 rounded border text-xs font-mono">
                              {JSON.stringify(test.test_data, null, 2)}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Current Test Run Status */}
      {isRunning && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Running tests on {environment}...</span>
                <span>
                  {testProgress.current}/{testProgress.total} completed
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{
                    width: `${
                      testProgress.total > 0
                        ? (testProgress.current / testProgress.total) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-600 mt-2">
                <span className="text-green-600">
                  ✓ {testProgress.passed} passed
                </span>
                <span className="text-red-600">
                  ✗ {testProgress.failed} failed
                </span>
                {testProgress.skipped > 0 && (
                  <span className="text-gray-500">
                    ⊘ {testProgress.skipped} skipped
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default Dashboard;
