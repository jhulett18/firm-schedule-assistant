import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { addDays, format } from "date-fns";
import {
  ArrowLeft,
  ArrowRight,
  User,
  FileText,
  Users,
  DoorOpen,
  Clock,
  CheckCircle,
  Copy,
  Mail,
  ExternalLink,
} from "lucide-react";
import { copyToClipboard, getBookingUrl, generateClientEmailTemplate } from "@/lib/clipboard";

const STEPS = [
  { id: "client", label: "Client Details", icon: User },
  { id: "meeting", label: "Meeting Type", icon: FileText },
  { id: "participants", label: "Participants", icon: Users },
  { id: "room", label: "Room", icon: DoorOpen },
  { id: "schedule", label: "Scheduling", icon: Clock },
  { id: "review", label: "Review", icon: CheckCircle },
];

interface FormData {
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  meetingTypeId: string;
  duration: number;
  locationMode: "Zoom" | "InPerson";
  hostAttorneyId: string;
  supportStaffIds: string[];
  roomId: string;
  searchWindowDays: number;
  allowWeekends: boolean;
  timePreference: string;
  minNoticeHours: number;
  googleCalendarId: string; // Admin-selected calendar for creating events
}

const initialFormData: FormData = {
  clientName: "",
  clientEmail: "",
  clientPhone: "",
  meetingTypeId: "",
  duration: 60,
  locationMode: "Zoom",
  hostAttorneyId: "",
  supportStaffIds: [],
  roomId: "",
  searchWindowDays: 30,
  allowWeekends: false,
  timePreference: "None",
  minNoticeHours: 24,
  googleCalendarId: "", // Will be set when admin selects a calendar
};

