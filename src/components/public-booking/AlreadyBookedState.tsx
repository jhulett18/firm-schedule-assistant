import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, Calendar, Clock, MapPin, Video, ChevronDown, Phone, Mail } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface AlreadyBookedStateProps {
  meetingTypeName: string;
  startDatetime: Date;
  durationMinutes: number;
  locationMode: "Zoom" | "InPerson";
  locationDisplay: string;
  contactEmail?: string;
  contactPhone?: string;
}

export function AlreadyBookedState({
  meetingTypeName,
  startDatetime,
  durationMinutes,
  locationMode,
  locationDisplay,
  contactEmail,
  contactPhone
}: AlreadyBookedStateProps) {
  const [showDetails, setShowDetails] = useState(true);

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

        <Card>
          <CardContent className="pt-6">
            <p className="font-medium text-foreground mb-2">Need to change this?</p>
            <p className="text-sm text-muted-foreground mb-4">
              If you need to reschedule or cancel your appointment, please contact our office:
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
