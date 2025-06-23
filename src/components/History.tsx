/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Image,
  FileText,
  Globe,
  Terminal,
  AlertTriangle,
  Maximize2,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApp } from "@/App";
import {
  api,
  type TestRun,
  type TestResult,
  type TestCase,
  supabase,
} from "@/lib/supabase";
import { toast } from "@/hooks/use-toast";

const History = () => {
  const { currentProject, projects } = useApp();
  const [environmentFilter, setEnvironmentFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [expandedResult, setExpandedResult] = useState<string | null>(null);
  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [testResults, setTestResults] = useState<Record<string, TestResult[]>>(
    {}
  );
  const [testCases, setTestCases] = useState<Record<string, TestCase>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadingResults, setLoadingResults] = useState<Set<string>>(new Set());
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);

  useEffect(() => {
    loadTestRuns();
  }, [currentProject]);

  useEffect(() => {
    if (currentProject) {
      loadTestCasesCache();
    }
  }, [currentProject]);

  const loadTestCasesCache = async () => {
    if (!currentProject) return;

    try {
      const data = await api.getTestCases(currentProject.id);
      const testCaseMap: Record<string, TestCase> = {};
      data.forEach((tc) => {
        testCaseMap[tc.id] = tc;
      });
      setTestCases(testCaseMap);
    } catch (error: any) {
      console.error("Failed to load test cases cache:", error);
    }
  };

  const loadTestRuns = async () => {
    try {
      setIsLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("User must be authenticated");

      let query = supabase
        .from("test_runs")
        .select("*")
        .order("created_at", { ascending: false });

      if (currentProject) {
        query = query.eq("project_id", currentProject.id);
      } else {
        const { data: projects } = await supabase
          .from("projects")
          .select("id")
          .eq("owner_id", user.id);

        if (projects && projects.length > 0) {
          query = query.in(
            "project_id",
            projects.map((p) => p.id)
          );
        } else {
          return [];
        }
      }

      const { data } = await query;
      setTestRuns(data || []);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to load test runs",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadTestResults = async (testRunId: string) => {
    if (testResults[testRunId] || loadingResults.has(testRunId)) {
      return;
    }

    setLoadingResults((prev) => new Set(prev).add(testRunId));

    try {
      const data = await api.getTestResults(testRunId);
      setTestResults((prev) => ({
        ...prev,
        [testRunId]: data,
      }));
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to load test results",
        variant: "destructive",
      });
    } finally {
      setLoadingResults((prev) => {
        const newSet = new Set(prev);
        newSet.delete(testRunId);
        return newSet;
      });
    }
  };

  const filteredHistory = testRuns.filter((run) => {
    const matchesEnvironment =
      environmentFilter === "all" || run.environment === environmentFilter;
    const matchesProject =
      projectFilter === "all" ||
      (currentProject ? run.project_id === currentProject.id : true);
    const matchesSearch =
      searchTerm === "" ||
      run.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      run.id.toLowerCase().includes(searchTerm.toLowerCase());

    return matchesEnvironment && matchesProject && matchesSearch;
  });

  const toggleExpanded = async (runId: string) => {
    if (expandedRun === runId) {
      setExpandedRun(null);
    } else {
      setExpandedRun(runId);
      await loadTestResults(runId);
    }
  };

  const toggleResultExpanded = (resultId: string) => {
    setExpandedResult(expandedResult === resultId ? null : resultId);
  };

  const getSuccessRate = (passed: number, total: number) => {
    if (total === 0) return 0;
    return Math.round((passed / total) * 100);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case "failed":
        return <XCircle className="w-4 h-4 text-red-600" />;
      case "running":
        return <Clock className="w-4 h-4 text-blue-600 animate-spin" />;
      default:
        return <AlertCircle className="w-4 h-4 text-yellow-600" />;
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return "N/A";

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${remainingSeconds}s`;
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return {
      date: date.toLocaleDateString(),
      time: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
  };

  const getTriggerDisplay = (triggerType: string, triggerData: any) => {
    switch (triggerType) {
      case "github_pr":
        return `GitHub PR #${triggerData?.prNumber || "N/A"}`;
      case "scheduled":
        return "Scheduled";
      default:
        return "Manual";
    }
  };

  const getTestCaseName = (testCaseId: string) => {
    return (
      testCases[testCaseId]?.name || `Test Case ${testCaseId.slice(0, 8)}...`
    );
  };

  const parseFailureDetails = (result: TestResult) => {
    try {
      // Try to parse logs as JSON first (for structured failure details)
      if (result.logs && result.logs.startsWith("{")) {
        return JSON.parse(result.logs);
      }
      return null;
    } catch {
      return null;
    }
  };

  const formatLogs = (logs: string | undefined) => {
    if (!logs) return [];

    // Split by newline and format each log entry
    return logs.split("\n").filter((line) => line.trim());
  };

  const LogViewer = ({ logs }: { logs: string[] }) => {
    return (
      <div className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto">
        <pre className="text-xs font-mono">
          {logs.map((log, index) => {
            let className = "text-gray-300";
            if (log.includes("[ERROR]") || log.includes("FAILED")) {
              className = "text-red-400";
            } else if (log.includes("[WARN]")) {
              className = "text-yellow-400";
            } else if (log.includes("✓") || log.includes("PASSED")) {
              className = "text-green-400";
            } else if (log.includes("[INFO]")) {
              className = "text-blue-400";
            }

            return (
              <div key={index} className={className}>
                {log}
              </div>
            );
          })}
        </pre>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading test history...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Test History</h1>
        <div className="text-sm text-gray-500">
          {filteredHistory.length} of {testRuns.length} runs
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">Search:</label>
              <Input
                placeholder="Run ID or name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-48"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">Environment:</label>
              <Select
                value={environmentFilter}
                onValueChange={setEnvironmentFilter}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="local">Local</SelectItem>
                  <SelectItem value="staging">Staging</SelectItem>
                  <SelectItem value="production">Production</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!currentProject && (
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">Project:</label>
                <Select value={projectFilter} onValueChange={setProjectFilter}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Projects</SelectItem>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      {filteredHistory.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-blue-600">
                {filteredHistory.length}
              </div>
              <div className="text-sm text-gray-600">Total Runs</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-green-600">
                {Math.round(
                  filteredHistory
                    .filter((run) => run.status === "completed")
                    .reduce(
                      (acc, run) =>
                        acc + getSuccessRate(run.passed_tests, run.total_tests),
                      0
                    ) /
                    (filteredHistory.filter((run) => run.status === "completed")
                      .length || 1)
                )}
                %
              </div>
              <div className="text-sm text-gray-600">Avg Success Rate</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-gray-900">
                {filteredHistory.reduce((acc, run) => acc + run.total_tests, 0)}
              </div>
              <div className="text-sm text-gray-600">Total Tests</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-red-600">
                {filteredHistory.reduce(
                  (acc, run) => acc + run.failed_tests,
                  0
                )}
              </div>
              <div className="text-sm text-gray-600">Total Failures</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* History Table */}
      <Card>
        <CardHeader>
          <CardTitle>Test Runs</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredHistory.length === 0 ? (
            <div className="text-center py-8">
              <Clock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                No test runs found
              </h3>
              <p className="text-gray-600">
                {testRuns.length === 0
                  ? "Start by running some tests to see your history here."
                  : "Try adjusting your filters to see more results."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredHistory.map((run) => {
                const { date, time } = formatDateTime(run.started_at);

                return (
                  <div key={run.id} className="border rounded-lg">
                    <div
                      className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50"
                      onClick={() => toggleExpanded(run.id)}
                    >
                      <div className="flex items-center space-x-4">
                        {expandedRun === run.id ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                        <div className="flex items-center space-x-2">
                          {getStatusIcon(run.status)}
                          <div>
                            <div className="font-medium">{run.name}</div>
                            <div className="text-sm text-gray-500">
                              {currentProject?.name || "Unknown Project"}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-6 text-sm">
                        <div>
                          <div className="font-medium">
                            {date} {time}
                          </div>
                          <div className="text-gray-500">
                            {getTriggerDisplay(
                              run.trigger_type,
                              run.trigger_data
                            )}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="font-medium">
                            {run.total_tests} tests
                          </div>
                          <div className="text-gray-500">
                            {formatDuration(run.duration_seconds)}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="font-medium text-green-600">
                            {run.passed_tests} passed
                          </div>
                          <div className="text-red-600">
                            {run.failed_tests} failed
                          </div>
                        </div>
                        <div className="text-center">
                          <Badge
                            variant={
                              run.environment === "production"
                                ? "destructive"
                                : run.environment === "staging"
                                ? "default"
                                : "secondary"
                            }
                          >
                            {run.environment}
                          </Badge>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-bold">
                            {getSuccessRate(run.passed_tests, run.total_tests)}%
                          </div>
                          <div className="text-xs text-gray-500">success</div>
                        </div>
                      </div>
                    </div>

                    {expandedRun === run.id && (
                      <div className="border-t bg-gray-50">
                        <div className="p-4">
                          <h4 className="font-medium mb-3">
                            Test Execution Details
                          </h4>

                          {/* Test run metadata */}
                          <div className="bg-white rounded-lg p-3 mb-4 text-sm">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                              <div>
                                <span className="text-gray-500">Browser:</span>{" "}
                                <span className="font-medium">
                                  {run.trigger_data?.browserType || "Chrome"}
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-500">
                                  Environment URL:
                                </span>{" "}
                                <span className="font-medium">
                                  {run.trigger_data?.environmentUrl || "N/A"}
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-500">
                                  Test Suite:
                                </span>{" "}
                                <span className="font-medium">
                                  {run.trigger_data?.testCaseIds?.length || 0}{" "}
                                  tests
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-500">Run ID:</span>{" "}
                                <span className="font-mono text-xs">
                                  {run.id.slice(0, 8)}...
                                </span>
                              </div>
                            </div>
                          </div>

                          {loadingResults.has(run.id) ? (
                            <div className="text-center py-4">
                              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto mb-2"></div>
                              <div className="text-sm text-gray-500">
                                Loading test details...
                              </div>
                            </div>
                          ) : testResults[run.id] &&
                            testResults[run.id].length > 0 ? (
                            <div className="space-y-2">
                              {testResults[run.id].map((result) => {
                                const failureDetails =
                                  parseFailureDetails(result);
                                const logs = formatLogs(result.logs);

                                return (
                                  <div
                                    key={result.id}
                                    className="bg-white rounded-lg border"
                                  >
                                    <div
                                      className="p-3 cursor-pointer hover:bg-gray-50"
                                      onClick={() =>
                                        toggleResultExpanded(result.id)
                                      }
                                    >
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                          {expandedResult === result.id ? (
                                            <ChevronDown className="w-4 h-4" />
                                          ) : (
                                            <ChevronRight className="w-4 h-4" />
                                          )}
                                          <div className="flex items-center gap-2">
                                            {result.status === "pass" ? (
                                              <CheckCircle className="w-4 h-4 text-green-600" />
                                            ) : (
                                              <XCircle className="w-4 h-4 text-red-600" />
                                            )}
                                            <span className="font-medium">
                                              {getTestCaseName(
                                                result.test_case_id
                                              )}
                                            </span>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-4 text-sm">
                                          <Badge
                                            variant={
                                              result.status === "pass"
                                                ? "default"
                                                : "destructive"
                                            }
                                          >
                                            {result.status}
                                          </Badge>
                                          <span className="text-gray-500">
                                            {formatDuration(
                                              result.duration_seconds
                                            )}
                                          </span>
                                          {result.screenshots &&
                                            result.screenshots.length > 0 && (
                                              <Image className="w-4 h-4 text-gray-400" />
                                            )}
                                        </div>
                                      </div>
                                      {result.error_message &&
                                        !expandedResult && (
                                          <div className="mt-2 text-sm text-red-600 truncate">
                                            {result.error_message}
                                          </div>
                                        )}
                                    </div>

                                    {expandedResult === result.id && (
                                      <div className="border-t p-4 space-y-4">
                                        <Tabs
                                          defaultValue="details"
                                          className="w-full"
                                        >
                                          <TabsList>
                                            <TabsTrigger value="details">
                                              Details
                                            </TabsTrigger>
                                            <TabsTrigger value="logs">
                                              Logs
                                            </TabsTrigger>
                                            {result.screenshots &&
                                              result.screenshots.length > 0 && (
                                                <TabsTrigger value="screenshots">
                                                  Screenshots
                                                </TabsTrigger>
                                              )}
                                            {failureDetails && (
                                              <TabsTrigger value="failure">
                                                Failure Analysis
                                              </TabsTrigger>
                                            )}
                                          </TabsList>

                                          <TabsContent
                                            value="details"
                                            className="mt-4"
                                          >
                                            <div className="space-y-3">
                                              {testCases[
                                                result.test_case_id
                                              ] && (
                                                <div>
                                                  <h5 className="font-medium mb-2">
                                                    Test Steps:
                                                  </h5>
                                                  <ol className="list-decimal list-inside space-y-1 text-sm">
                                                    {testCases[
                                                      result.test_case_id
                                                    ].steps.map((step, idx) => (
                                                      <li key={idx}>
                                                        <span className="font-medium">
                                                          {step.action}
                                                        </span>
                                                        <span className="text-gray-600">
                                                          {" "}
                                                          →{" "}
                                                          {step.expected_result}
                                                        </span>
                                                      </li>
                                                    ))}
                                                  </ol>
                                                </div>
                                              )}

                                              {result.error_message && (
                                                <div>
                                                  <h5 className="font-medium mb-1 text-red-600">
                                                    Error:
                                                  </h5>
                                                  <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">
                                                    {result.error_message}
                                                  </div>
                                                </div>
                                              )}

                                              <div className="grid grid-cols-2 gap-4 text-sm">
                                                <div>
                                                  <span className="text-gray-500">
                                                    Executed at:
                                                  </span>{" "}
                                                  <span className="font-medium">
                                                    {
                                                      formatDateTime(
                                                        result.executed_at
                                                      ).date
                                                    }{" "}
                                                    {
                                                      formatDateTime(
                                                        result.executed_at
                                                      ).time
                                                    }
                                                  </span>
                                                </div>
                                                <div>
                                                  <span className="text-gray-500">
                                                    Duration:
                                                  </span>{" "}
                                                  <span className="font-medium">
                                                    {formatDuration(
                                                      result.duration_seconds
                                                    )}
                                                  </span>
                                                </div>
                                              </div>
                                            </div>
                                          </TabsContent>

                                          <TabsContent
                                            value="logs"
                                            className="mt-4"
                                          >
                                            {logs.length > 0 ? (
                                              <LogViewer logs={logs} />
                                            ) : (
                                              <div className="text-center py-8 text-gray-500">
                                                No logs available for this test
                                              </div>
                                            )}
                                          </TabsContent>

                                          {result.screenshots &&
                                            result.screenshots.length > 0 && (
                                              <TabsContent
                                                value="screenshots"
                                                className="mt-4"
                                              >
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                  {result.screenshots.map(
                                                    (screenshot, idx) => (
                                                      <div
                                                        key={idx}
                                                        className="relative group"
                                                      >
                                                        <img
                                                          src={screenshot}
                                                          alt={`Screenshot ${
                                                            idx + 1
                                                          }`}
                                                          className="w-full rounded-lg border shadow-sm cursor-pointer"
                                                          onClick={() =>
                                                            setFullscreenImage(
                                                              screenshot
                                                            )
                                                          }
                                                        />
                                                        <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-10 transition-opacity rounded-lg flex items-center justify-center">
                                                          <Maximize2 className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                                        </div>
                                                        <p className="text-xs text-gray-500 mt-1">
                                                          Screenshot {idx + 1} -
                                                          Click to enlarge
                                                        </p>
                                                      </div>
                                                    )
                                                  )}
                                                </div>
                                              </TabsContent>
                                            )}

                                          {failureDetails && (
                                            <TabsContent
                                              value="failure"
                                              className="mt-4"
                                            >
                                              <div className="space-y-4">
                                                {failureDetails.failure_details && (
                                                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                                                    <h5 className="font-medium mb-2 flex items-center gap-2">
                                                      <AlertTriangle className="w-4 h-4 text-red-600" />
                                                      Failure Details
                                                    </h5>
                                                    <div className="space-y-2 text-sm">
                                                      {failureDetails
                                                        .failure_details
                                                        .element && (
                                                        <div>
                                                          <span className="text-gray-600">
                                                            Failed Element:
                                                          </span>{" "}
                                                          <span className="font-mono">
                                                            {
                                                              failureDetails
                                                                .failure_details
                                                                .element
                                                            }
                                                          </span>
                                                        </div>
                                                      )}
                                                      {failureDetails
                                                        .failure_details
                                                        .selector && (
                                                        <div>
                                                          <span className="text-gray-600">
                                                            Selector:
                                                          </span>{" "}
                                                          <span className="font-mono bg-gray-100 px-2 py-1 rounded">
                                                            {
                                                              failureDetails
                                                                .failure_details
                                                                .selector
                                                            }
                                                          </span>
                                                        </div>
                                                      )}
                                                      {failureDetails
                                                        .failure_details
                                                        .expected && (
                                                        <div>
                                                          <span className="text-gray-600">
                                                            Expected:
                                                          </span>{" "}
                                                          <span className="font-medium">
                                                            {
                                                              failureDetails
                                                                .failure_details
                                                                .expected
                                                            }
                                                          </span>
                                                        </div>
                                                      )}
                                                      {failureDetails
                                                        .failure_details
                                                        .actual && (
                                                        <div>
                                                          <span className="text-gray-600">
                                                            Actual:
                                                          </span>{" "}
                                                          <span className="font-medium">
                                                            {
                                                              failureDetails
                                                                .failure_details
                                                                .actual
                                                            }
                                                          </span>
                                                        </div>
                                                      )}
                                                      {failureDetails
                                                        .failure_details
                                                        .page_url && (
                                                        <div>
                                                          <span className="text-gray-600">
                                                            Page URL:
                                                          </span>{" "}
                                                          <a
                                                            href={
                                                              failureDetails
                                                                .failure_details
                                                                .page_url
                                                            }
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-blue-600 hover:underline"
                                                          >
                                                            {
                                                              failureDetails
                                                                .failure_details
                                                                .page_url
                                                            }
                                                          </a>
                                                        </div>
                                                      )}
                                                    </div>
                                                  </div>
                                                )}

                                                {failureDetails.console_logs &&
                                                  failureDetails.console_logs
                                                    .length > 0 && (
                                                    <div>
                                                      <h5 className="font-medium mb-2 flex items-center gap-2">
                                                        <Terminal className="w-4 h-4" />
                                                        Console Logs
                                                      </h5>
                                                      <div className="bg-gray-900 text-gray-100 p-3 rounded-lg text-xs font-mono overflow-x-auto">
                                                        {failureDetails.console_logs.map(
                                                          (
                                                            log: string,
                                                            idx: number
                                                          ) => (
                                                            <div key={idx}>
                                                              {log}
                                                            </div>
                                                          )
                                                        )}
                                                      </div>
                                                    </div>
                                                  )}

                                                {failureDetails.network_logs &&
                                                  failureDetails.network_logs
                                                    .length > 0 && (
                                                    <div>
                                                      <h5 className="font-medium mb-2 flex items-center gap-2">
                                                        <Globe className="w-4 h-4" />
                                                        Network Activity
                                                      </h5>
                                                      <div className="bg-gray-50 rounded-lg p-3 max-h-48 overflow-y-auto">
                                                        <div className="space-y-1 text-xs">
                                                          {failureDetails.network_logs.map(
                                                            (
                                                              req: any,
                                                              idx: number
                                                            ) => (
                                                              <div
                                                                key={idx}
                                                                className="flex items-center gap-2"
                                                              >
                                                                <span className="font-mono bg-gray-200 px-1 rounded">
                                                                  {req.method}
                                                                </span>
                                                                <span className="truncate">
                                                                  {req.url}
                                                                </span>
                                                              </div>
                                                            )
                                                          )}
                                                        </div>
                                                      </div>
                                                    </div>
                                                  )}
                                              </div>
                                            </TabsContent>
                                          )}
                                        </Tabs>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="text-center py-4 text-gray-500">
                              No test results found for this run.
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fullscreen Image Modal */}
      {fullscreenImage && (
        <div
          className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4"
          onClick={() => setFullscreenImage(null)}
        >
          <div className="relative max-w-7xl max-h-[90vh]">
            <img
              src={fullscreenImage}
              alt="Fullscreen screenshot"
              className="max-w-full max-h-[90vh] object-contain"
            />
            <button
              className="absolute top-4 right-4 text-white bg-black bg-opacity-50 rounded-full p-2 hover:bg-opacity-70"
              onClick={() => setFullscreenImage(null)}
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default History;
