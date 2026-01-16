import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

interface SuperuserRouteProps {
  children: ReactNode;
}

export function SuperuserRoute({ children }: SuperuserRouteProps) {
  const { user, isLoading, rolesLoaded, isSuperuser } = useAuth();

  if (isLoading || (user && !rolesLoaded)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (!isSuperuser) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
