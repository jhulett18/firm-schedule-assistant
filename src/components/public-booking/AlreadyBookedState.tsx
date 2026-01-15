import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, Calendar, Clock, MapPin, Video, ChevronDown, Phone, Mail, Copy, RefreshCw, XCircle, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { copyToClipboard, getBookingUrl } from "@/lib/clipboard";
import { useToast } from "@/hooks/use-toast";
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
import { Alert, AlertDescription } from "@/components/ui/alert";

interface AlreadyBookedStateProps {
  meetingTypeName: string;
  startDatetime: Date;
  durationMinutes: number;
  locationMode: "Zoom" | "InPerson";
  locationDisplay: string;
  contactEmail?: string;
  contactPhone?: string;
  token?: string;
  onReschedule?: () => void;
  onCancelled?: () => void;
}

export function AlreadyBookedState({
  meetingTypeName,
  startDatetime,
  durationMinutes,
  locationMode,
  locationDisplay,
  contactEmail,
  contactPhone,
  token,
  onReschedule,
  onCancelled
}: AlreadyBookedStateProps) {
  const [showDetails, setShowDetails] = useState(true);
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const { toast } = useToast();

  const handleCopyLink = () => {
    if (token) {
      const url = getBookingUrl(token);
      copyToClipboard(url, "Booking link copied!");
    }
  };

  const handleReschedule = async () => {
    if (!token) return;
    
    setIsRescheduling(true);
    setWarnings([]);

    try {
      const { data, error } = await supabase.functions.invoke("manage-booking", {
        body: { token, action: "reschedule" },
      });

      if (error) {
        throw new Error(error.message || "Failed to initiate reschedule");
      }

      if (data?.success) {
        if (Array.isArray(data.warnings) && data.warnings.length > 0) {
          setWarnings(data.warnings);
          toast({
            title: "Reschedule initiated",
            description: "You can now select a new time.",
          });
        }
        onReschedule?.();
      } else if (data?.error) {
        throw new Error(data.error);
      }
    } catch (err: any) {
      console.error("Reschedule error:", err);
      toast({
        title: "Unable to reschedule",
        description: err.message || "Please contact our office for assistance.",
        variant: "destructive",
      });
    } finally {
      setIsRescheduling(false);
    }
  };

  const handleCancel = async () => {
    if (!token) return;
    
    setIsCancelling(true);
    setWarnings([]);

    try {
      const { data, error } = await supabase.functions.invoke("manage-booking", {
        body: { token, action: "cancel" },
      });

      if (error) {
        throw new Error(error.message || "Failed to cancel booking");
      }

      if (data?.success) {
        if (Array.isArray(data.warnings) && data.warnings.length > 0) {
          setWarnings(data.warnings);
        }
        toast({
          title: "Appointment cancelled",
          description: "Your appointment has been cancelled.",
        });
        onCancelled?.();
      } else if (data?.error) {
        throw new Error(data.error);
      }
    } catch (err: any) {
      console.error("Cancel error:", err);
      toast({
        title: "Unable to cancel",
        description: err.message || "Please contact our office for assistance.",
        variant: "destructive",
      });
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        <Card className="border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/50 flex items-center justify-center">
                <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-foreground mb-2">You're All Set!</h2>
                <p className="text-muted-foreground">
                  Your meeting has been scheduled. We look forward to speaking with you.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Collapsible open={showDetails} onOpenChange={setShowDetails}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full">
              <span>View Meeting Details</span>
              <ChevronDown className={`h-4 w-4 ml-2 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4">
            <Card id="meeting-details">
              <CardContent className="pt-6 space-y-4">
                <div className="text-center pb-4 border-b">
                  <h3 className="font-semibold text-lg">{meetingTypeName}</h3>
                </div>
                
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Calendar className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{format(startDatetime, "EEEE, MMMM d, yyyy")}</p>
                      <p className="text-sm text-muted-foreground">
                        {format(startDatetime, "h:mm a")}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <Clock className="h-5 w-5 text-muted-foreground" />
                    <p>{durationMinutes} minutes</p>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    {locationMode === "Zoom" ? (
                      <Video className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <MapPin className="h-5 w-5 text-muted-foreground" />
                    )}
                    <p>{locationDisplay}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>

        {/* Manage Appointment Section */}
        {token && (
          <Card>
            <CardContent className="pt-6">
              <p className="font-medium text-foreground mb-3">Manage Your Appointment</p>
              
              {warnings.length > 0 && (
                <Alert className="mb-4 border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20">
                  <AlertDescription className="text-sm text-amber-800 dark:text-amber-200">
                    {warnings.map((w, i) => (
                      <p key={i}>{w}</p>
                    ))}
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-3">
                {/* Copy Link Button */}
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={handleCopyLink}
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Copy booking link
                </Button>

                {/* Reschedule Button */}
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

                {/* Cancel Button with Confirmation */}
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
                        Are you sure you want to cancel your {meetingTypeName} scheduled for {format(startDatetime, "EEEE, MMMM d 'at' h:mm a")}? This action cannot be undone.
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
            </CardContent>
          </Card>
        )}

        {/* Contact Section - shown when no token or as fallback */}
        <Card>
          <CardContent className="pt-6">
            <p className="font-medium text-foreground mb-2">Need Help?</p>
            <p className="text-sm text-muted-foreground mb-4">
              If you have questions or need assistance, please contact our office:
            </p>
            <div className="space-y-2">
              {contactPhone && (
                <a 
                  href={`tel:${contactPhone}`}
                  className="flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <Phone className="h-4 w-4" />
                  {contactPhone}
                </a>
              )}
              {contactEmail && (
                <a 
                  href={`mailto:${contactEmail}`}
                  className="flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <Mail className="h-4 w-4" />
                  {contactEmail}
                </a>
              )}
              {!contactPhone && !contactEmail && (
                <p className="text-sm text-muted-foreground">
                  Please contact our office for assistance.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
