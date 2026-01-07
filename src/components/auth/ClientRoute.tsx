import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

interface ClientRouteProps {
  children: React.ReactNode;
}

export function ClientRoute({ children }: ClientRouteProps) {
  const { user, isLoading, rolesLoaded, isClient, isAdmin, isStaff, isDevMode } = useAuth();

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

  // Staff or admin trying to access client portal -> redirect to dashboard
  if (rolesLoaded && (isAdmin || isStaff)) {
    return <Navigate to="/dashboard" replace />;
  }

  // Dev mode users are admin, so they get redirected to dashboard above
  // Only actual clients can access this route

  // User exists, roles loaded, and is a client
  if (rolesLoaded && isClient) {
    return <>{children}</>;
  }

  // Edge case: roles loaded but user has no valid role - redirect to auth
  return <Navigate to="/auth" replace />;
}
