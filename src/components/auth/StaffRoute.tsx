import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useRef } from 'react';

interface StaffRouteProps {
  children: React.ReactNode;
}

export function StaffRoute({ children }: StaffRouteProps) {
  const { user, internalUser, isLoading, rolesLoaded, isAdmin, isStaff, isClient, isDevMode } = useAuth();
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

  // User not approved -> redirect to pending approval page
  if (rolesLoaded && internalUser && internalUser.approved === false) {
    return <Navigate to="/pending-approval" replace />;
  }

  // Client trying to access staff pages -> redirect to client portal
  if (rolesLoaded && isClient) {
    return <Navigate to="/client" replace />;
  }

  // User exists, roles loaded, is admin or staff -> allow
  if (rolesLoaded && (isAdmin || isStaff)) {
    return <>{children}</>;
  }

  // User exists, roles loaded, but no valid role
  if (rolesLoaded && !isAdmin && !isStaff && !isClient) {
    if (!hasShownErrorRef.current) {
      hasShownErrorRef.current = true;
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
