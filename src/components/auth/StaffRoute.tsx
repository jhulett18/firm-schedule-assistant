import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useEffect, useRef } from 'react';

interface StaffRouteProps {
  children: React.ReactNode;
}

export function StaffRoute({ children }: StaffRouteProps) {
  const { user, isLoading, rolesLoaded, isAdmin, isStaff, isDevMode } = useAuth();
  const { toast } = useToast();
  const hasShownErrorRef = useRef(false);

  // Show loading while auth or roles are loading
  if (isLoading || (user && !rolesLoaded && !isDevMode)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
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

  // User exists, roles loaded, but not admin or staff
  if (rolesLoaded && !isAdmin && !isStaff) {
    // Show error toast once
    if (!hasShownErrorRef.current) {
      hasShownErrorRef.current = true;
      // Use setTimeout to avoid state update during render
      setTimeout(() => {
        toast({
          title: 'Access Denied',
          description: 'You do not have permission to access this area. Please contact an administrator.',
          variant: 'destructive',
        });
      }, 0);
    }
    return <Navigate to="/auth" replace />;
  }

  return <>{children}</>;
}
