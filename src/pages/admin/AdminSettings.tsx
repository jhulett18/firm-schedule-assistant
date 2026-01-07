import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { CheckCircle, XCircle, Link2, RefreshCw, Settings2, Phone, Mail, MessageSquare } from "lucide-react";

const AdminSettings = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [isConnecting, setIsConnecting] = useState(false);
  const queryClient = useQueryClient();

  // Local state for contact fields
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactMessage, setContactMessage] = useState("");
  const [hasContactChanges, setHasContactChanges] = useState(false);

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

  // Initialize contact fields from settings
  useEffect(() => {
    if (appSettings) {
      const phone = appSettings.find(s => s.key === "public_contact_phone")?.value || "";
      const email = appSettings.find(s => s.key === "public_contact_email")?.value || "";
      const message = appSettings.find(s => s.key === "public_contact_message")?.value || "";
      
      setContactPhone(phone);
      setContactEmail(email);
      setContactMessage(message);
      setHasContactChanges(false);
    }
  }, [appSettings]);

  // Track changes to contact fields
  useEffect(() => {
    if (appSettings) {
      const origPhone = appSettings.find(s => s.key === "public_contact_phone")?.value || "";
      const origEmail = appSettings.find(s => s.key === "public_contact_email")?.value || "";
      const origMessage = appSettings.find(s => s.key === "public_contact_message")?.value || "";
      
      setHasContactChanges(
        contactPhone !== origPhone || 
        contactEmail !== origEmail || 
        contactMessage !== origMessage
      );
    }
  }, [contactPhone, contactEmail, contactMessage, appSettings]);

  const roomReservationMode = appSettings?.find(s => s.key === "room_reservation_mode")?.value || "LawmaticsSync";

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
