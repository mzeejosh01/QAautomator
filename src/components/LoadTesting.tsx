/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Upload,
  RefreshCw,
  Play,
  Zap,
  FileUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/hooks/use-toast";
import { useApp } from "@/App";
import {
  api,
  supabase,
  subscriptions,
  type TestCase,
  type TestRun,
} from "@/lib/supabase";
import { Badge } from "./ui/badge";

const LoadTesting = () => {
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
  const [loadTestConfig, setLoadTestConfig] = useState({
    threads: 10,
    rampUp: 30,
    duration: 300, // 5 minutes
    targetTps: 100,
    endpoints: [
      {
        url: "",
        method: "GET",
        body: "",
        headers: {},
      },
    ],
  });
  const [jmxFile, setJmxFile] = useState<File | null>(null);

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
          if (payload.new.load_test_metrics) {
            setTestProgress((prev) => ({
              ...prev,
              passed: payload.new.passed_tests || 0,
              failed: payload.new.failed_tests || 0,
              skipped: 0,
            }));

            // Show metrics toast if available
            if (payload.new.status === "running") {
              toast({
                title: "Load Test Metrics",
                description: `RPS: ${payload.new.load_test_metrics.requests_per_second.toFixed(
                  2
                )}, Errors: ${payload.new.load_test_metrics.error_rate.toFixed(
                  2
                )}%`,
              });
            }
          }

          if (
            payload.new.status === "completed" ||
            payload.new.status === "failed"
          ) {
            setIsRunning(false);

            const message =
              payload.new.status === "completed"
                ? `Load test complete. ${
                    payload.new.load_test_metrics?.requests_per_second.toFixed(
                      2
                    ) || 0
                  } RPS achieved`
                : "Load test failed";

            toast({
              title:
                payload.new.status === "completed"
                  ? "Test Run Complete"
                  : "Test Run Failed",
              description: message,
              variant:
                payload.new.status === "failed" ? "destructive" : "default",
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
      // Filter only load tests
      const loadTests = data.filter((tc) => tc.test_type === "load");
      setTestCases(loadTests);

      // Select all test cases by default
      setSelectedTestCases(new Set(loadTests.map((tc) => tc.id)));
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

    setIsGenerating(true);

    try {
      const sourceData = {
        description: input.trim() || "Load test for API endpoints",
        baseUrl: loadTestConfig.endpoints[0]?.url || "",
        endpoints: loadTestConfig.endpoints,
        config: {
          threads: loadTestConfig.threads,
          ramp_up: loadTestConfig.rampUp,
          duration: loadTestConfig.duration,
          target_tps: loadTestConfig.targetTps,
        },
      };

      const result = await api.generateLoadTests(
        currentProject.id,
        "api_endpoints", // or "custom_config" depending on your needs
        sourceData
      );

      await loadTestCases(); // Reload test cases

      toast({
        title: "Load Test Generated!",
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

  const handleJmxUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.name.endsWith(".jmx")) {
      toast({
        title: "Invalid file",
        description: "Please upload a JMeter test plan (.jmx) file",
        variant: "destructive",
      });
      return;
    }

    setJmxFile(file);

    // Read file content
    const reader = new FileReader();
    reader.onload = async (event) => {
      if (!currentProject) return;

      try {
        const content = event.target?.result as string;
        const testCase = await api.uploadJMeterTestPlan(
          currentProject.id,
          content,
          {
            name: `Load Test - ${file.name}`,
            description: `Uploaded JMeter test plan: ${file.name}`,
            threads: loadTestConfig.threads,
            ramp_up: loadTestConfig.rampUp,
            duration: loadTestConfig.duration,
          }
        );

        await loadTestCases();
        toast({
          title: "JMeter test plan uploaded",
          description: "Test plan is ready for execution",
        });
      } catch (error: any) {
        toast({
          title: "Upload failed",
          description: error.message || "Failed to upload test plan",
          variant: "destructive",
        });
      }
    };
    reader.readAsText(file);
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

      // Call the execute load tests API with SSE support
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/execute-load-tests`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            projectId: currentProject.id,
            testCaseIds: Array.from(selectedTestCases),
            environment: environment,
            loadTestConfig: {
              threads: loadTestConfig.threads,
              rampUp: loadTestConfig.rampUp,
              duration: loadTestConfig.duration,
            },
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to start load test execution");
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
                  title: "Load test execution started",
                  description: `Running ${selectedTestCases.size} load tests on ${environment} environment`,
                });
              }

              // Handle progress updates
              if (data.type === "load_test_progress") {
                setTestProgress((prev) => ({
                  ...prev,
                  current: data.completedRequests || 0,
                  total: selectedTestCases.size,
                  passed: data.passed || 0,
                  failed: data.failed || 0,
                }));
              }

              // Handle load test metrics
              if (data.type === "load_test_update" && data.metrics) {
                toast({
                  title: "Load Test Progress",
                  description: `RPS: ${data.metrics.requests_per_second}, Error Rate: ${data.metrics.error_rate}%`,
                });
              }

              // Handle completion
              if (data.type === "load_test_complete") {
                setTestProgress((prev) => ({
                  ...prev,
                  passed:
                    data.status === "pass" ? prev.passed + 1 : prev.passed,
                  failed:
                    data.status === "fail" ? prev.failed + 1 : prev.failed,
                }));
              }

              // Handle summary
              if (data.type === "load_test_summary") {
                setIsRunning(false);
                setCurrentTestRun(null);

                toast({
                  title: "Load Test Complete",
                  description: `Completed with ${data.passedTests} passed and ${data.failedTests} failed`,
                  variant: data.failedTests > 0 ? "destructive" : "default",
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
                  title: "Load test failed",
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
        description: error.message || "Failed to start load test execution",
        variant: "destructive",
      });
    }
  };

  const addEndpoint = () => {
    setLoadTestConfig((prev) => ({
      ...prev,
      endpoints: [
        ...prev.endpoints,
        {
          url: "",
          method: "GET",
          body: "",
          headers: {},
        },
      ],
    }));
  };

  const updateEndpoint = (index: number, field: string, value: any) => {
    setLoadTestConfig((prev) => {
      const newEndpoints = [...prev.endpoints];
      newEndpoints[index] = { ...newEndpoints[index], [field]: value };
      return { ...prev, endpoints: newEndpoints };
    });
  };

  const removeEndpoint = (index: number) => {
    setLoadTestConfig((prev) => ({
      ...prev,
      endpoints: prev.endpoints.filter((_, i) => i !== index),
    }));
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

  const handleExport = () => {
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

    const content = generateJMeterTestPlan(selectedTests);
    const filename = "qa_autopilot_loadtest.jmx";

    downloadFile(content, filename);
    toast({
      title: "JMeter tests exported!",
    });
  };

  const generateJMeterTestPlan = (tests: TestCase[]) => {
    // Create basic JMeter test plan structure
    let jmx = `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.5">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="QA Autopilot Test Plan" enabled="true">
      <stringProp name="TestPlan.comments">Generated by QA Autopilot</stringProp>
      <boolProp name="TestPlan.functional_mode">false</boolProp>
      <boolProp name="TestPlan.serialize_threadgroups">false</boolProp>
      <elementProp name="TestPlan.user_defined_variables" elementType="Arguments" guiclass="ArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
        <collectionProp name="Arguments.arguments"/>
      </elementProp>
      <stringProp name="TestPlan.user_define_classpath"></stringProp>
    </TestPlan>
    <hashTree>
      <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="Thread Group" enabled="true">
        <stringProp name="ThreadGroup.on_sample_error">continue</stringProp>
        <elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">
          <boolProp name="LoopController.continue_forever">false</boolProp>
          <intProp name="LoopController.loops">1</intProp>
        </elementProp>
        <stringProp name="ThreadGroup.num_threads">${loadTestConfig.threads}</stringProp>
        <stringProp name="ThreadGroup.ramp_time">${loadTestConfig.rampUp}</stringProp>
        <stringProp name="ThreadGroup.duration">${loadTestConfig.duration}</stringProp>
        <stringProp name="ThreadGroup.delay">0</stringProp>
      </ThreadGroup>
      <hashTree>`;

    // Process load tests
    tests.forEach((test) => {
      if (test.jmeter_config?.test_plan) {
        // Use existing JMeter config if available
        jmx += test.jmeter_config.test_plan;
      }
    });

    // Close the JMeter test plan
    jmx += `
      </hashTree>
    </hashTree>
  </hashTree>
</jmeterTestPlan>`;

    return jmx;
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
    return null;
  }

  return (
    <div className="space-y-8">
      {/* Load Testing Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Configure Load Test</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* JMeter Upload Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Upload JMeter Test Plan</h3>
              <Label htmlFor="jmx-upload" className="cursor-pointer">
                <div className="flex items-center gap-2 px-4 py-2 border rounded-md hover:bg-gray-50">
                  <FileUp className="w-4 h-4" />
                  Upload .jmx file
                </div>
                <Input
                  id="jmx-upload"
                  type="file"
                  accept=".jmx"
                  className="hidden"
                  onChange={handleJmxUpload}
                />
              </Label>
            </div>
            {jmxFile && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Upload className="w-4 h-4" />
                {jmxFile.name}
              </div>
            )}
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-gray-500">Or create new</span>
            </div>
          </div>

          {/* Load Test Configuration */}
          <div className="space-y-4">
            <div>
              <Label>Test Description (optional)</Label>
              <Textarea
                placeholder="Describe what you want to load test..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="min-h-[80px] mt-2"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Threads (Virtual Users)</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[loadTestConfig.threads]}
                    onValueChange={(v) =>
                      setLoadTestConfig((prev) => ({
                        ...prev,
                        threads: v[0],
                      }))
                    }
                    min={1}
                    max={100}
                    step={1}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    value={loadTestConfig.threads}
                    onChange={(e) =>
                      setLoadTestConfig((prev) => ({
                        ...prev,
                        threads: parseInt(e.target.value) || 1,
                      }))
                    }
                    className="w-16"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Ramp-up Period (seconds)</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[loadTestConfig.rampUp]}
                    onValueChange={(v) =>
                      setLoadTestConfig((prev) => ({
                        ...prev,
                        rampUp: v[0],
                      }))
                    }
                    min={0}
                    max={300}
                    step={10}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    value={loadTestConfig.rampUp}
                    onChange={(e) =>
                      setLoadTestConfig((prev) => ({
                        ...prev,
                        rampUp: parseInt(e.target.value) || 0,
                      }))
                    }
                    className="w-16"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Duration (seconds)</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[loadTestConfig.duration]}
                    onValueChange={(v) =>
                      setLoadTestConfig((prev) => ({
                        ...prev,
                        duration: v[0],
                      }))
                    }
                    min={60}
                    max={1800}
                    step={60}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    value={loadTestConfig.duration}
                    onChange={(e) =>
                      setLoadTestConfig((prev) => ({
                        ...prev,
                        duration: parseInt(e.target.value) || 60,
                      }))
                    }
                    className="w-16"
                  />
                </div>
              </div>
            </div>

            {/* API Endpoints */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>API Endpoints</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addEndpoint}
                >
                  Add Endpoint
                </Button>
              </div>
              {loadTestConfig.endpoints.map((endpoint, index) => (
                <div key={index} className="space-y-2 p-4 border rounded-lg">
                  <div className="flex items-center gap-2">
                    <Select
                      value={endpoint.method}
                      onValueChange={(value) =>
                        updateEndpoint(index, "method", value)
                      }
                    >
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="GET">GET</SelectItem>
                        <SelectItem value="POST">POST</SelectItem>
                        <SelectItem value="PUT">PUT</SelectItem>
                        <SelectItem value="DELETE">DELETE</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="https://api.example.com/endpoint"
                      value={endpoint.url}
                      onChange={(e) =>
                        updateEndpoint(index, "url", e.target.value)
                      }
                      className="flex-1"
                    />
                    {loadTestConfig.endpoints.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeEndpoint(index)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  {(endpoint.method === "POST" ||
                    endpoint.method === "PUT") && (
                    <Textarea
                      placeholder="Request body (JSON)"
                      value={endpoint.body}
                      onChange={(e) =>
                        updateEndpoint(index, "body", e.target.value)
                      }
                      className="min-h-[80px]"
                    />
                  )}
                </div>
              ))}
            </div>

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
                  <>
                    <Zap className="w-4 h-4 mr-2" />
                    Generate Load Test
                  </>
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
          </div>
        </CardContent>
      </Card>

      {/* Test Cases */}
      {testCases.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center space-x-4">
              <CardTitle>Load Test Cases ({testCases.length})</CardTitle>
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
                onClick={handleExport}
                disabled={selectedTestCases.size === 0}
              >
                <Download className="w-4 h-4 mr-2" />
                Export JMeter
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
                      <Badge variant="secondary">
                        <Zap className="w-3 h-3 mr-1" />
                        Load Test
                      </Badge>
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
                        {test.jmeter_config && (
                          <div>
                            <h4 className="font-medium text-sm mb-2">
                              Load Test Configuration:
                            </h4>
                            <div className="grid grid-cols-3 gap-4 text-sm">
                              <div>
                                <span className="text-gray-600">Threads:</span>{" "}
                                <span className="font-medium">
                                  {test.jmeter_config.threads}
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-600">Ramp-up:</span>{" "}
                                <span className="font-medium">
                                  {test.jmeter_config.ramp_up}s
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-600">Duration:</span>{" "}
                                <span className="font-medium">
                                  {test.jmeter_config.duration}s
                                </span>
                              </div>
                            </div>
                            {test.jmeter_config.endpoints && (
                              <div className="mt-2">
                                <span className="text-sm text-gray-600">
                                  Endpoints:{" "}
                                  {test.jmeter_config.endpoints.length}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
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
          <span>Running load tests on {environment}...</span>
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
        {currentTestRun?.load_test_metrics && (
          <div className="grid grid-cols-2 gap-2 text-xs mt-2">
            <div>
              <span className="text-gray-600">RPS:</span>{" "}
              <span className="font-medium">
                {currentTestRun.load_test_metrics.requests_per_second.toFixed(2)}
              </span>
            </div>
            <div>
              <span className="text-gray-600">Avg Response:</span>{" "}
              <span className="font-medium">
                {currentTestRun.load_test_metrics.avg_response_time.toFixed(2)}ms
              </span>
            </div>
            <div>
              <span className="text-gray-600">Error Rate:</span>{" "}
              <span className="font-medium text-red-600">
                {currentTestRun.load_test_metrics.error_rate.toFixed(2)}%
              </span>
            </div>
            <div>
              <span className="text-gray-600">Throughput:</span>{" "}
              <span className="font-medium">
                {currentTestRun.load_test_metrics.throughput.toFixed(2)}/s
              </span>
            </div>
          </div>
        )}
        <div className="flex justify-between text-xs text-gray-600 mt-2">
          <span className="text-green-600">
            ✓ {testProgress.passed} passed
          </span>
          <span className="text-red-600">
            ✗ {testProgress.failed} failed
          </span>
        </div>
      </div>
    </CardContent>
  </Card>
)}
    </div>
  );
};

export default LoadTesting;
