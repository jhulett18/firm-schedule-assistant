import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  FileText,
  Send,
  Clock,
  CheckCircle,
  AlertTriangle,
  HelpCircle,
  Settings,
  Users,
  Calendar,
  Link2,
} from "lucide-react";

const quickStartSteps = [
  {
    icon: Link2,
    title: "1. Connect Lawmatics",
    description: "Go to Admin Settings and connect your Lawmatics account. This allows the system to create calendar events automatically.",
  },
  {
    icon: Calendar,
    title: "2. Connect Calendar",
    description: "Connect your Google Calendar so the system can check everyone's availability when suggesting time slots.",
  },
  {
    icon: FileText,
    title: "3. Create a Booking Request",
    description: "Enter the client's name, email, select the meeting type, and configure any preferences like duration or location.",
  },
  {
    icon: Send,
    title: "4. Send the Link",
    description: "Copy the generated link and send it to your client via email. They'll see available time slots based on everyone's calendar.",
  },
  {
    icon: CheckCircle,
    title: "5. Track the Booking",
    description: "Watch the Booking Requests page to see when clients confirm their time. The appointment is automatically created in Lawmatics.",
  },
];

const troubleshootingItems = [
  {
    symptom: "No available times showing for clients",
    causes: [
      "Calendar connection may be disconnected - check Admin Settings",
      "Search window might be too narrow - try extending it when creating the request",
      "All participants may be busy during business hours",
      "If requiring a room, the room calendar may be fully booked",
      "Meeting duration may be too long for available gaps",
    ],
    solution: "First verify calendar connections in Admin Settings. Then try creating a new request with a wider search window or shorter duration.",
  },
  {
    symptom: "Booking confirmation failed",
    causes: [
      "Lawmatics connection may have expired",
      "Lawmatics API permissions may be insufficient",
      "Network connectivity issues",
    ],
    solution: "Check the Lawmatics connection in Admin Settings. If it shows as connected, try reconnecting. If issues persist, check the audit logs for detailed error messages.",
  },
  {
    symptom: "Room not being reserved on the calendar",
    causes: [
      "Room Reservation Mode is set to LawmaticsSync (default)",
      "Room resource email may be incorrect",
      "Calendar connection for room resources may not be configured",
    ],
    solution: "For direct room reservation, change Room Reservation Mode to DirectCalendar in Admin Settings. Verify the room's resource email is correct in Admin → Rooms.",
  },
  {
    symptom: "Client says link is expired",
    causes: [
      "Booking links expire after a set period (typically 7 days)",
      "Someone may have already booked using this link",
      "Request may have been manually cancelled",
    ],
    solution: "Create a new booking request for the client and send them the fresh link. You can see all request statuses on the Booking Requests page.",
  },
  {
    symptom: "Can't see the Booking Requests I created",
    causes: [
      "You may be logged into a different account",
      "Requests may have been filtered or sorted differently",
    ],
    solution: "Check that you're logged in with the correct account. The Booking Requests page shows all requests you have access to, sorted by most recent.",
  },
];

export default function Help() {
  return (
    <MainLayout>
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Help & How It Works</h1>
          <p className="text-muted-foreground mt-1">
            Everything you need to know about using LawScheduler
          </p>
        </div>

        {/* Quick Start Guide */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Office Staff Quick Start
            </CardTitle>
            <CardDescription>
              Get up and running in 5 simple steps
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {quickStartSteps.map((step, index) => {
                const Icon = step.icon;
                return (
                  <div key={index} className="flex gap-4">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">{step.title}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{step.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* What Clients See */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              What Clients See
            </CardTitle>
            <CardDescription>
              Understanding the client booking experience
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              When a client clicks their booking link, they'll see a clean, professional scheduling page:
            </p>
            <div className="bg-muted rounded-lg p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">1</div>
                <div>
                  <p className="font-medium">Meeting Summary</p>
                  <p className="text-sm text-muted-foreground">They see the meeting type, duration, and location (Zoom or in-person).</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">2</div>
                <div>
                  <p className="font-medium">Available Time Slots</p>
                  <p className="text-sm text-muted-foreground">Times that work for all participants are displayed. They simply click to select one.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">3</div>
                <div>
                  <p className="font-medium">Confirmation</p>
                  <p className="text-sm text-muted-foreground">After confirming, they see a success message and will receive email confirmation.</p>
                </div>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              The client never sees internal details like staff calendars or Lawmatics—just a simple, branded scheduling experience.
            </p>
          </CardContent>
        </Card>

        {/* Troubleshooting */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Troubleshooting
            </CardTitle>
            <CardDescription>
              Common issues and how to resolve them
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible className="w-full">
              {troubleshootingItems.map((item, index) => (
                <AccordionItem key={index} value={`item-${index}`}>
                  <AccordionTrigger className="text-left">
                    <span className="font-medium">{item.symptom}</span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-3 pt-2">
                      <div>
                        <p className="text-sm font-medium text-foreground mb-2">Possible causes:</p>
                        <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                          {item.causes.map((cause, i) => (
                            <li key={i}>{cause}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground mb-1">Solution:</p>
                        <p className="text-sm text-muted-foreground">{item.solution}</p>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>

        {/* Contact Admin */}
        <Card className="border-accent">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
                <HelpCircle className="w-6 h-6 text-accent" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground mb-1">Still need help?</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  If you're experiencing issues not covered here, or if something seems broken, 
                  please contact your system administrator.
                </p>
                <p className="text-sm text-muted-foreground">
                  When reporting an issue, include:
                </p>
                <ul className="text-sm text-muted-foreground list-disc list-inside mt-1">
                  <li>What you were trying to do</li>
                  <li>What happened instead</li>
                  <li>Any error messages you saw</li>
                  <li>The approximate time the issue occurred</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
