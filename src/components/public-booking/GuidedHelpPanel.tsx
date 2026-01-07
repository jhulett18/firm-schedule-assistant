import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CalendarCheck, MousePointerClick, CheckCircle2, HelpCircle, ChevronDown, ChevronUp } from "lucide-react";

interface GuidedHelpPanelProps {
  onGetStarted: () => void;
  clientTimezone: string;
  contactEmail?: string;
  contactPhone?: string;
}

export function GuidedHelpPanel({ 
  onGetStarted, 
  clientTimezone,
  contactEmail,
  contactPhone 
}: GuidedHelpPanelProps) {
  const [faqOpen, setFaqOpen] = useState(false);

  const faqs = [
    {
      question: "What if none of these times work?",
      answer: contactEmail || contactPhone 
        ? `Please contact our office${contactPhone ? ` at ${contactPhone}` : ""}${contactEmail ? ` or email us at ${contactEmail}` : ""} and we'll find a time that works for you.`
        : "Please contact our office and we'll work together to find a time that fits your schedule."
    },
    {
      question: "Will I get a confirmation?",
      answer: "Yes! Once you confirm your time, you'll receive a confirmation email with all the meeting details, including any links or instructions you'll need."
    },
    {
      question: "What timezone are these times in?",
      answer: `All times shown are in ${clientTimezone}. If this doesn't match your timezone, please contact our office.`
    },
    {
      question: "Can I reschedule later?",
      answer: "If you need to reschedule after booking, please contact our office as soon as possible and we'll help you find a new time."
    }
  ];

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg text-primary flex items-center gap-2">
          <CalendarCheck className="h-5 w-5" />
          You don't have an appointment scheduled yet
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Follow these simple steps to schedule your meeting:
        </p>
        
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">
              1
            </div>
            <div className="flex items-center gap-2">
              <CalendarCheck className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Choose a day</span>
            </div>
          </div>
          
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">
              2
            </div>
            <div className="flex items-center gap-2">
              <MousePointerClick className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Pick a time that works for you</span>
            </div>
          </div>
          
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">
              3
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Confirm — we'll send details right after</span>
            </div>
          </div>
        </div>

        <Button onClick={onGetStarted} className="w-full mt-4">
          Get Started
        </Button>

        <Collapsible open={faqOpen} onOpenChange={setFaqOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full text-sm text-muted-foreground hover:text-foreground">
              <HelpCircle className="h-4 w-4 mr-2" />
              Need help?
              {faqOpen ? <ChevronUp className="h-4 w-4 ml-2" /> : <ChevronDown className="h-4 w-4 ml-2" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 mt-3">
            {faqs.map((faq, index) => (
              <div key={index} className="rounded-lg bg-background p-3 text-sm">
                <p className="font-medium text-foreground">{faq.question}</p>
                <p className="text-muted-foreground mt-1">{faq.answer}</p>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
