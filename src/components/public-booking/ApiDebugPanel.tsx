import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Bug, ChevronDown, ChevronRight, Copy, CheckCircle } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";

export interface ApiCall {
  id: string;
  name: string;
  timestamp: Date;
  request?: {
    method?: string;
    url?: string;
    body?: any;
  };
  response?: {
    status?: number;
    statusText?: string;
    body?: any;
    rawText?: string;
    parseError?: string;
  };
  error?: string;
  duration?: number;
}

interface ApiCallCardProps {
  call: ApiCall;
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

function ApiCallCard({ call }: ApiCallCardProps) {
  const [requestExpanded, setRequestExpanded] = useState(false);
  const [responseExpanded, setResponseExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error("Failed to copy");
    }
  };

  const formatJson = (data: any): string => {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  };

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base font-medium">{call.name}</CardTitle>
            <StatusBadge status={call.response?.status} />
          </div>
          <div className="text-xs text-muted-foreground">
            {call.timestamp.toLocaleTimeString()}
            {call.duration && <span className="ml-2">({call.duration}ms)</span>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Request Section */}
        {call.request && (
          <Collapsible open={requestExpanded} onOpenChange={setRequestExpanded}>
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
                {requestExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Request
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="space-y-2">
                {call.request.method && call.request.url && (
                  <div className="text-xs">
                    <span className="font-mono bg-muted px-1 py-0.5 rounded">{call.request.method}</span>
                    <span className="ml-2 text-muted-foreground">{call.request.url}</span>
                  </div>
                )}
                {call.request.body && (
                  <div className="relative">
                    <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">
                      {formatJson(call.request.body)}
                    </pre>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-1 right-1 h-6 w-6"
                      onClick={() => copyToClipboard(formatJson(call.request!.body))}
                    >
                      {copied ? <CheckCircle className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </Button>
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Response Section */}
        <Collapsible open={responseExpanded} onOpenChange={setResponseExpanded}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
              {responseExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Response
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <div className="space-y-2">
              {call.error && (
                <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">
                  Error: {call.error}
                </div>
              )}
              {call.response?.parseError && (
                <div className="text-xs text-amber-600 bg-amber-100 dark:bg-amber-900/30 p-2 rounded">
                  Parse Error: {call.response.parseError}
                </div>
              )}
              {call.response?.rawText && !call.response?.body && (
                <div className="relative">
                  <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap">
                    {call.response.rawText}
                  </pre>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-1 right-1 h-6 w-6"
                    onClick={() => copyToClipboard(call.response!.rawText!)}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              )}
              {call.response?.body && (
                <div className="relative">
                  <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap">
                    {formatJson(call.response.body)}
                  </pre>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-1 right-1 h-6 w-6"
                    onClick={() => copyToClipboard(formatJson(call.response!.body))}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

interface ApiDebugPanelProps {
  calls: ApiCall[];
}

export function ApiDebugPanel({ calls }: ApiDebugPanelProps) {
  if (calls.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-4">
        No API calls recorded yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {calls.map((call) => (
        <ApiCallCard key={call.id} call={call} />
      ))}
    </div>
  );
}

interface ApiDebugButtonProps {
  calls: ApiCall[];
  hasWarnings?: boolean;
}

export function ApiDebugButton({ calls, hasWarnings }: ApiDebugButtonProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          size="sm"
          className={hasWarnings ? "border-amber-500 text-amber-600 hover:bg-amber-50" : ""}
        >
          <Bug className="h-4 w-4 mr-2" />
          Debug {calls.length > 0 && `(${calls.length})`}
          {hasWarnings && <span className="ml-1 text-amber-500">⚠</span>}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bug className="h-5 w-5" />
            API Debug Log
          </DialogTitle>
        </DialogHeader>
        <ApiDebugPanel calls={calls} />
      </DialogContent>
    </Dialog>
  );
}
