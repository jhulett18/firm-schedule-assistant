import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle, XCircle, Link2, RefreshCw } from "lucide-react";

const AdminSettings = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [isConnecting, setIsConnecting] = useState(false);
  const queryClient = useQueryClient();

  // Handle OAuth callback results
  useEffect(() => {
    const success = searchParams.get("lawmatics_success");
    const error = searchParams.get("lawmatics_error");

    if (success === "true") {
      toast.success("Successfully connected to Lawmatics!");
      queryClient.invalidateQueries({ queryKey: ["lawmatics-connection"] });
    } else if (error) {
      toast.error(`Failed to connect to Lawmatics: ${error}`);
    }

    // Clear the query params
    if (success || error) {
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, queryClient]);

  // Fetch Lawmatics connection status
  const { data: lawmaticsConnection, isLoading: isLoadingLawmatics } = useQuery({
    queryKey: ["lawmatics-connection"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lawmatics_connections")
        .select("id, connected_at, connected_by_user_id, users:connected_by_user_id(name)")
        .order("connected_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
  });

  // Connect to Lawmatics
  const connectMutation = useMutation({
    mutationFn: async () => {
      setIsConnecting(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("lawmatics-oauth-start", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error) throw error;
      if (!data?.url) throw new Error("No authorization URL returned");

      // Redirect to Lawmatics OAuth
      window.location.href = data.url;
    },
    onError: (error) => {
      setIsConnecting(false);
      toast.error(`Failed to start Lawmatics connection: ${error.message}`);
    },
  });

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground">Manage integrations and system settings</p>
        </div>

        {/* Lawmatics Integration Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              Lawmatics Integration
            </CardTitle>
            <CardDescription>
              Connect to Lawmatics to automatically create calendar events when bookings are confirmed
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingLawmatics ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Loading connection status...
              </div>
            ) : lawmaticsConnection ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Badge variant="default" className="bg-green-600">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Connected
                  </Badge>
                </div>
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>Connected on: {formatDate(lawmaticsConnection.connected_at)}</p>
                  {(lawmaticsConnection.users as any)?.name && (
                    <p>Connected by: {(lawmaticsConnection.users as any).name}</p>
                  )}
                </div>
                <Button
                  variant="outline"
                  onClick={() => connectMutation.mutate()}
                  disabled={isConnecting}
                >
                  {isConnecting ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Reconnecting...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Reconnect
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    <XCircle className="h-3 w-3 mr-1" />
                    Not Connected
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Connect your firm's Lawmatics account to enable automatic event creation when clients confirm their bookings.
                </p>
                <Button
                  onClick={() => connectMutation.mutate()}
                  disabled={isConnecting}
                >
                  {isConnecting ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <Link2 className="h-4 w-4 mr-2" />
                      Connect to Lawmatics
                    </>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
};

export default AdminSettings;
