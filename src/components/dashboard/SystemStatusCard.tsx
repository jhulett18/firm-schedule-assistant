import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckCircle, XCircle, AlertCircle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SystemStatus } from "@/hooks/useDashboardData";

interface SystemStatusCardProps {
  status: SystemStatus;
  isLoading: boolean;
}

export function SystemStatusCard({ status, isLoading }: SystemStatusCardProps) {
  const [isOpen, setIsOpen] = useState(true);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">System Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-muted rounded w-3/4" />
            <div className="h-4 bg-muted rounded w-1/2" />
            <div className="h-4 bg-muted rounded w-2/3" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const items = [
    {
      label: "Lawmatics",
      connected: status.lawmaticsConnected,
      required: true,
    },
    {
      label: "Calendar (Google)",
      connected: status.calendarConnected,
      required: true,
    },
    {
      label: "Conference Rooms",
      connected: status.roomsCount > 0,
      count: status.roomsCount,
      required: false,
    },
    {
      label: "Meeting Types",
      connected: status.meetingTypesCount > 0,
      count: status.meetingTypesCount,
      required: false,
    },
  ];

  const hasIssues = items.some((item) => item.required && !item.connected);

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg">System Status</CardTitle>
                <ChevronDown
                  className={cn(
                    "w-4 h-4 text-muted-foreground transition-transform",
                    isOpen && "rotate-180"
                  )}
                />
              </div>
              {hasIssues ? (
                <Badge variant="destructive" className="gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Action Required
                </Badge>
              ) : (
                <Badge className="bg-status-success text-white gap-1">
                  <CheckCircle className="w-3 h-3" />
                  Ready
                </Badge>
              )}
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent>
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.label} className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{item.label}</span>
                  {item.connected ? (
                    <div className="flex items-center gap-2">
                      {item.count !== undefined && (
                        <span className="text-sm font-medium">{item.count} active</span>
                      )}
                      <CheckCircle className="w-4 h-4 text-status-success" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Not configured</span>
                      {item.required ? (
                        <XCircle className="w-4 h-4 text-destructive" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-status-warning" />
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
