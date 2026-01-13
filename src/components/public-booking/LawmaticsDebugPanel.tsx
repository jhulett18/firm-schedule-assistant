import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Bug, CheckCircle, XCircle, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface DebugAttempt {
  endpoint?: string;
  method?: string;
  status?: number;
  body_excerpt?: string;
}

interface DebugSection {
  attempted: boolean;
  endpoint?: string;
  status?: number;
  id?: string;
  body_excerpt?: string;
}

interface LawmaticsDebug {
  contact?: DebugSection;
  matter?: DebugSection;
  event?: DebugSection;
  timestamp?: string;
}

interface LawmaticsDebugPanelProps {
  debug: LawmaticsDebug | null;
  className?: string;
}

function StatusBadge({ status }: { status?: number }) {
  if (!status) return <Badge variant="outline">No Response</Badge>;
  
  if (status >= 200 && status < 300) {
    return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">{status} OK</Badge>;
  }
  if (status >= 400 && status < 500) {
    return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">{status} Client Error</Badge>;
  }
  if (status >= 500) {
    return <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">{status} Server Error</Badge>;
  }
  return <Badge variant="outline">{status}</Badge>;
}

function DebugSectionCard({ title, section }: { title: string; section?: DebugSection }) {
  const [expanded, setExpanded] = useState(false);
  
  if (!section) {
    return (
      <div className="p-3 border rounded-md bg-muted/50">
        <div className="flex items-center gap-2">
          <XCircle className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{title}</span>
          <Badge variant="outline">Not attempted</Badge>
        </div>
      </div>
    );
  }
  
  const isSuccess = section.status && section.status >= 200 && section.status < 300;
  const Icon = section.attempted 
    ? (isSuccess ? CheckCircle : (section.status && section.status >= 400 ? XCircle : AlertTriangle))
    : XCircle;
  const iconColor = isSuccess ? "text-green-600" : (section.status && section.status >= 400 ? "text-red-600" : "text-amber-600");

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div className="border rounded-md overflow-hidden">
        <CollapsibleTrigger asChild>
          <button className="w-full p-3 flex items-center justify-between hover:bg-muted/50 transition-colors text-left">
            <div className="flex items-center gap-2">
              <Icon className={`h-4 w-4 ${iconColor}`} />
              <span className="font-medium">{title}</span>
              <StatusBadge status={section.status} />
              {section.id && (
                <Badge variant="secondary" className="font-mono text-xs">
                  ID: {section.id}
                </Badge>
              )}
            </div>
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="p-3 pt-0 space-y-2 text-sm">
            {section.endpoint && (
              <div>
                <span className="text-muted-foreground">Endpoint: </span>
                <code className="text-xs bg-muted px-1 py-0.5 rounded">{section.endpoint}</code>
              </div>
            )}
            {section.body_excerpt && (
              <div>
                <span className="text-muted-foreground">Response: </span>
                <pre className="mt-1 text-xs bg-muted p-2 rounded overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">
                  {section.body_excerpt}
                </pre>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function LawmaticsDebugPanel({ debug, className }: LawmaticsDebugPanelProps) {
  if (!debug) {
    return (
      <div className={className}>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">No Lawmatics debug data available.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={className}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Bug className="h-5 w-5" />
            Lawmatics Integration Debug
          </CardTitle>
          {debug.timestamp && (
            <p className="text-xs text-muted-foreground">
              Captured: {new Date(debug.timestamp).toLocaleString()}
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <DebugSectionCard title="Contact" section={debug.contact} />
          <DebugSectionCard title="Matter/Prospect" section={debug.matter} />
          <DebugSectionCard title="Event/Appointment" section={debug.event} />
        </CardContent>
      </Card>
    </div>
  );
}

interface LawmaticsDebugButtonProps {
  debug: LawmaticsDebug | null;
}

export function LawmaticsDebugButton({ debug }: LawmaticsDebugButtonProps) {
  const hasMatterIssue = debug?.matter?.attempted && (!debug.matter.id || (debug.matter.status && debug.matter.status >= 400));
  
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          size="sm"
          className={hasMatterIssue ? "border-amber-500 text-amber-600 hover:bg-amber-50" : ""}
        >
          <Bug className="h-4 w-4 mr-2" />
          {hasMatterIssue ? "Debug (Issues Found)" : "View Debug"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bug className="h-5 w-5" />
            Lawmatics Integration Debug
          </DialogTitle>
        </DialogHeader>
        <LawmaticsDebugPanel debug={debug} />
      </DialogContent>
    </Dialog>
  );
}
