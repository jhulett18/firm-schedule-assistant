import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LinkIcon, Phone, Mail, XCircle } from "lucide-react";

interface ExpiredOrCancelledStateProps {
  reason: "expired" | "cancelled";
  contactEmail?: string;
  contactPhone?: string;
  contactMessage?: string;
}

export function ExpiredOrCancelledState({
  reason,
  contactEmail,
  contactPhone,
  contactMessage
}: ExpiredOrCancelledStateProps) {
  const title = reason === "expired" 
    ? "This scheduling link has expired" 
    : "This scheduling link is no longer active";

  const description = reason === "expired"
    ? "The time window for using this link has passed."
    : "This booking request has been cancelled.";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-6">
        <Card className="border-muted">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
                {reason === "expired" ? (
                  <LinkIcon className="h-8 w-8 text-muted-foreground" />
                ) : (
                  <XCircle className="h-8 w-8 text-muted-foreground" />
                )}
              </div>
              <div>
                <h2 className="text-xl font-semibold text-foreground mb-2">{title}</h2>
                <p className="text-muted-foreground">{description}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <p className="font-medium text-foreground mb-2">
              {reason === "cancelled" ? "Need to reschedule?" : "What to do next"}
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              {reason === "cancelled"
                ? "We'd be happy to help you find a new time. Please contact our office to request a new appointment."
                : (contactMessage || "Please contact our office to request a new scheduling link.")
              }
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

        <div className="text-center">
          <Button 
            variant="ghost" 
            onClick={() => window.close()}
            className="text-muted-foreground"
          >
            Close this page
          </Button>
        </div>
      </div>
    </div>
  );
}
