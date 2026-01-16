/** Book Client Now Dialog - Staff booking workflow component */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ArrowLeft,
  ArrowRight,
  User,
  FileText,
  Users,
  DoorOpen,
  Clock,
  CheckCircle,
  Calendar,
  Search,
  RefreshCw,
  Loader2,
  Briefcase,
  AlertCircle,
  AlertTriangle,
  MapPin,
  Video,
  XCircle,
  Copy,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { copyToClipboard, getBookingUrl } from "@/lib/clipboard";
import { format, addDays } from "date-fns";
import { toast } from "sonner";

// Steps for the wizard
const STEPS = [
  { id: "client", label: "Client Details", icon: User },
  { id: "meeting", label: "Meeting Type", icon: FileText },
  { id: "participants", label: "Participants", icon: Users },
  { id: "room", label: "Room", icon: DoorOpen },
  { id: "schedule", label: "Scheduling", icon: Clock },
  { id: "slots", label: "Select Time", icon: Calendar },
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
  hostUserId: string;
  participantUserIds: string[];
  roomId: string;
  searchWindowDays: number;
  allowWeekends: boolean;
  timePreference: string;
  minNoticeHours: number;
  bookingRequestExpiresDays: number;
  lawmaticsMatterMode: "new" | "existing";
  lawmaticsExistingMatterId: string;
}

interface TimeSlot {
  start: string;
  end: string;
  label: string;
}

interface BookClientNowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
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
  bookingRequestExpiresDays: 7,
  lawmaticsMatterMode: "new",
  lawmaticsExistingMatterId: "",
};