export default function RequestNew() {
  const navigate = useNavigate();
  const { internalUser } = useAuth();
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  // Fetch meeting types
  const { data: meetingTypes } = useQuery({
    queryKey: ["meeting-types-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meeting_types")
        .select("id, name, allowed_location_modes")
        .eq("active", true);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch attorneys (users with admin role in user_roles table)
  const { data: attorneys } = useQuery({
    queryKey: ["users-attorneys-admin"],
    queryFn: async () => {
      // First get user IDs that have admin role
      const { data: adminRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin");
      
      if (rolesError) throw rolesError;
      if (!adminRoles || adminRoles.length === 0) return [];

      const adminAuthIds = adminRoles.map((r) => r.user_id);
      
      // Then get users matching those auth_user_ids
      const { data, error } = await supabase
        .from("users")
        .select("id, name, email, role, auth_user_id")
        .eq("active", true)
        .in("auth_user_id", adminAuthIds);
      
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch support staff
  const { data: supportStaff } = useQuery({
    queryKey: ["users-support"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("id, name, email, role")
        .eq("active", true)
        .eq("role", "SupportStaff");
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch rooms
  const { data: rooms } = useQuery({
    queryKey: ["rooms-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rooms")
        .select("id, name")
        .eq("active", true);
      if (error) throw error;
      return data || [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      // Create meeting - persist admin creator and selected calendar for downstream Google event creation
      const { data: meeting, error: meetingError } = await supabase
        .from("meetings")
        .insert({
          meeting_type_id: formData.meetingTypeId || null,
          duration_minutes: formData.duration,
          location_mode: formData.locationMode,
          host_attorney_user_id: formData.hostAttorneyId || null,
          support_user_ids: formData.supportStaffIds,
          room_id: formData.locationMode === "InPerson" && formData.roomId ? formData.roomId : null,
          external_attendees: [
            {
              name: formData.clientName,
              email: formData.clientEmail,
              phone: formData.clientPhone,
            },
          ],
          preferences: {
            timeOfDay: formData.timePreference,
            minNoticeHours: formData.minNoticeHours,
            allowWeekends: formData.allowWeekends,
          },
          search_window_days_used: formData.searchWindowDays,
          status: "Proposed",
          // Store admin creator and selected calendar for Google event creation at confirm time
          created_by_user_id: internalUser?.id || null,
          google_calendar_id: formData.googleCalendarId || null,
        })
        .select("id")
        .single();

      if (meetingError) {
        console.error("[CreateRequest] meetings insert error:", meetingError);
        throw meetingError;
      }

      // Create booking request - explicitly select only needed columns
      const expiresAt = addDays(new Date(), 7);
      const { data: bookingRequest, error: brError } = await supabase
        .from("booking_requests")
        .insert({
          meeting_id: meeting.id,
          expires_at: expiresAt.toISOString(),
          status: "Open",
        })
        .select("id, public_token, meeting_id")
        .single();

      if (brError) {
        console.error("[CreateRequest] booking_requests insert error:", brError);
        throw brError;
      }

      return bookingRequest.public_token;
    },
    onSuccess: (token) => {
      setCreatedToken(token);
      queryClient.invalidateQueries({ queryKey: ["booking-requests"] });
      queryClient.invalidateQueries({ queryKey: ["recent-meetings"] });
    },
    onError: (error: Error & { code?: string; details?: string; hint?: string }) => {
      console.error("[CreateRequest] Full error object:", error);
      // Improved error message for permission denied issues
      const isUsersPermissionError = error.message?.toLowerCase().includes("permission denied for table user");
      if (isUsersPermissionError) {
        toast.error("Create Request failed due to restricted access to users table. This is a UI query/RLS issue.", {
          description: `Code: ${error.code || "unknown"} | ${error.message}`,
          duration: 10000,
        });
      } else {
        toast.error(`Failed to create request: ${error.message}`, {
          description: error.details || error.hint || undefined,
          duration: 8000,
        });
      }
    },
  });

  const validateStep = (step: number): boolean => {
    const newErrors: Record<string, string> = {};

    switch (step) {
      case 0: // Client details
        if (!formData.clientName.trim()) newErrors.clientName = "Name is required";
        if (!formData.clientEmail.trim()) newErrors.clientEmail = "Email is required";
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.clientEmail)) {
          newErrors.clientEmail = "Invalid email format";
        }
        break;
      case 1: // Meeting type
        // Meeting type is optional but duration is required
        if (!formData.duration || formData.duration < 15) {
          newErrors.duration = "Duration must be at least 15 minutes";
        }
        break;
      case 2: // Participants
        // Optional
        break;
      case 3: // Room
        // Only validate if in-person
        break;
      case 4: // Schedule
        if (!formData.searchWindowDays || formData.searchWindowDays < 1) {
          newErrors.searchWindowDays = "Search window must be at least 1 day";
        }
        break;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      if (currentStep === STEPS.length - 1) {
        createMutation.mutate();
      } else {
        setCurrentStep((prev) => prev + 1);
      }
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    } else {
      navigate("/requests");
    }
  };

  const updateForm = (updates: Partial<FormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }));
    setErrors({});
  };

  const selectedMeetingType = meetingTypes?.find((mt) => mt.id === formData.meetingTypeId);
  const progressPercent = ((currentStep + 1) / STEPS.length) * 100;

  // Success state
  if (createdToken) {
    const bookingUrl = getBookingUrl(createdToken);
    const emailTemplate = generateClientEmailTemplate({
      clientName: formData.clientName,
      meetingTypeName: selectedMeetingType?.name || "Meeting",
      bookingUrl,
      expiresAt: format(addDays(new Date(), 7), "MMMM d, yyyy 'at' h:mm a"),
    });

    return (
      <MainLayout>
        <div className="max-w-xl mx-auto">
          <Card className="border-status-success">
            <CardHeader className="text-center">
              <div className="w-16 h-16 rounded-full bg-status-success/20 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-status-success" />
              </div>
              <CardTitle className="text-2xl">Booking Request Created!</CardTitle>
              <CardDescription>
                Send the link below to {formData.clientName}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label className="text-sm text-muted-foreground">Client Booking Link</Label>
                <div className="flex gap-2 mt-1">
                  <Input value={bookingUrl} readOnly className="font-mono text-sm" />
                  <Button
                    variant="outline"
                    onClick={() => copyToClipboard(bookingUrl, "Link copied!")}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => copyToClipboard(emailTemplate, "Email template copied!")}
                >
                  <Mail className="w-4 h-4 mr-2" />
                  Copy Email Template
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => window.open(bookingUrl, "_blank")}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Preview Client View
                </Button>
              </div>

              <div className="border-t pt-4">
                <Button className="w-full" onClick={() => navigate("/requests")}>
                  Go to Booking Requests
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="max-w-2xl mx-auto">
        {/* Progress header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-xl font-serif font-bold">Create Booking Request</h1>
            <span className="text-sm text-muted-foreground">
              Step {currentStep + 1} of {STEPS.length}
            </span>
          </div>
          <Progress value={progressPercent} className="h-2" />
          <div className="flex justify-between mt-2">
            {STEPS.map((step, index) => {
              const Icon = step.icon;
              const isActive = index === currentStep;
              const isCompleted = index < currentStep;
              return (
                <div
                  key={step.id}
                  className={`flex flex-col items-center ${
                    isActive
                      ? "text-primary"
                      : isCompleted
                      ? "text-status-success"
                      : "text-muted-foreground"
                  }`}
                >
                  <Icon className="w-4 h-4 mb-1" />
                  <span className="text-xs hidden sm:block">{step.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{STEPS[currentStep].label}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Step 0: Client Details */}
            {currentStep === 0 && (
              <>
                <div>
                  <Label htmlFor="clientName">Client Name *</Label>
                  <Input
                    id="clientName"
                    value={formData.clientName}
                    onChange={(e) => updateForm({ clientName: e.target.value })}
                    placeholder="John Smith"
                    className={errors.clientName ? "border-destructive" : ""}
                  />
                  {errors.clientName && (
                    <p className="text-sm text-destructive mt-1">{errors.clientName}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="clientEmail">Client Email *</Label>
                  <Input
                    id="clientEmail"
                    type="email"
                    value={formData.clientEmail}
                    onChange={(e) => updateForm({ clientEmail: e.target.value })}
                    placeholder="john@example.com"
                    className={errors.clientEmail ? "border-destructive" : ""}
                  />
                  {errors.clientEmail && (
                    <p className="text-sm text-destructive mt-1">{errors.clientEmail}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="clientPhone">Phone (Optional)</Label>
                  <Input
                    id="clientPhone"
                    type="tel"
                    value={formData.clientPhone}
                    onChange={(e) => updateForm({ clientPhone: e.target.value })}
                    placeholder="(555) 123-4567"
                  />
                </div>
              </>
            )}

            {/* Step 1: Meeting Type */}
            {currentStep === 1 && (
              <>
                <div>
                  <Label>Meeting Type</Label>
                  <Select
                    value={formData.meetingTypeId}
                    onValueChange={(v) => updateForm({ meetingTypeId: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a meeting type (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      {meetingTypes?.map((mt) => (
                        <SelectItem key={mt.id} value={mt.id}>
                          {mt.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="duration">Duration (minutes) *</Label>
                  <Select
                    value={formData.duration.toString()}
                    onValueChange={(v) => updateForm({ duration: parseInt(v) })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">15 minutes</SelectItem>
                      <SelectItem value="30">30 minutes</SelectItem>
                      <SelectItem value="45">45 minutes</SelectItem>
                      <SelectItem value="60">60 minutes</SelectItem>
                      <SelectItem value="90">90 minutes</SelectItem>
                      <SelectItem value="120">2 hours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Location</Label>
                  <RadioGroup
                    value={formData.locationMode}
                    onValueChange={(v) => updateForm({ locationMode: v as "Zoom" | "InPerson" })}
                    className="flex gap-4 mt-2"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="Zoom" id="zoom" />
                      <Label htmlFor="zoom" className="font-normal cursor-pointer">
                        Video Call (Zoom)
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="InPerson" id="inperson" />
                      <Label htmlFor="inperson" className="font-normal cursor-pointer">
                        In-Person
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
              </>
            )}

            {/* Step 2: Participants */}
            {currentStep === 2 && (
              <>
                <div>
                  <Label>Host Attorney</Label>
                  <Select
                    value={formData.hostAttorneyId}
                    onValueChange={(v) => updateForm({ hostAttorneyId: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select host attorney (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      {attorneys?.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-sm text-muted-foreground mt-1">
                    The primary attorney for this meeting
                  </p>
                </div>
                <div>
                  <Label>Support Staff</Label>
                  <div className="space-y-2 mt-2">
                    {supportStaff?.map((s) => (
                      <div key={s.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={s.id}
                          checked={formData.supportStaffIds.includes(s.id)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              updateForm({
                                supportStaffIds: [...formData.supportStaffIds, s.id],
                              });
                            } else {
                              updateForm({
                                supportStaffIds: formData.supportStaffIds.filter((id) => id !== s.id),
                              });
                            }
                          }}
                        />
                        <Label htmlFor={s.id} className="font-normal cursor-pointer">
                          {s.name}
                        </Label>
                      </div>
                    ))}
                    {(!supportStaff || supportStaff.length === 0) && (
                      <p className="text-sm text-muted-foreground">No support staff configured</p>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Step 3: Room */}
            {currentStep === 3 && (
              <>
                {formData.locationMode === "Zoom" ? (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">
                      Room selection is not needed for video calls.
                    </p>
                    <p className="text-sm text-muted-foreground mt-2">
                      A Zoom link will be generated automatically.
                    </p>
                  </div>
                ) : (
                  <div>
                    <Label>Conference Room</Label>
                    <Select
                      value={formData.roomId}
                      onValueChange={(v) => updateForm({ roomId: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a room (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        {rooms?.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground mt-1">
                      Select a room to check its availability when suggesting times
                    </p>
                    {(!rooms || rooms.length === 0) && (
                      <p className="text-sm text-status-warning mt-2">
                        No rooms configured. Add rooms in Admin Settings.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Step 4: Scheduling */}
            {currentStep === 4 && (
              <>
                <div>
                  <Label htmlFor="searchWindow">Search Window (days)</Label>
                  <Select
                    value={formData.searchWindowDays.toString()}
                    onValueChange={(v) => updateForm({ searchWindowDays: parseInt(v) })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7">7 days</SelectItem>
                      <SelectItem value="14">14 days</SelectItem>
                      <SelectItem value="30">30 days</SelectItem>
                      <SelectItem value="60">60 days</SelectItem>
                      <SelectItem value="90">90 days</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-sm text-muted-foreground mt-1">
                    How far into the future to look for available times
                  </p>
                </div>
                <div>
                  <Label>Time of Day Preference</Label>
                  <Select
                    value={formData.timePreference}
                    onValueChange={(v) => updateForm({ timePreference: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="None">No preference</SelectItem>
                      <SelectItem value="Morning">Morning (9am - 12pm)</SelectItem>
                      <SelectItem value="Midday">Midday (11am - 2pm)</SelectItem>
                      <SelectItem value="Afternoon">Afternoon (12pm - 5pm)</SelectItem>
                      <SelectItem value="Evening">Evening (4pm - 7pm)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Minimum Notice</Label>
                  <Select
                    value={formData.minNoticeHours.toString()}
                    onValueChange={(v) => updateForm({ minNoticeHours: parseInt(v) })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="2">2 hours</SelectItem>
                      <SelectItem value="4">4 hours</SelectItem>
                      <SelectItem value="24">1 day</SelectItem>
                      <SelectItem value="48">2 days</SelectItem>
                      <SelectItem value="72">3 days</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-sm text-muted-foreground mt-1">
                    Minimum time before a slot becomes available
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="allowWeekends"
                    checked={formData.allowWeekends}
                    onCheckedChange={(checked) => updateForm({ allowWeekends: !!checked })}
                  />
                  <Label htmlFor="allowWeekends" className="font-normal cursor-pointer">
                    Include weekends in available times
                  </Label>
                </div>
              </>
            )}

            {/* Step 5: Review */}
            {currentStep === 5 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Client</p>
                    <p className="font-medium">{formData.clientName}</p>
                    <p className="text-sm text-muted-foreground">{formData.clientEmail}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Meeting Type</p>
                    <p className="font-medium">
                      {selectedMeetingType?.name || "General Meeting"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Duration</p>
                    <p className="font-medium">{formData.duration} minutes</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Location</p>
                    <p className="font-medium">
                      {formData.locationMode === "Zoom" ? "Video Call" : "In-Person"}
                    </p>
                  </div>
                  {formData.hostAttorneyId && (
                    <div>
                      <p className="text-sm text-muted-foreground">Host Attorney</p>
                      <p className="font-medium">
                        {attorneys?.find((a) => a.id === formData.hostAttorneyId)?.name}
                      </p>
                    </div>
                  )}
                  {formData.roomId && formData.locationMode === "InPerson" && (
                    <div>
                      <p className="text-sm text-muted-foreground">Room</p>
                      <p className="font-medium">
                        {rooms?.find((r) => r.id === formData.roomId)?.name}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-muted-foreground">Search Window</p>
                    <p className="font-medium">{formData.searchWindowDays} days</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Link Expires</p>
                    <p className="font-medium">
                      {format(addDays(new Date(), 7), "MMM d, yyyy")}
                    </p>
                  </div>
                </div>
                <div className="bg-muted rounded-lg p-4 text-sm">
                  <p className="font-medium text-foreground mb-1">What happens next?</p>
                  <p className="text-muted-foreground">
                    After you create this request, you'll get a link to send to {formData.clientName}. 
                    They'll be able to pick from available times that work for everyone's calendar.
                  </p>
                </div>
              </div>
            )}
          </CardContent>

          {/* Navigation */}
          <div className="flex justify-between p-6 pt-0">
            <Button variant="outline" onClick={handleBack}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              {currentStep === 0 ? "Cancel" : "Back"}
            </Button>
            <Button onClick={handleNext} disabled={createMutation.isPending}>
              {currentStep === STEPS.length - 1 ? (
                createMutation.isPending ? (
                  "Creating..."
                ) : (
                  <>
                    Create Request
                    <CheckCircle className="w-4 h-4 ml-2" />
                  </>
                )
              ) : (
                <>
                  Next
                  <ArrowRight className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
          </div>
        </Card>
      </div>
    </MainLayout>
  );
}
