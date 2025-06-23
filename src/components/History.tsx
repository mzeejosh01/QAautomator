/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
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
  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [testResults, setTestResults] = useState<Record<string, TestResult[]>>(
    {}
  );
  const [testCases, setTestCases] = useState<Record<string, TestCase>>({}); // Cache test cases by ID
  const [isLoading, setIsLoading] = useState(true);
  const [loadingResults, setLoadingResults] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadTestRuns();
  }, [currentProject]);

  // Load test cases into cache
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
        // Only show test runs from projects owned by the user
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
          return []; // No projects owned by user
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
      return; // Already loaded or loading
    }

    setLoadingResults((prev) => new Set(prev).add(testRunId));

    try {
      // Get test results without trying to join with test_cases
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
                      <div className="border-t p-4 bg-gray-50">
                        <h4 className="font-medium mb-3">Test Details</h4>
                        {loadingResults.has(run.id) ? (
                          <div className="text-center py-4">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto mb-2"></div>
                            <div className="text-sm text-gray-500">
                              Loading test details...
                            </div>
                          </div>
                        ) : testResults[run.id] &&
                          testResults[run.id].length > 0 ? (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b">
                                  <th className="text-left p-2">Test Name</th>
                                  <th className="text-left p-2">Status</th>
                                  <th className="text-left p-2">Duration</th>
                                  <th className="text-left p-2">Error</th>
                                </tr>
                              </thead>
                              <tbody>
                                {testResults[run.id].map((result) => (
                                  <tr key={result.id} className="border-b">
                                    <td className="p-2 font-medium">
                                      {getTestCaseName(result.test_case_id)}
                                    </td>
                                    <td className="p-2">
                                      <Badge
                                        variant={
                                          result.status === "pass"
                                            ? "default"
                                            : "destructive"
                                        }
                                      >
                                        {result.status}
                                      </Badge>
                                    </td>
                                    <td className="p-2 text-gray-600">
                                      {formatDuration(result.duration_seconds)}
                                    </td>
                                    <td className="p-2 text-red-600 text-xs">
                                      {result.error_message || "-"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="text-center py-4 text-gray-500">
                            No test results found for this run.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default History;
