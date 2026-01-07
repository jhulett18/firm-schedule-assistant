import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Calendar, CheckCircle, XCircle, RefreshCw, Eye, Link2, AlertCircle, Search } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface CalendarConnection {
  id: string;
  user_id: string;
  provider: string;
  token_expires_at: string | null;
  last_verified_at: string | null;
  last_verified_ok: boolean | null;
  last_verified_error: string | null;
  last_calendar_list_count: number | null;
  created_at: string;
  users: {
    id: string;
    name: string;
    email: string;
  } | null;
}

interface CalendarInfo {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  timeZone: string;
  selected: boolean;
}

export function GoogleCalendarConnections() {
  const { isAdmin, internalUser } = useAuth();
  const queryClient = useQueryClient();
  const [isConnecting, setIsConnecting] = useState(false);
  const [viewingCalendars, setViewingCalendars] = useState<string | null>(null);
  const [calendars, setCalendars] = useState<CalendarInfo[]>([]);
  const [calendarSearch, setCalendarSearch] = useState("");
  const [isLoadingCalendars, setIsLoadingCalendars] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);

  // Fetch all calendar connections (admin sees all, staff sees own)
  const { data: connections, isLoading: loadingConnections } = useQuery({
    queryKey: ["google-calendar-connections", isAdmin],
    queryFn: async () => {
      let query = supabase
        .from("calendar_connections")
        .select(`
          id,
          user_id,
          provider,
          token_expires_at,
          last_verified_at,
          last_verified_ok,
          last_verified_error,
          last_calendar_list_count,
          created_at,
          users:user_id (id, name, email)
        `)
        .eq("provider", "google")
        .order("created_at", { ascending: false });

      if (!isAdmin && internalUser?.id) {
        query = query.eq("user_id", internalUser.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as CalendarConnection[];
    },
  });

  // Verify connection mutation
  const verifyMutation = useMutation({
    mutationFn: async (internalUserId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("google-connection-status", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { internalUserId },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-connections"] });
      if (data.verified_ok) {
        toast.success("Google Calendar verified successfully");
      } else {
        toast.error(`Verification failed: ${data.error || "Unknown error"}`);
      }
    },
    onError: (error) => {
      toast.error(`Failed to verify: ${error.message}`);
    },
  });

  // View calendars
  const handleViewCalendars = async (internalUserId: string) => {
    setViewingCalendars(internalUserId);
    setIsLoadingCalendars(true);
    setCalendarError(null);
    setCalendars([]);
    setCalendarSearch("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("google-list-calendars", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { internalUserId },
      });

      if (error) throw error;

      if (data.error) {
        setCalendarError(data.error);
      } else {
        setCalendars(data.calendars || []);
        queryClient.invalidateQueries({ queryKey: ["google-calendar-connections"] });
      }
    } catch (err) {
      setCalendarError(err instanceof Error ? err.message : "Failed to load calendars");
    } finally {
      setIsLoadingCalendars(false);
    }
  };

  // Connect Google Calendar
  const connectMutation = useMutation({
    mutationFn: async () => {
      setIsConnecting(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("google-oauth-start", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error) throw error;
      if (!data?.authUrl) throw new Error("No authorization URL returned");

      window.location.href = data.authUrl;
    },
    onError: (error) => {
      setIsConnecting(false);
      toast.error(`Failed to start Google connection: ${error.message}`);
    },
  });

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "Never";
    return formatDistanceToNow(new Date(dateString), { addSuffix: true });
  };

  const filteredCalendars = calendars.filter(
    (cal) =>
      cal.summary.toLowerCase().includes(calendarSearch.toLowerCase()) ||
      cal.id.toLowerCase().includes(calendarSearch.toLowerCase())
  );

  return (
    <>
      <Card id="calendar">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Google Calendar Connections
          </CardTitle>
          <CardDescription>
            Manage Google Calendar integrations for checking availability
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingConnections ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Loading connections...
            </div>
          ) : connections && connections.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Verified</TableHead>
                    <TableHead>Calendars</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {connections.map((conn) => (
                    <TableRow key={conn.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{conn.users?.name || "Unknown"}</div>
                          <div className="text-sm text-muted-foreground">{conn.users?.email}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {conn.last_verified_ok === null ? (
                          <Badge variant="secondary">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            Not Verified
                          </Badge>
                        ) : conn.last_verified_ok ? (
                          <Badge className="bg-green-600">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Verified
                          </Badge>
                        ) : (
                          <Badge variant="destructive">
                            <XCircle className="h-3 w-3 mr-1" />
                            Failed
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {formatDate(conn.last_verified_at)}
                          {conn.last_verified_error && (
                            <div className="text-xs text-destructive mt-0.5 max-w-[200px] truncate" title={conn.last_verified_error}>
                              {conn.last_verified_error}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {conn.last_calendar_list_count !== null ? (
                          <span className="text-sm">{conn.last_calendar_list_count}</span>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => verifyMutation.mutate(conn.user_id)}
                          disabled={verifyMutation.isPending}
                        >
                          {verifyMutation.isPending ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                          <span className="ml-1 hidden sm:inline">Verify</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewCalendars(conn.user_id)}
                        >
                          <Eye className="h-4 w-4" />
                          <span className="ml-1 hidden sm:inline">View</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-6 text-muted-foreground">
              <Calendar className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No Google Calendar connections found.</p>
              <p className="text-sm">Connect your Google Calendar to check availability.</p>
            </div>
          )}

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
                Connect My Google Calendar
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* View Calendars Dialog */}
      <Dialog open={viewingCalendars !== null} onOpenChange={(open) => !open && setViewingCalendars(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Google Calendars</DialogTitle>
            <DialogDescription>
              Calendars available in this Google account
            </DialogDescription>
          </DialogHeader>

          {isLoadingCalendars ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin mr-2" />
              Loading calendars...
            </div>
          ) : calendarError ? (
            <div className="text-center py-8">
              <XCircle className="h-12 w-12 mx-auto mb-3 text-destructive opacity-50" />
              <p className="text-destructive">{calendarError}</p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => viewingCalendars && handleViewCalendars(viewingCalendars)}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry
              </Button>
            </div>
          ) : calendars.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Calendar className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No calendars found in this account.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search calendars..."
                  value={calendarSearch}
                  onChange={(e) => setCalendarSearch(e.target.value)}
                  className="pl-9"
                />
              </div>

              <div className="max-h-[400px] overflow-y-auto space-y-2">
                {filteredCalendars.map((cal) => (
                  <div
                    key={cal.id}
                    className="flex items-start justify-between p-3 rounded-lg border bg-card"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{cal.summary}</div>
                      <div className="text-xs text-muted-foreground truncate">{cal.id}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Timezone: {cal.timeZone}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 ml-2 shrink-0">
                      {cal.primary && (
                        <Badge variant="default" className="text-xs">Primary</Badge>
                      )}
                      {cal.selected && (
                        <Badge variant="secondary" className="text-xs">Selected</Badge>
                      )}
                      <Badge variant="outline" className="text-xs">{cal.accessRole}</Badge>
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-sm text-muted-foreground">
                Showing {filteredCalendars.length} of {calendars.length} calendars
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
