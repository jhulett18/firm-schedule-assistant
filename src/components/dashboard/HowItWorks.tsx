import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Link2, Calendar, CheckCircle } from "lucide-react";

const steps = [
  {
    icon: FileText,
    title: "Create a Booking Request",
    description: "Enter client details and meeting preferences",
  },
  {
    icon: Link2,
    title: "Send the Link",
    description: "Client receives a link to pick their preferred time",
  },
  {
    icon: Calendar,
    title: "Client Selects a Time",
    description: "They choose from available slots that fit everyone's calendar",
  },
  {
    icon: CheckCircle,
    title: "Appointment Created",
    description: "Calendar event is automatically created in Lawmatics",
  },
];

export function HowItWorks() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">How It Works</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <div key={index} className="relative">
                <div className="flex flex-col items-center text-center p-4">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                    <Icon className="w-6 h-6 text-primary" />
                  </div>
                  <div className="absolute -top-1 -left-1 w-6 h-6 rounded-full bg-accent text-accent-foreground text-sm font-bold flex items-center justify-center">
                    {index + 1}
                  </div>
                  <h3 className="font-medium text-foreground mb-1">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.description}</p>
                </div>
                {index < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-1/2 -right-2 w-4 h-0.5 bg-border" />
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