export function BookClientNowDialog({
  open,
  onOpenChange,
  onSuccess,
}: BookClientNowDialogProps) {
  const { internalUser } = useAuth();
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [createdMeetingId, setCreatedMeetingId] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  // Slot selection state
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isCancelSuccess, setIsCancelSuccess] = useState(false);
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [clientTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York"
  );

  // Matter lookup state
  const [existingMatters, setExistingMatters] = useState<LawmaticsMatter[]>([]);
  const [matterLookupLoading, setMatterLookupLoading] = useState(false);
  const [matterLookupError, setMatterLookupError] = useState<string | null>(null);
  const [matterLookupDone, setMatterLookupDone] = useState(false);
  const [lastLookedUpEmail, setLastLookedUpEmail] = useState<string>("");

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setCurrentStep(0);
      setFormData(initialFormData);
      setErrors({});
      setCreatedMeetingId(null);
      setCreatedToken(null);
      setSlots([]);
      setSelectedSlot(null);
      setSlotError(null);
      setWarnings([]);
      setIsSuccess(false);
      setIsCancelSuccess(false);
      setExistingMatters([]);
      setMatterLookupDone(false);
      setLastLookedUpEmail("");
    }
  }, [open]);

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

  // Auto-lookup when email changes
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
    enabled: open,
  });

  // Fetch company members
  const { data: companyMembers, isLoading: membersLoading } = useQuery({
    queryKey: ["company-members"],
    queryFn: async () => {
      const { data: users, error: usersError } = await supabase
        .from("users")
        .select("id, name, email, role")
        .eq("active", true);

      if (usersError) throw usersError;

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
    enabled: open,
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
    enabled: open,
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

  const createMeetingAndBookingRequest = async () => {
    try {
      // All selected participants = host + additional participants
      const allParticipantIds = [
        formData.hostUserId,
        ...formData.participantUserIds,
      ].filter(Boolean);

      // Create meeting
      const { data: meeting, error: meetingError } = await supabase
        .from("meetings")
        .insert({
          meeting_type_id: formData.meetingTypeId || null,
          duration_minutes: formData.duration,
          location_mode: formData.locationMode,
          host_attorney_user_id: formData.hostUserId || null,
          support_user_ids: [],
          participant_user_ids: allParticipantIds,
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
            bookingRequestExpiresDays: formData.bookingRequestExpiresDays,
            allowWeekends: formData.allowWeekends,
          },
          search_window_days_used: formData.searchWindowDays,
          status: "Proposed",
          created_by_user_id: internalUser?.id || null,
        })
        .select("id")
        .single();

      if (meetingError) throw meetingError;

      // Create booking request with custom expiration days
      const expiresAt = addDays(new Date(), formData.bookingRequestExpiresDays);
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

      if (brError) throw brError;

      setCreatedMeetingId(meeting.id);
      setCreatedToken(bookingRequest.public_token);

      return { meetingId: meeting.id, token: bookingRequest.public_token };
    } catch (error) {
      console.error("Error creating meeting:", error);
      throw error;
    }
  };

  const fetchSlots = async (token: string) => {
    setIsLoadingSlots(true);
    setSlotError(null);

    try {
      const { data, error: invokeError } = await supabase.functions.invoke(
        "public-available-slots",
        {
          body: { token, clientTimezone },
        }
      );

      if (invokeError) {
        throw new Error(invokeError.message || "Failed to load available slots");
      }

      const fetchedSlots = Array.isArray(data?.slots) ? data.slots : [];
      setSlots(fetchedSlots);

      if (fetchedSlots.length === 0) {
        setSlotError("No available times found. The calendars may be fully booked.");
      }
    } catch (err: any) {
      console.error("Error fetching slots:", err);
      setSlotError(err.message || "Failed to load available slots");
    } finally {
      setIsLoadingSlots(false);
    }
  };

  const handleConfirm = async () => {
    if (!selectedSlot || !createdToken) return;

    setIsConfirming(true);
    setSlotError(null);
    setWarnings([]);

    try {
      const { data, error } = await supabase.functions.invoke("confirm-booking", {
        body: {
          token: createdToken,
          startDatetime: selectedSlot.start,
          endDatetime: selectedSlot.end,
        },
      });

      if (error) {
        throw new Error(error.message || "Failed to confirm booking");
      }

      if (data?.success === true) {
        if (Array.isArray(data.warnings) && data.warnings.length > 0) {
          setWarnings(data.warnings);
        }

        setIsSuccess(true);
        toast.success("Meeting booked successfully!");
        queryClient.invalidateQueries({ queryKey: ["booking-requests"] });
        queryClient.invalidateQueries({ queryKey: ["recent-meetings"] });
        onSuccess?.();
      } else if (data?.error) {
        throw new Error(data.error);
      } else {
        throw new Error("Unexpected response from server");
      }
    } catch (err: any) {
      console.error("Error confirming booking:", err);
      setSlotError(err.message || "Failed to confirm booking");
    } finally {
      setIsConfirming(false);
    }
  };

  const handleNext = async () => {
    if (!validateStep(currentStep)) return;

    // If moving from Scheduling step (4) to Slots step (5), create the meeting and fetch slots
    if (currentStep === 4) {
      try {
        toast.loading("Creating meeting...");
        const { token } = await createMeetingAndBookingRequest();
        toast.dismiss();
        // Transition to loading state without toast - UI shows "Loading availability times..."
        setCurrentStep(5);
        await fetchSlots(token);
      } catch (error: any) {
        toast.dismiss();
        toast.error(`Failed to create meeting: ${error.message}`);
      }
    } else if (currentStep === 5) {
      // Moving from Slots to Review - must have a selected slot
      if (!selectedSlot) {
        toast.error("Please select a time slot");
        return;
      }
      setCurrentStep(6);
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      // Don't allow going back from success state
      if (isSuccess) return;
      // Don't allow going back from slots step (would need to recreate meeting)
      if (currentStep === 5) {
        toast.error("Cannot go back after creating meeting. Please close and start over if needed.");
        return;
      }
      // Allow going back from review to slots to pick a different time
      if (currentStep === 6) {
        setCurrentStep(5);
        return;
      }
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  const handleCopyLink = () => {
    if (createdToken) {
      const url = getBookingUrl(createdToken);
      copyToClipboard(url, "Booking link copied!");
    }
  };

  const handleReschedule = async () => {
    if (!createdToken) return;
    
    setIsRescheduling(true);
    setWarnings([]);

    try {
      const { data, error } = await supabase.functions.invoke("manage-booking", {
        body: { token: createdToken, action: "reschedule" },
      });

      if (error) {
        throw new Error(error.message || "Failed to initiate reschedule");
      }

      if (data?.success) {
        if (Array.isArray(data.warnings) && data.warnings.length > 0) {
          setWarnings(data.warnings);
        }
        // Go back to slot selection - no toast, UI shows "Loading availability times..."
        setIsSuccess(false);
        setSelectedSlot(null);
        setCurrentStep(5);
        await fetchSlots(createdToken);
        queryClient.invalidateQueries({ queryKey: ["booking-requests"] });
      } else if (data?.error) {
        throw new Error(data.error);
      }
    } catch (err: any) {
      console.error("Reschedule error:", err);
      toast.error(err.message || "Unable to reschedule");
    } finally {
      setIsRescheduling(false);
    }
  };

  const handleCancel = async () => {
    if (!createdToken) return;
    
    setIsCancelling(true);
    setWarnings([]);

    try {
      const { data, error } = await supabase.functions.invoke("manage-booking", {
        body: { token: createdToken, action: "cancel" },
      });

      if (error) {
        throw new Error(error.message || "Failed to cancel booking");
      }

      if (data?.success) {
        if (Array.isArray(data.warnings) && data.warnings.length > 0) {
          setWarnings(data.warnings);
          // Show warning toast if there are calendar warnings
          toast.success("Appointment cancelled", {
            description: "Some calendar updates may require attention. Check warnings below.",
          });
        } else {
          // Clean cancellation with calendar events deleted
          toast.success("Appointment cancelled", {
            description: "All calendar events have been removed.",
          });
        }
        setIsCancelSuccess(true);
        queryClient.invalidateQueries({ queryKey: ["booking-requests"] });
        queryClient.invalidateQueries({ queryKey: ["recent-meetings"] });
      } else if (data?.error) {
        throw new Error(data.error);
      }
    } catch (err: any) {
      console.error("Cancel error:", err);
      toast.error(err.message || "Unable to cancel");
    } finally {
      setIsCancelling(false);
    }
  };

  const updateForm = (updates: Partial<FormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }));
    setErrors({});
  };

  const selectedMeetingType = meetingTypes?.find((mt) => mt.id === formData.meetingTypeId);
  const progressPercent = ((currentStep + 1) / STEPS.length) * 100;

  const hostMember = companyMembers?.find((m) => m.id === formData.hostUserId);
  const selectedParticipants = companyMembers?.filter((m) =>
    formData.participantUserIds.includes(m.id)
  ) || [];

  const participantsWithoutGoogle = [
    ...(hostMember && !hostMember.hasGoogleConnection ? [hostMember] : []),
    ...selectedParticipants.filter((p) => !p.hasGoogleConnection),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl h-[90vh] max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Book Client Now</DialogTitle>
          <DialogDescription>
            {isSuccess
              ? "Booking confirmed successfully"
              : `Complete the details to book an appointment - Step ${currentStep + 1} of ${STEPS.length}`}
          </DialogDescription>
        </DialogHeader>

        {/* Progress bar - hide on success */}
        {!isSuccess && (
          <div className="space-y-2">
            <Progress value={progressPercent} className="h-2" />
            <div className="flex justify-between">
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
        )}

        {/* Cancel Success State */}
        {isCancelSuccess ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 py-8">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
              <XCircle className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold">Appointment Cancelled</h3>
              <p className="text-muted-foreground text-sm">
                The appointment and calendar events have been removed.
              </p>
            </div>

            {warnings.length > 0 && (
              <Alert className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20 max-w-sm">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertDescription>
                  <p className="font-medium text-amber-800 dark:text-amber-200 mb-1 text-sm">
                    Some updates require attention:
                  </p>
                  <ul className="text-sm text-amber-700 dark:text-amber-300 space-y-1">
                    {warnings.map((w, i) => (
                      <li key={i}>• {w}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <Button onClick={handleClose} className="mt-4">
              Close
            </Button>
          </div>
        ) : isSuccess ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 py-8">
            <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/50 flex items-center justify-center">
              <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold">Meeting Booked!</h3>
              <p className="text-muted-foreground text-sm">
                {selectedSlot && format(new Date(selectedSlot.start), "EEEE, MMMM d 'at' h:mm a")}
              </p>
            </div>

            {warnings.length > 0 && (
              <Alert className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertDescription>
                  <p className="font-medium text-amber-800 dark:text-amber-200 mb-1 text-sm">
                    Booking confirmed with warnings:
                  </p>
                  <ul className="text-sm text-amber-700 dark:text-amber-300 space-y-1">
                    {warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* Manage Appointment Section */}
            <div className="w-full max-w-sm space-y-2 mt-2">
              <p className="text-sm font-medium text-center text-muted-foreground">Manage Appointment</p>
              
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={handleCopyLink}
              >
                <Copy className="h-4 w-4 mr-2" />
                Copy booking link
              </Button>

              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={handleReschedule}
                disabled={isRescheduling || isCancelling}
              >
                {isRescheduling ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Reschedule appointment
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-destructive hover:text-destructive"
                    disabled={isRescheduling || isCancelling}
                  >
                    {isCancelling ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <XCircle className="h-4 w-4 mr-2" />
                    )}
                    Cancel appointment
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancel Appointment?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to cancel this appointment{selectedSlot ? ` scheduled for ${format(new Date(selectedSlot.start), "EEEE, MMMM d 'at' h:mm a")}` : ""}? This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep Appointment</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleCancel}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Yes, Cancel
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>

            <Button onClick={handleClose} className="mt-4">
              Done
            </Button>
          </div>
        ) : (
          <>
            {/* Wizard Steps */}
            <ScrollArea className="flex-1 min-h-0">
              <div className="space-y-4 pr-4">
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

                {/* Step 2: Participants */}
                {currentStep === 2 && (
                  <>
                    <div>
                      <Label>Host / Organizer *</Label>
                      <p className="text-sm text-muted-foreground mb-2">
                        The primary organizer for this meeting. Their calendar will be used for event creation.
                      </p>
                      {membersLoading ? (
                        <div className="flex items-center gap-2 py-3 text-muted-foreground">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Loading team members...
                        </div>
                      ) : (
                        <Select
                          value={formData.hostUserId}
                          onValueChange={(v) => {
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
                            <Loader2 className="w-4 h-4 animate-spin" />
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
                    <div>
                      <Label>Booking Link Expires In</Label>
                      <Select
                        value={formData.bookingRequestExpiresDays.toString()}
                        onValueChange={(v) => updateForm({ bookingRequestExpiresDays: parseInt(v) })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="3">3 days</SelectItem>
                          <SelectItem value="5">5 days</SelectItem>
                          <SelectItem value="7">7 days</SelectItem>
                          <SelectItem value="14">14 days</SelectItem>
                          <SelectItem value="30">30 days</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-sm text-muted-foreground mt-1">
                        How long the client has to complete booking
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

                {/* Step 5: Select Time */}
                {currentStep === 5 && (
                  <>
                    {slotError && (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>{slotError}</AlertDescription>
                      </Alert>
                    )}

                    {isLoadingSlots ? (
                      <div className="space-y-4 py-8">
                        <div className="flex flex-col items-center gap-3 text-center">
                          <Loader2 className="h-8 w-8 animate-spin text-primary" />
                          <p className="font-medium text-foreground">Loading availability times...</p>
                          <p className="text-sm text-muted-foreground">Checking calendars for open slots</p>
                        </div>
                        <div className="space-y-3">
                          <Skeleton className="h-12 w-full" />
                          <Skeleton className="h-12 w-full" />
                          <Skeleton className="h-12 w-full" />
                        </div>
                      </div>
                    ) : slots.length > 0 ? (
                      <>
                        <div className="space-y-2 mb-4 border rounded-lg p-4 bg-muted/30">
                          <div className="flex items-center gap-2 text-sm">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">{selectedMeetingType?.name || "Meeting"}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            <span>{formData.duration} minutes</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            {formData.locationMode === "Zoom" ? (
                              <>
                                <Video className="h-4 w-4 text-muted-foreground" />
                                <span>Video Call</span>
                              </>
                            ) : (
                              <>
                                <MapPin className="h-4 w-4 text-muted-foreground" />
                                <span>In-Person</span>
                              </>
                            )}
                          </div>
                        </div>

                        <p className="text-sm text-muted-foreground mb-2">
                          Available times ({clientTimezone})
                        </p>
                        <div className="space-y-2 max-h-[300px] overflow-y-auto">
                          {slots.map((slot, index) => {
                            const slotDate = new Date(slot.start);
                            const isSelected = selectedSlot?.start === slot.start;

                            return (
                              <Button
                                key={index}
                                variant={isSelected ? "default" : "outline"}
                                className="w-full justify-start h-auto py-3"
                                onClick={() => setSelectedSlot(slot)}
                              >
                                <div className="flex flex-col items-start gap-0.5">
                                  <span className="font-medium">
                                    {format(slotDate, "EEEE, MMMM d")}
                                  </span>
                                  <span className="text-sm opacity-80">
                                    {format(slotDate, "h:mm a")}
                                  </span>
                                </div>
                              </Button>
                            );
                          })}
                        </div>
                      </>
                    ) : !slotError ? (
                      <div className="py-8 text-center text-muted-foreground">
                        <p>No slots loaded yet</p>
                      </div>
                    ) : null}
                  </>
                )}

                {/* Step 6: Review */}
                {currentStep === 6 && (
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
                    </div>

                    {/* Selected Time Slot */}
                    {selectedSlot && (
                      <div className="border rounded-lg p-4 bg-primary/5">
                        <p className="text-sm font-medium mb-2">Selected Time</p>
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-primary" />
                          <span className="font-medium">
                            {format(new Date(selectedSlot.start), "EEEE, MMMM d 'at' h:mm a")}
                          </span>
                        </div>
                      </div>
                    )}

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
                      <p className="font-medium text-foreground mb-1">Ready to confirm?</p>
                      <p className="text-muted-foreground">
                        Review your selections above and click "Confirm Booking" to schedule the appointment.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Navigation buttons */}
            <div className="flex justify-between mt-4 pt-4 border-t">
              {currentStep === 5 ? (
                <Button
                  variant="outline"
                  onClick={() => fetchSlots(createdToken!)}
                  disabled={isLoadingSlots || isConfirming}
                  className="flex-shrink-0"
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${isLoadingSlots ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              ) : (
                <Button variant="outline" onClick={handleBack} disabled={currentStep === 0}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
              )}

              {currentStep === 5 ? (
                <Button
                  onClick={handleNext}
                  disabled={!selectedSlot}
                  className="flex-1 ml-2"
                >
                  Next (Review)
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              ) : currentStep === 6 ? (
                <Button
                  onClick={handleConfirm}
                  disabled={isConfirming}
                  className="flex-1 ml-2"
                >
                  {isConfirming ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Booking...
                    </>
                  ) : (
                    "Confirm Booking"
                  )}
                </Button>
              ) : (
                <Button onClick={handleNext}>
                  {currentStep === 4 ? "Show Available Times" : "Next"}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
