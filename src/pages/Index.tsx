import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

export default function Index() {
  const { user, isLoading, isAdmin, isStaff } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading) {
      if (user) {
        // Route based on role
        if (isAdmin || isStaff) {
          navigate("/dashboard", { replace: true });
        } else {
          navigate("/client", { replace: true });
        }
      } else {
        navigate("/auth", { replace: true });
      }
    }
  }, [user, isLoading, isAdmin, isStaff, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}
