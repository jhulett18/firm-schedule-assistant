import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { GoogleCalendarConnections } from "@/components/admin/GoogleCalendarConnections";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { CheckCircle, XCircle, Link2, RefreshCw, Settings2, Phone, Mail, MessageSquare, Building2, TestTube, Save, Download, Unlink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface LawmaticsItem {
  id: string;
  name: string;
}

const AdminSettings = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const queryClient = useQueryClient();

  // Local state for contact fields
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactMessage, setContactMessage] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [hasContactChanges, setHasContactChanges] = useState(false);

  // Local state for mappings
  const [meetingTypeMappings, setMeetingTypeMappings] = useState<Record<string, string>>({});
  const [roomMappings, setRoomMappings] = useState<Record<string, string>>({});
  const [hasMeetingTypeChanges, setHasMeetingTypeChanges] = useState(false);
  const [hasRoomChanges, setHasRoomChanges] = useState(false);
  
  // Lawmatics reference data state
  const [isLoadingLawmaticsData, setIsLoadingLawmaticsData] = useState(false);
  const [lawmaticsEventTypes, setLawmaticsEventTypes] = useState<LawmaticsItem[]>([]);
  const [lawmaticsLocations, setLawmaticsLocations] = useState<LawmaticsItem[]>([]);
  const [lawmaticsDataFetchedAt, setLawmaticsDataFetchedAt] = useState<string | null>(null);
  const [lawmaticsDataCached, setLawmaticsDataCached] = useState(false);

  // Handle OAuth callback results
  useEffect(() => {
    const lawmaticsSuccess = searchParams.get("lawmatics_success");
    const lawmaticsError = searchParams.get("lawmatics_error");
    const googleSuccess = searchParams.get("google_success");
    const googleError = searchParams.get("google_error");

    if (lawmaticsSuccess === "true") {
      toast.success("Successfully connected to Lawmatics!");
      queryClient.invalidateQueries({ queryKey: ["lawmatics-connection"] });
    } else if (lawmaticsError) {
      toast.error(`Failed to connect to Lawmatics: ${lawmaticsError}`);
    }

    if (googleSuccess === "true") {
      toast.success("Successfully connected to Google Calendar!");
      queryClient.invalidateQueries({ queryKey: ["google-calendar-connections"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-connection-status"] });
    } else if (googleError) {
      toast.error(`Failed to connect to Google Calendar: ${googleError}`);
    }

    // Clear the query params
    if (lawmaticsSuccess || lawmaticsError || googleSuccess || googleError) {
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

  // Fetch app settings
  const { data: appSettings, isLoading: isLoadingSettings } = useQuery({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("*");

      if (error) throw error;
      return data || [];
    },
  });

  // Fetch meeting types
  const { data: meetingTypes } = useQuery({
    queryKey: ["meeting-types-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meeting_types")
        .select("id, name, lawmatics_event_type_id")
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch rooms
  const { data: rooms } = useQuery({
    queryKey: ["rooms-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rooms")
        .select("id, name, resource_email, lawmatics_location_id")
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  // Initialize contact fields from settings
  useEffect(() => {
    if (appSettings) {
      const phone = appSettings.find(s => s.key === "public_contact_phone")?.value || "";
      const email = appSettings.find(s => s.key === "public_contact_email")?.value || "";
      const message = appSettings.find(s => s.key === "public_contact_message")?.value || "";
      const company = appSettings.find(s => s.key === "legal_company_name")?.value || "";
      
      setContactPhone(phone);
      setContactEmail(email);
      setContactMessage(message);
      setCompanyName(company);
      setHasContactChanges(false);
    }
  }, [appSettings]);

  // Initialize meeting type mappings
  useEffect(() => {
    if (meetingTypes) {
      const mappings: Record<string, string> = {};
      meetingTypes.forEach(mt => {
        mappings[mt.id] = mt.lawmatics_event_type_id || "";
      });
      setMeetingTypeMappings(mappings);
      setHasMeetingTypeChanges(false);
    }
  }, [meetingTypes]);

  // Initialize room mappings
  useEffect(() => {
    if (rooms) {
      const mappings: Record<string, string> = {};
      rooms.forEach(r => {
        mappings[r.id] = r.lawmatics_location_id || "";
      });
      setRoomMappings(mappings);
      setHasRoomChanges(false);
    }
  }, [rooms]);

  // Track changes to contact fields
  useEffect(() => {
    if (appSettings) {
      const origPhone = appSettings.find(s => s.key === "public_contact_phone")?.value || "";
      const origEmail = appSettings.find(s => s.key === "public_contact_email")?.value || "";
      const origMessage = appSettings.find(s => s.key === "public_contact_message")?.value || "";
      const origCompany = appSettings.find(s => s.key === "legal_company_name")?.value || "";
      
      setHasContactChanges(
        contactPhone !== origPhone || 
        contactEmail !== origEmail || 
        contactMessage !== origMessage ||
        companyName !== origCompany
      );
    }
  }, [contactPhone, contactEmail, contactMessage, companyName, appSettings]);

  // Track changes to meeting type mappings
  useEffect(() => {
    if (meetingTypes) {
      const hasChanges = meetingTypes.some(mt => 
        (meetingTypeMappings[mt.id] || "") !== (mt.lawmatics_event_type_id || "")
      );
      setHasMeetingTypeChanges(hasChanges);
    }
  }, [meetingTypeMappings, meetingTypes]);

  // Track changes to room mappings
  useEffect(() => {
    if (rooms) {
      const hasChanges = rooms.some(r => 
        (roomMappings[r.id] || "") !== (r.lawmatics_location_id || "")
      );
      setHasRoomChanges(hasChanges);
    }
  }, [roomMappings, rooms]);

  const roomReservationMode = appSettings?.find(s => s.key === "room_reservation_mode")?.value || "LawmaticsSync";

  // Get Lawmatics test results from settings
  const lawmaticsLastTestAt = appSettings?.find(s => s.key === "lawmatics_last_test_at")?.value || "";
  const lawmaticsLastTestOk = appSettings?.find(s => s.key === "lawmatics_last_test_ok")?.value === "true";
  const lawmaticsLastTestError = appSettings?.find(s => s.key === "lawmatics_last_test_error")?.value || "";

  // Update setting mutation (for existing settings)
  const updateSettingMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      const { error } = await supabase
        .from("app_settings")
        .update({ value, updated_at: new Date().toISOString() })
        .eq("key", key);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("Setting updated");
    },
    onError: (error) => {
      toast.error(`Failed to update setting: ${error.message}`);
    },
  });

  // Upsert setting mutation (for settings that may not exist)
  const upsertSettingMutation = useMutation({
    mutationFn: async ({ key, value, description }: { key: string; value: string; description?: string }) => {
      const { error } = await supabase
        .from("app_settings")
        .upsert({ 
          key, 
          value, 
          description,
          updated_at: new Date().toISOString() 
        }, { 
          onConflict: "key" 
        });

      if (error) throw error;
    },
    onError: (error) => {
      toast.error(`Failed to save setting: ${error.message}`);
    },
  });

  // Save all contact settings
  const saveContactSettings = async () => {
    try {
      await Promise.all([
        upsertSettingMutation.mutateAsync({ 
          key: "public_contact_phone", 
          value: contactPhone,
          description: "Phone number displayed on public booking pages"
        }),
        upsertSettingMutation.mutateAsync({ 
          key: "public_contact_email", 
          value: contactEmail,
          description: "Email address displayed on public booking pages"
        }),
        upsertSettingMutation.mutateAsync({ 
          key: "public_contact_message", 
          value: contactMessage,
          description: "Custom message displayed on public booking pages when clients need help"
        }),
        upsertSettingMutation.mutateAsync({ 
          key: "legal_company_name", 
          value: companyName,
          description: "Company name displayed in footer and legal pages"
        }),
      ]);
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("Contact settings saved");
      setHasContactChanges(false);
    } catch (error) {
      // Error already handled in mutation
    }
  };

  // Connect to Lawmatics
  const connectMutation = useMutation({
    mutationFn: async () => {
      setIsConnecting(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("lawmatics-oauth-start", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { appUrl: window.location.origin },
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

  // Test Lawmatics API
  const testLawmatics = async () => {
    setIsTesting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("lawmatics-test", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error) throw error;

      if (data?.ok) {
        toast.success(data.message || "Lawmatics API connection verified!");
      } else {
        toast.error(data?.message || "Lawmatics API test failed");
      }

      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
    } catch (error) {
      toast.error(`Failed to test Lawmatics: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsTesting(false);
    }
  };

  // Disconnect Lawmatics
  const disconnectLawmatics = async () => {
    if (!confirm("Are you sure you want to disconnect Lawmatics? This will remove the connection and clear cached data.")) {
      return;
    }
    
    setIsDisconnecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("lawmatics-disconnect", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error) throw error;

      if (data?.disconnected) {
        toast.success("Lawmatics disconnected successfully");
        setLawmaticsEventTypes([]);
        setLawmaticsLocations([]);
        setLawmaticsDataFetchedAt(null);
        queryClient.invalidateQueries({ queryKey: ["lawmatics-connection"] });
      } else {
        toast.info(data?.message || "No connection to disconnect");
      }
    } catch (error) {
      toast.error(`Failed to disconnect Lawmatics: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsDisconnecting(false);
    }
  };

  // Load Lawmatics reference data
  const loadLawmaticsData = async (forceRefresh = false) => {
    setIsLoadingLawmaticsData(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const headers = { Authorization: `Bearer ${session.access_token}` };
      const body = forceRefresh ? JSON.stringify({ forceRefresh: true }) : undefined;

      // Fetch both in parallel
      const [eventTypesRes, locationsRes] = await Promise.all([
        supabase.functions.invoke("lawmatics-list-event-types", { headers, body }),
        supabase.functions.invoke("lawmatics-list-locations", { headers, body }),
      ]);

      if (eventTypesRes.error) throw eventTypesRes.error;
      if (locationsRes.error) throw locationsRes.error;

      // Handle reconnect required
      if (eventTypesRes.data?.reconnectRequired || locationsRes.data?.reconnectRequired) {
        toast.error("Lawmatics token invalid - please reconnect");
        return;
      }

      setLawmaticsEventTypes(eventTypesRes.data?.items || []);
      setLawmaticsLocations(locationsRes.data?.items || []);
      setLawmaticsDataFetchedAt(eventTypesRes.data?.fetched_at || locationsRes.data?.fetched_at);
      setLawmaticsDataCached(eventTypesRes.data?.cached || locationsRes.data?.cached);

      const eventCount = eventTypesRes.data?.items?.length || 0;
      const locationCount = locationsRes.data?.items?.length || 0;
      
      toast.success(`Loaded ${eventCount} event types and ${locationCount} locations`);
    } catch (error) {
      toast.error(`Failed to load Lawmatics data: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsLoadingLawmaticsData(false);
    }
  };

  // Save meeting type mappings
  const saveMeetingTypeMappings = async () => {
    try {
      await Promise.all(
        Object.entries(meetingTypeMappings).map(([id, value]) =>
          supabase
            .from("meeting_types")
            .update({ lawmatics_event_type_id: value || null, updated_at: new Date().toISOString() })
            .eq("id", id)
        )
      );
      queryClient.invalidateQueries({ queryKey: ["meeting-types-all"] });
      toast.success("Meeting type mappings saved");
      setHasMeetingTypeChanges(false);
    } catch (error) {
      toast.error(`Failed to save mappings: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  // Save room mappings
  const saveRoomMappings = async () => {
    try {
      await Promise.all(
        Object.entries(roomMappings).map(([id, value]) =>
          supabase
            .from("rooms")
            .update({ lawmatics_location_id: value || null, updated_at: new Date().toISOString() })
            .eq("id", id)
        )
      );
      queryClient.invalidateQueries({ queryKey: ["rooms-all"] });
      toast.success("Room mappings saved");
      setHasRoomChanges(false);
    } catch (error) {
      toast.error(`Failed to save mappings: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

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

        {/* Public Contact Information Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Public Contact Information
            </CardTitle>
            <CardDescription>
              Contact details shown to clients on public booking pages for help and support
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="company-name" className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Company/Firm Name
              </Label>
              <Input
                id="company-name"
                placeholder="Your Law Firm Name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Displayed in the footer and on legal pages (Privacy Policy, Terms of Service)
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="contact-phone" className="flex items-center gap-2">
                  <Phone className="h-4 w-4" />
                  Phone Number
                </Label>
                <Input
                  id="contact-phone"
                  type="tel"
                  placeholder="(555) 123-4567"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact-email" className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Email Address
                </Label>
                <Input
                  id="contact-email"
                  type="email"
                  placeholder="contact@yourfirm.com"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-message">
                Custom Help Message (optional)
              </Label>
              <Textarea
                id="contact-message"
                placeholder="Please contact our office if you need any assistance..."
                value={contactMessage}
                onChange={(e) => setContactMessage(e.target.value)}
                rows={2}
              />
              <p className="text-xs text-muted-foreground">
                This message appears when clients encounter issues or need to reschedule.
              </p>
            </div>
            <Button 
              onClick={saveContactSettings}
              disabled={!hasContactChanges || upsertSettingMutation.isPending}
            >
              {upsertSettingMutation.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Contact Settings"
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Feature Flags Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5" />
              Feature Flags
            </CardTitle>
            <CardDescription>
              Configure system behavior and feature toggles
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="room-reservation-mode">Room Reservation Mode</Label>
              <Select
                value={roomReservationMode}
                onValueChange={(value) => updateSettingMutation.mutate({ key: "room_reservation_mode", value })}
                disabled={isLoadingSettings || updateSettingMutation.isPending}
              >
                <SelectTrigger id="room-reservation-mode" className="w-[280px]">
                  <SelectValue placeholder="Select mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LawmaticsSync">LawmaticsSync (Default)</SelectItem>
                  <SelectItem value="DirectCalendar">DirectCalendar</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                <strong>LawmaticsSync:</strong> Room reservations handled through Lawmatics (default MVP behavior).
                <br />
                <strong>DirectCalendar:</strong> After Lawmatics booking, also creates a calendar event with the room resource as an attendee.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Google Calendar Connections Card */}
        <GoogleCalendarConnections />

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
          <CardContent className="space-y-6">
            {/* Connection Status */}
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
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    onClick={() => connectMutation.mutate()}
                    disabled={isConnecting || isDisconnecting}
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
                  <Button
                    variant="outline"
                    onClick={testLawmatics}
                    disabled={isTesting || isDisconnecting}
                  >
                    {isTesting ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Testing...
                      </>
                    ) : (
                      <>
                        <TestTube className="h-4 w-4 mr-2" />
                        Test API
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={disconnectLawmatics}
                    disabled={isDisconnecting || isConnecting}
                    className="text-destructive hover:text-destructive"
                  >
                    {isDisconnecting ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Disconnecting...
                      </>
                    ) : (
                      <>
                        <Unlink className="h-4 w-4 mr-2" />
                        Disconnect
                      </>
                    )}
                  </Button>
                </div>
                
                {/* Test Results */}
                {lawmaticsLastTestAt && (
                  <div className="text-sm border rounded-md p-3 space-y-1 bg-muted/50">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Last Test:</span>
                      {lawmaticsLastTestOk ? (
                        <Badge variant="outline" className="text-green-600 border-green-600">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Success
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-destructive border-destructive">
                          <XCircle className="h-3 w-3 mr-1" />
                          Failed
                        </Badge>
                      )}
                      <span className="text-muted-foreground">
                        {formatDistanceToNow(new Date(lawmaticsLastTestAt), { addSuffix: true })}
                      </span>
                    </div>
                    {!lawmaticsLastTestOk && lawmaticsLastTestError && (
                      <p className="text-destructive text-xs">{lawmaticsLastTestError}</p>
                    )}
                  </div>
                )}
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

            {/* Mappings Section - Only show when connected */}
            {lawmaticsConnection && (
              <>
                {/* Load Lawmatics Data Button */}
                <div className="flex items-center gap-4 pt-4 border-t">
                  <Button
                    variant="outline"
                    onClick={() => loadLawmaticsData(false)}
                    disabled={isLoadingLawmaticsData}
                  >
                    {isLoadingLawmaticsData ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4 mr-2" />
                        Load Lawmatics Data
                      </>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => loadLawmaticsData(true)}
                    disabled={isLoadingLawmaticsData}
                  >
                    <RefreshCw className="h-4 w-4 mr-1" />
                    Refresh
                  </Button>
                  {lawmaticsDataFetchedAt && (
                    <span className="text-sm text-muted-foreground">
                      Last fetched: {formatDistanceToNow(new Date(lawmaticsDataFetchedAt), { addSuffix: true })}
                      {lawmaticsDataCached && " (cached)"}
                    </span>
                  )}
                </div>

                {/* Meeting Type Mappings */}
                <div className="space-y-3 pt-4 border-t">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-medium">Meeting Type → Event Type Mapping</h4>
                      <p className="text-sm text-muted-foreground">
                        Map meeting types to Lawmatics event types
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={saveMeetingTypeMappings}
                      disabled={!hasMeetingTypeChanges}
                    >
                      <Save className="h-4 w-4 mr-1" />
                      Save
                    </Button>
                  </div>
                  {meetingTypes && meetingTypes.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Meeting Type</TableHead>
                          <TableHead>Lawmatics Event Type</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {meetingTypes.map((mt) => (
                          <TableRow key={mt.id}>
                            <TableCell className="font-medium">{mt.name}</TableCell>
                            <TableCell>
                              {lawmaticsEventTypes.length > 0 ? (
                                <Select
                                  value={meetingTypeMappings[mt.id] || "none"}
                                  onValueChange={(value) => setMeetingTypeMappings(prev => ({
                                    ...prev,
                                    [mt.id]: value === "none" ? "" : value
                                  }))}
                                >
                                  <SelectTrigger className="max-w-xs">
                                    <SelectValue placeholder="Select event type" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">— None —</SelectItem>
                                    {lawmaticsEventTypes.map((et) => (
                                      <SelectItem key={et.id} value={et.id}>
                                        {et.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <Input
                                    placeholder="Load data or enter ID"
                                    value={meetingTypeMappings[mt.id] || ""}
                                    onChange={(e) => setMeetingTypeMappings(prev => ({
                                      ...prev,
                                      [mt.id]: e.target.value
                                    }))}
                                    className="max-w-xs"
                                  />
                                  <span className="text-xs text-muted-foreground">
                                    Click "Load Lawmatics Data" for dropdown
                                  </span>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="text-sm text-muted-foreground">No meeting types configured.</p>
                  )}
                </div>

                {/* Room Mappings */}
                <div className="space-y-3 pt-4 border-t">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-medium">Room → Location Mapping</h4>
                      <p className="text-sm text-muted-foreground">
                        Map rooms to Lawmatics locations (for in-person meetings)
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={saveRoomMappings}
                      disabled={!hasRoomChanges}
                    >
                      <Save className="h-4 w-4 mr-1" />
                      Save
                    </Button>
                  </div>
                  {rooms && rooms.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Room</TableHead>
                          <TableHead>Resource Email</TableHead>
                          <TableHead>Lawmatics Location</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rooms.map((room) => (
                          <TableRow key={room.id}>
                            <TableCell className="font-medium">{room.name}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">{room.resource_email}</TableCell>
                            <TableCell>
                              {lawmaticsLocations.length > 0 ? (
                                <Select
                                  value={roomMappings[room.id] || "none"}
                                  onValueChange={(value) => setRoomMappings(prev => ({
                                    ...prev,
                                    [room.id]: value === "none" ? "" : value
                                  }))}
                                >
                                  <SelectTrigger className="max-w-xs">
                                    <SelectValue placeholder="Select location" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">— None —</SelectItem>
                                    {lawmaticsLocations.map((loc) => (
                                      <SelectItem key={loc.id} value={loc.id}>
                                        {loc.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <Input
                                    placeholder="Load data or enter ID"
                                    value={roomMappings[room.id] || ""}
                                    onChange={(e) => setRoomMappings(prev => ({
                                      ...prev,
                                      [room.id]: e.target.value
                                    }))}
                                    className="max-w-xs"
                                  />
                                  <span className="text-xs text-muted-foreground">
                                    Click "Load Lawmatics Data" for dropdown
                                  </span>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="text-sm text-muted-foreground">No rooms configured.</p>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
};

export default AdminSettings;
