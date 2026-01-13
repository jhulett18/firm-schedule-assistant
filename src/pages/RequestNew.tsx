import { useState, useEffect, useCallback } from "react";
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
import { Badge } from "@/components/ui/badge";
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
  AlertCircle,
  Calendar,
  Search,
  RefreshCw,
  Loader2,
  Briefcase,
} from "lucide-react";
import { copyToClipboard, getBookingUrl, generateClientEmailTemplate } from "@/lib/clipboard";

// Updated steps - removed Calendar tab, participants now includes company member selection
const STEPS = [
  { id: "client", label: "Client Details", icon: User },
  { id: "meeting", label: "Meeting Type", icon: FileText },
  { id: "participants", label: "Participants", icon: Users },
  { id: "room", label: "Room", icon: DoorOpen },
  { id: "schedule", label: "Scheduling", icon: Clock },
  { id: "review", label: "Review", icon: CheckCircle },
];

interface CompanyMember {
  id: string;
  name: string;
  email: string;
  role: string;
  hasGoogleConnection: boolean;
}

interface LawmaticsMatter {
  id: string;
  title: string;
  status: string | null;
  practice_area: string | null;
  updated_at: string | null;
}

interface FormData {
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  meetingTypeId: string;
  duration: number;
  locationMode: "Zoom" | "InPerson";
  hostUserId: string; // Host/Organizer (single select)
  participantUserIds: string[]; // Additional participants (multi-select)
  roomId: string;
  searchWindowDays: number;
  allowWeekends: boolean;
  timePreference: string;
  minNoticeHours: number;
  // Matter attachment fields
  lawmaticsMatterMode: "new" | "existing";
  lawmaticsExistingMatterId: string;
}

const initialFormData: FormData = {
  clientName: "",
  clientEmail: "",
  clientPhone: "",
  meetingTypeId: "",
  duration: 60,
  locationMode: "Zoom",
  hostUserId: "",
  participantUserIds: [],
  roomId: "",
  searchWindowDays: 30,
  allowWeekends: false,
  timePreference: "None",
  minNoticeHours: 24,
  lawmaticsMatterMode: "new",
  lawmaticsExistingMatterId: "",
};

