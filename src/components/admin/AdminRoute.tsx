import { ReactNode, useRef } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface AdminRouteProps {
  children: ReactNode;
}

export function AdminRoute({ children }: AdminRouteProps) {
  const { user, isAdmin, isLoading, rolesLoaded, isDevMode } = useAuth();
  const { toast } = useToast();
  const hasShownErrorRef = useRef(false);

  // Show loading while auth or roles are loading
  if (isLoading || (user && !rolesLoaded && !isDevMode)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // No user -> redirect to auth
  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // Dev mode bypasses role checks
  if (isDevMode) {
    return <>{children}</>;
  }

  // User exists, roles loaded, but not admin
  if (rolesLoaded && !isAdmin) {
    if (!hasShownErrorRef.current) {
      hasShownErrorRef.current = true;
      setTimeout(() => {
        toast({
          title: 'Access Denied',
          description: 'You need admin privileges to access this page.',
          variant: 'destructive',
        });
      }, 0);
    }
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
