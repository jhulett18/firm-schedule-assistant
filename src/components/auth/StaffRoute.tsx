import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

interface StaffRouteProps {
  children: React.ReactNode;
}

export function StaffRoute({ children }: StaffRouteProps) {
  const { user, isLoading, isAdmin, isStaff } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // If user is logged in but not staff/admin, redirect to client portal
  if (!isAdmin && !isStaff) {
    return <Navigate to="/client" replace />;
  }

  return <>{children}</>;
}