export default function RequestNew() {
  const navigate = useNavigate();
  const { internalUser } = useAuth();
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  // Matter lookup state
  const [existingMatters, setExistingMatters] = useState<LawmaticsMatter[]>([]);
  const [matterLookupLoading, setMatterLookupLoading] = useState(false);
  const [matterLookupError, setMatterLookupError] = useState<string | null>(null);
  const [matterLookupDone, setMatterLookupDone] = useState(false);
  const [lastLookedUpEmail, setLastLookedUpEmail] = useState<string>("");

  // Debounced matter lookup
  const lookupMatters = useCallback(async (email: string) => {
    if (!email || !email.includes("@")) {
      setExistingMatters([]);
      setMatterLookupDone(false);
      return;
    }

    setMatterLookupLoading(true);
    setMatterLookupError(null);

    try {
      const { data, error } = await supabase.functions.invoke("lawmatics-find-matters-by-email", {
        body: { email },
      });

      if (error) throw error;

      if (data?.success) {
        setExistingMatters(data.matters || []);
        setLastLookedUpEmail(email);
      } else {
        setMatterLookupError(data?.error || "Failed to search for matters");
        setExistingMatters([]);
      }
      setMatterLookupDone(true);
    } catch (err) {
      console.error("Matter lookup failed:", err);
      setMatterLookupError(err instanceof Error ? err.message : "Failed to search for matters");
      setExistingMatters([]);
      setMatterLookupDone(true);
    } finally {
      setMatterLookupLoading(false);
    }
  }, []);

  // Auto-lookup when email changes (debounced)
  useEffect(() => {
    const email = formData.clientEmail.trim();
    if (!email || !email.includes("@") || email === lastLookedUpEmail) return;

    const timeoutId = setTimeout(() => {
      lookupMatters(email);
    }, 800);

    return () => clearTimeout(timeoutId);
  }, [formData.clientEmail, lastLookedUpEmail, lookupMatters]);

  // Reset matter selection when mode changes to 'new'
  useEffect(() => {
    if (formData.lawmaticsMatterMode === "new") {
      setFormData(prev => ({ ...prev, lawmaticsExistingMatterId: "" }));
    }
  }, [formData.lawmaticsMatterMode]);

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

  // Fetch company members (users in the same company as current user)
  // RLS will automatically filter to same company due to get_current_user_company_id()
  const { data: companyMembers, isLoading: membersLoading } = useQuery({
    queryKey: ["company-members"],
    queryFn: async () => {
      // Fetch all active users (RLS filters by company)
      const { data: users, error: usersError } = await supabase
        .from("users")
        .select("id, name, email, role")
        .eq("active", true);
      
      if (usersError) throw usersError;

      // Fetch calendar connections to determine who has Google connected
      const { data: connections } = await supabase
        .from("calendar_connections")
        .select("user_id")
        .eq("provider", "google");

      const connectedUserIds = new Set((connections || []).map(c => c.user_id));

      const members: CompanyMember[] = (users || []).map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        hasGoogleConnection: connectedUserIds.has(u.id),
      }));

      return members;
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
      // All selected participants = host + additional participants
      const allParticipantIds = [
        formData.hostUserId,
        ...formData.participantUserIds,
      ].filter(Boolean);

      // Create meeting with participant_user_ids for availability calculation
      const { data: meeting, error: meetingError } = await supabase
        .from("meetings")
        .insert({
          meeting_type_id: formData.meetingTypeId || null,
          duration_minutes: formData.duration,
          location_mode: formData.locationMode,
          host_attorney_user_id: formData.hostUserId || null,
          support_user_ids: [], // Legacy field, not used for participants anymore
          participant_user_ids: allParticipantIds, // New: all selected participants
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
          created_by_user_id: internalUser?.id || null,
          // google_calendar_id will be determined from host's selected calendar at confirm time
        })
        .select("id")
        .single();

      if (meetingError) {
        console.error("[CreateRequest] meetings insert error:", meetingError);
        throw meetingError;
      }

      // Create booking request with matter attachment choice
      const expiresAt = addDays(new Date(), 7);
      const { data: bookingRequest, error: brError } = await supabase
        .from("booking_requests")
        .insert({
          meeting_id: meeting.id,
          expires_at: expiresAt.toISOString(),
          status: "Open",
          lawmatics_matter_mode: formData.lawmaticsMatterMode,
          lawmatics_existing_matter_id: formData.lawmaticsMatterMode === "existing" && formData.lawmaticsExistingMatterId
            ? formData.lawmaticsExistingMatterId
            : null,
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
      toast.error(`Failed to create request: ${error.message}`, {
        description: error.details || error.hint || undefined,
        duration: 8000,
      });
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
        // Validate matter selection if "existing" mode is chosen
        if (formData.lawmaticsMatterMode === "existing" && !formData.lawmaticsExistingMatterId) {
          newErrors.lawmaticsExistingMatterId = "Please select an existing matter";
        }
        break;
      case 1: // Meeting type
        if (!formData.meetingTypeId) {
          newErrors.meetingTypeId = "Meeting type is required";
        }
        if (!formData.duration || formData.duration < 15) {
          newErrors.duration = "Duration must be at least 15 minutes";
        }
        break;
      case 2: // Participants
        if (!formData.hostUserId) {
          newErrors.hostUserId = "Host/Organizer is required";
        }
        break;
      case 3: // Room
        if (formData.locationMode === "InPerson" && !formData.roomId) {
          newErrors.roomId = "Room is required for in-person meetings";
        }
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

  // Get host and participant display info
  const hostMember = companyMembers?.find((m) => m.id === formData.hostUserId);
  const selectedParticipants = companyMembers?.filter((m) => 
    formData.participantUserIds.includes(m.id)
  ) || [];

  // Check if any selected participant has no Google connection
  const participantsWithoutGoogle = [
    ...(hostMember && !hostMember.hasGoogleConnection ? [hostMember] : []),
    ...selectedParticipants.filter((p) => !p.hasGoogleConnection),
  ];

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

                {/* Matter Attachment Section */}
                <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Briefcase className="w-4 h-4 text-muted-foreground" />
                      <Label className="font-medium">Lawmatics Matter Attachment</Label>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => lookupMatters(formData.clientEmail)}
                      disabled={matterLookupLoading || !formData.clientEmail.includes("@")}
                    >
                      {matterLookupLoading ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Search className="w-4 h-4 mr-2" />
                      )}
                      Check for existing matter
                    </Button>
                  </div>

                  <p className="text-sm text-muted-foreground">
                    Choose whether to create a new matter or attach this booking to an existing one.
                  </p>

                  {matterLookupLoading && (
                    <div className="flex items-center gap-2 py-2 text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">Searching Lawmatics for existing matters...</span>
                    </div>
                  )}

                  {matterLookupError && (
                    <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30">
                      <AlertCircle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-destructive">{matterLookupError}</p>
                    </div>
                  )}

                  {matterLookupDone && !matterLookupLoading && (
                    <>
                      {existingMatters.length === 0 ? (
                        <div className="flex items-center gap-2 p-3 rounded-md bg-muted border">
                          <CheckCircle className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">
                            No existing matters found for {lastLookedUpEmail}. A new matter will be created.
                          </span>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">{existingMatters.length} matter(s) found</Badge>
                          </div>

                          <RadioGroup
                            value={formData.lawmaticsMatterMode}
                            onValueChange={(v) => updateForm({ lawmaticsMatterMode: v as "new" | "existing" })}
                            className="space-y-2"
                          >
                            <div className="flex items-center space-x-2 p-3 rounded-md border bg-background">
                              <RadioGroupItem value="new" id="matter-new" />
                              <Label htmlFor="matter-new" className="font-normal cursor-pointer flex-1">
                                <span className="font-medium">Create new matter</span>
                                <p className="text-sm text-muted-foreground mt-0.5">
                                  A new matter will be created in Lawmatics for this booking.
                                </p>
                              </Label>
                            </div>
                            <div className="flex items-center space-x-2 p-3 rounded-md border bg-background">
                              <RadioGroupItem value="existing" id="matter-existing" />
                              <Label htmlFor="matter-existing" className="font-normal cursor-pointer flex-1">
                                <span className="font-medium">Attach to existing matter</span>
                                <p className="text-sm text-muted-foreground mt-0.5">
                                  Select an existing matter to attach this booking to.
                                </p>
                              </Label>
                            </div>
                          </RadioGroup>

                          {formData.lawmaticsMatterMode === "existing" && (
                            <div className="ml-6">
                              <Label className="text-sm">Select Matter *</Label>
                              <Select
                                value={formData.lawmaticsExistingMatterId}
                                onValueChange={(v) => updateForm({ lawmaticsExistingMatterId: v })}
                              >
                                <SelectTrigger className={errors.lawmaticsExistingMatterId ? "border-destructive" : ""}>
                                  <SelectValue placeholder="Choose a matter..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {existingMatters.map((matter) => (
                                    <SelectItem key={matter.id} value={matter.id}>
                                      <div className="flex flex-col">
                                        <span>{matter.title}</span>
                                        <span className="text-xs text-muted-foreground">
                                          ID: {matter.id}
                                          {matter.status && ` • ${matter.status}`}
                                          {matter.practice_area && ` • ${matter.practice_area}`}
                                        </span>
                                      </div>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {errors.lawmaticsExistingMatterId && (
                                <p className="text-sm text-destructive mt-1">{errors.lawmaticsExistingMatterId}</p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {!matterLookupDone && !matterLookupLoading && formData.clientEmail.includes("@") && (
                    <p className="text-sm text-muted-foreground italic">
                      Enter a client email and click "Check for existing matter" to search.
                    </p>
                  )}
                </div>
              </>
            )}

            {/* Step 1: Meeting Type */}
            {currentStep === 1 && (
              <>
                <div>
                  <Label>Meeting Type *</Label>
                  <Select
                    value={formData.meetingTypeId}
                    onValueChange={(v) => updateForm({ meetingTypeId: v })}
                  >
                    <SelectTrigger className={errors.meetingTypeId ? "border-destructive" : ""}>
                      <SelectValue placeholder="Select a meeting type" />
                    </SelectTrigger>
                    <SelectContent>
                      {meetingTypes?.map((mt) => (
                        <SelectItem key={mt.id} value={mt.id}>
                          {mt.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.meetingTypeId && (
                    <p className="text-sm text-destructive mt-1">{errors.meetingTypeId}</p>
                  )}
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

            {/* Step 2: Participants - Company Members Multi-Select */}
            {currentStep === 2 && (
              <>
                <div>
                  <Label>Host / Organizer *</Label>
                  <p className="text-sm text-muted-foreground mb-2">
                    The primary organizer for this meeting. Their calendar will be used for event creation.
                  </p>
                  {membersLoading ? (
                    <div className="flex items-center gap-2 py-3 text-muted-foreground">
                      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      Loading team members...
                    </div>
                  ) : (
                    <Select
                      value={formData.hostUserId}
                      onValueChange={(v) => {
                        // Remove from participants if selecting as host
                        updateForm({ 
                          hostUserId: v,
                          participantUserIds: formData.participantUserIds.filter(id => id !== v),
                        });
                      }}
                    >
                      <SelectTrigger className={errors.hostUserId ? "border-destructive" : ""}>
                        <SelectValue placeholder="Select host/organizer" />
                      </SelectTrigger>
                      <SelectContent>
                        {companyMembers?.map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            <div className="flex items-center gap-2">
                              <span>{member.name}</span>
                              <span className="text-muted-foreground text-xs">({member.email})</span>
                              {!member.hasGoogleConnection && (
                                <Badge variant="outline" className="text-xs bg-status-warning/10 text-status-warning border-status-warning/30">
                                  No Calendar
                                </Badge>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {errors.hostUserId && (
                    <p className="text-sm text-destructive mt-1">{errors.hostUserId}</p>
                  )}
                </div>

                <div>
                  <Label>Additional Participants</Label>
                  <p className="text-sm text-muted-foreground mb-2">
                    Select team members whose calendars should be checked for availability.
                  </p>
                  <div className="space-y-2 max-h-60 overflow-y-auto border rounded-md p-3">
                    {membersLoading ? (
                      <div className="flex items-center gap-2 py-3 text-muted-foreground">
                        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        Loading...
                      </div>
                    ) : companyMembers?.filter(m => m.id !== formData.hostUserId).length === 0 ? (
                      <p className="text-sm text-muted-foreground py-2">
                        No other team members available
                      </p>
                    ) : (
                      companyMembers
                        ?.filter(m => m.id !== formData.hostUserId)
                        .map((member) => (
                          <div key={member.id} className="flex items-center space-x-2">
                            <Checkbox
                              id={`participant-${member.id}`}
                              checked={formData.participantUserIds.includes(member.id)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  updateForm({
                                    participantUserIds: [...formData.participantUserIds, member.id],
                                  });
                                } else {
                                  updateForm({
                                    participantUserIds: formData.participantUserIds.filter((id) => id !== member.id),
                                  });
                                }
                              }}
                            />
                            <Label htmlFor={`participant-${member.id}`} className="font-normal cursor-pointer flex items-center gap-2 flex-1">
                              <span>{member.name}</span>
                              <span className="text-muted-foreground text-xs">({member.email})</span>
                              {!member.hasGoogleConnection && (
                                <Badge variant="outline" className="text-xs bg-status-warning/10 text-status-warning border-status-warning/30">
                                  No Calendar
                                </Badge>
                              )}
                            </Label>
                          </div>
                        ))
                    )}
                  </div>
                </div>

                {/* Warning for participants without Google connection */}
                {participantsWithoutGoogle.length > 0 && (
                  <div className="flex items-start gap-2 p-3 rounded-md bg-status-warning/10 border border-status-warning/30">
                    <AlertCircle className="w-4 h-4 text-status-warning mt-0.5 flex-shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium text-status-warning">Calendar availability may be incomplete</p>
                      <p className="text-muted-foreground mt-1">
                        The following participants don't have Google Calendar connected: {participantsWithoutGoogle.map(p => p.name).join(", ")}. 
                        Their availability won't be checked automatically.
                      </p>
                    </div>
                  </div>
                )}
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
                    <Label>Conference Room *</Label>
                    <Select
                      value={formData.roomId}
                      onValueChange={(v) => updateForm({ roomId: v })}
                    >
                      <SelectTrigger className={errors.roomId ? "border-destructive" : ""}>
                        <SelectValue placeholder="Select a room" />
                      </SelectTrigger>
                      <SelectContent>
                        {rooms?.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errors.roomId && (
                      <p className="text-sm text-destructive mt-1">{errors.roomId}</p>
                    )}
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
                  <div>
                    <p className="text-sm text-muted-foreground">Host / Organizer</p>
                    <p className="font-medium">{hostMember?.name}</p>
                    <p className="text-xs text-muted-foreground">{hostMember?.email}</p>
                  </div>
                  {selectedParticipants.length > 0 && (
                    <div>
                      <p className="text-sm text-muted-foreground">Participants</p>
                      <p className="font-medium">{selectedParticipants.map(p => p.name).join(", ")}</p>
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
                
                {participantsWithoutGoogle.length > 0 && (
                  <div className="flex items-start gap-2 p-3 rounded-md bg-status-warning/10 border border-status-warning/30">
                    <AlertCircle className="w-4 h-4 text-status-warning mt-0.5 flex-shrink-0" />
                    <div className="text-sm">
                      <p className="text-muted-foreground">
                        Some participants don't have Google Calendar connected. Their availability won't be checked.
                      </p>
                    </div>
                  </div>
                )}
                
                <div className="bg-muted rounded-lg p-4 text-sm">
                  <p className="font-medium text-foreground mb-1">What happens next?</p>
                  <p className="text-muted-foreground">
                    After you create this request, you'll get a link to send to {formData.clientName}. 
                    They'll be able to pick from available times that work for all selected participants' calendars.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Navigation buttons */}
        <div className="flex justify-between mt-6">
          <Button variant="outline" onClick={handleBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            {currentStep === 0 ? "Cancel" : "Back"}
          </Button>
          <Button
            onClick={handleNext}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? (
              <>
                <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin mr-2" />
                Creating...
              </>
            ) : currentStep === STEPS.length - 1 ? (
              <>
                Create Request
                <CheckCircle className="w-4 h-4 ml-2" />
              </>
            ) : (
              <>
                Next
                <ArrowRight className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        </div>
      </div>
    </MainLayout>
  );
}
