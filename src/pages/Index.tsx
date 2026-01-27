import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

export default function Index() {
  const { user, isLoading, rolesLoaded, userRole, isSuperuser } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    console.log('Index routing - isLoading:', isLoading, 'rolesLoaded:', rolesLoaded, 'user:', !!user, 'userRole:', userRole, 'isSuperuser:', isSuperuser);
    
    // Wait until both auth state AND roles are loaded
    if (isLoading || (user && !rolesLoaded)) {
      console.log('Still loading auth or roles...');
      return;
    }
    
    if (user && rolesLoaded) {
      // Route based on role - superusers go to dashboard by default
      if (isSuperuser) {
        console.log('Superuser, routing to /dashboard');
        navigate("/dashboard", { replace: true });
      } else if (userRole === 'client') {
        console.log('Client user, routing to /client');
        navigate("/client", { replace: true });
      } else if (userRole === 'admin' || userRole === 'staff') {
        console.log('Staff/admin user, routing to /dashboard');
        navigate("/dashboard", { replace: true });
      } else {
        // No valid role - redirect to auth
        console.log('No valid role, routing to /auth');
        navigate("/auth", { replace: true });
      }
    } else {
      console.log('No user, routing to auth');
      navigate("/auth", { replace: true });
    }
  }, [user, isLoading, rolesLoaded, userRole, isSuperuser, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}
