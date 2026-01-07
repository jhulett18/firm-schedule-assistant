import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

export default function Index() {
  const { user, isLoading, rolesLoaded, userRole } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    console.log('Index routing - isLoading:', isLoading, 'rolesLoaded:', rolesLoaded, 'user:', !!user, 'userRole:', userRole);
    
    // Wait until both auth state AND roles are loaded
    if (isLoading || (user && !rolesLoaded)) {
      console.log('Still loading auth or roles...');
      return;
    }
    
    if (user) {
      // All authenticated users go to dashboard (only admin/staff can login now)
      console.log('User authenticated, routing to dashboard');
      navigate("/dashboard", { replace: true });
    } else {
      console.log('No user, routing to auth');
      navigate("/auth", { replace: true });
    }
  }, [user, isLoading, rolesLoaded, userRole, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}
