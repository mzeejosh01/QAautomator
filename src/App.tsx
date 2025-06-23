/* eslint-disable @typescript-eslint/no-explicit-any */
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
} from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { auth, api, type Profile, type Project } from "@/lib/supabase";
import Auth from "@/components/Auth";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

// App Context
interface AppContextType {
  user: any;
  profile: Profile | null;
  currentProject: Project | null;
  projects: Project[];
  setCurrentProject: (project: Project | null) => void;
  refreshProjects: () => Promise<void>;
  isLoading: boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const useApp = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
};

const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);

  // Use refs to track loading states and prevent race conditions
  const isLoadingRef = useRef(false);
  const hasLoadedUserDataRef = useRef(false);

  // Initialize auth state only once
  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      try {
        const {
          data: { user },
        } = await auth.getUser();

        if (mounted) {
          setUser(user);
          setIsAuthLoading(false);
          setIsInitialized(true);

          if (user) {
            await loadUserData();
          }
        }
      } catch (error) {
        console.error("Auth initialization error:", error);
        if (mounted) {
          setIsAuthLoading(false);
          setIsInitialized(true);
        }
      }
    };

    initializeAuth();

    return () => {
      mounted = false;
    };
  }, []);

  // Listen for auth changes only after initialization
  useEffect(() => {
    if (!isInitialized) return;

    const {
      data: { subscription },
    } = auth.onAuthStateChange(async (event, session) => {
      console.log("Auth state changed:", event, !!session?.user);

      // Handle different auth events appropriately
      if (event === "SIGNED_IN") {
        setUser(session?.user || null);
        // Only load data if we haven't loaded it yet or if this is a new user
        if (
          !hasLoadedUserDataRef.current ||
          (session?.user && session.user.id !== user?.id)
        ) {
          await loadUserData();
        }
      } else if (event === "SIGNED_OUT") {
        // Clear all data on sign out
        setUser(null);
        setProfile(null);
        setProjects([]);
        setCurrentProject(null);
        hasLoadedUserDataRef.current = false;
      } else if (event === "TOKEN_REFRESHED" && session?.user) {
        // Just update the user, don't reload all data
        setUser(session.user);
      }
      // Ignore other events like INITIAL_SESSION to prevent unnecessary reloads
    });

    return () => subscription.unsubscribe();
  }, [isInitialized, user?.id]);

  const loadUserData = async () => {
    // Prevent multiple simultaneous loads
    if (isLoadingRef.current) {
      return;
    }

    try {
      isLoadingRef.current = true;
      setIsLoading(true);

      // Load profile
      const profileData = await api.getProfile();
      setProfile(profileData);

      // Load projects
      await refreshProjects();

      hasLoadedUserDataRef.current = true;
    } catch (error) {
      console.error("Failed to load user data:", error);
      // Don't throw error, just log it
    } finally {
      isLoadingRef.current = false;
      setIsLoading(false);
    }
  };

  const refreshProjects = async () => {
    try {
      const projectsData = await api.getProjects();
      setProjects(projectsData);

      // Set first project as current if none selected
      if (!currentProject && projectsData.length > 0) {
        setCurrentProject(projectsData[0]);
      }
      // Clear current project if it no longer exists
      else if (
        currentProject &&
        !projectsData.find((p) => p.id === currentProject.id)
      ) {
        setCurrentProject(projectsData[0] || null);
      }
    } catch (error) {
      console.error("Failed to load projects:", error);
      throw error; // Re-throw to be handled by loadUserData
    }
  };

  // Handle visibility change to prevent unnecessary reloads
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        user &&
        !hasLoadedUserDataRef.current
      ) {
        // Only reload if we haven't loaded data yet
        loadUserData();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [user]);

  const value: AppContextType = {
    user,
    profile,
    currentProject,
    projects,
    setCurrentProject,
    refreshProjects,
    isLoading,
  };

  // Show loading only during initial auth check
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-blue-600 rounded-full mx-auto mb-4 flex items-center justify-center animate-pulse">
            <span className="text-white font-bold text-xl">QA</span>
          </div>
          <p className="text-gray-600">Loading QA Autopilot...</p>
        </div>
      </div>
    );
  }

  // Show auth screen if not authenticated
  if (!user) {
    return <Auth onAuthSuccess={() => {}} />;
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AppProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AppProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
