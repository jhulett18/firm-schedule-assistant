import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

export default function Index() {
  const { user, isLoading, isAdmin, isStaff, userRole } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    console.log('Index routing - isLoading:', isLoading, 'user:', !!user, 'isAdmin:', isAdmin, 'isStaff:', isStaff, 'userRole:', userRole);
    
    if (!isLoading) {
      if (user) {
        // Route based on role - use userRole as the source of truth
        if (userRole === 'admin' || userRole === 'staff') {
          console.log('Routing to dashboard');
          navigate("/dashboard", { replace: true });
        } else {
          console.log('Routing to client');
          navigate("/client", { replace: true });
        }
      } else {
        navigate("/auth", { replace: true });
      }
    }
  }, [user, isLoading, userRole, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}
