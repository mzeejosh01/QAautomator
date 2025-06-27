/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from "react";
import { Zap } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApp } from "@/App";
import FunctionalTesting from "./FunctionalTesting";
import LoadTesting from "./LoadTesting";

const Dashboard = () => {
  const { currentProject } = useApp();
  const [testType, setTestType] = useState<"functional" | "load">("functional");

  if (!currentProject) {
    return null; // This will be handled by the Index component
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
      {/* Test Type Tabs */}
      <Tabs
        value={testType}
        onValueChange={(v) => setTestType(v as "functional" | "load")}
      >
        <TabsList className="grid w-fit grid-cols-2">
          <TabsTrigger value="functional">Functional Testing</TabsTrigger>
          <TabsTrigger value="load">
            <Zap className="w-4 h-4 mr-2" />
            Load Testing
          </TabsTrigger>
        </TabsList>

        <TabsContent value="functional" className="space-y-8">
          <FunctionalTesting />
        </TabsContent>

        <TabsContent value="load" className="space-y-8">
          <LoadTesting />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Dashboard;
