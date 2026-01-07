import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import type { SystemStatus } from "@/hooks/useDashboardData";
import { formatDistanceToNow } from "date-fns";

interface SystemStatusCardProps {
  status: SystemStatus;
  isLoading: boolean;
}

export function SystemStatusCard({ status, isLoading }: SystemStatusCardProps) {
  const { isAdmin } = useAuth();

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
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">System Status</CardTitle>
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

          {/* Google Connections List (Admin only) */}
          {isAdmin && status.googleConnections.length > 0 && (
            <div className="pt-3 border-t mt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Google Connections: {status.googleConnections.length}</span>
                <Link to="/admin/settings#calendar" className="text-xs text-primary hover:underline">
                  Manage
                </Link>
              </div>
              <div className="space-y-1.5">
                {status.googleConnections.slice(0, 3).map((conn) => (
                  <div key={conn.userId} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground truncate max-w-[120px]" title={conn.userName}>
                      {conn.userName}
                    </span>
                    <div className="flex items-center gap-1">
                      {conn.lastVerifiedOk === null ? (
                        <Badge variant="secondary" className="text-[10px] px-1 py-0">Unverified</Badge>
                      ) : conn.lastVerifiedOk ? (
                        <Badge className="bg-green-600 text-[10px] px-1 py-0">OK</Badge>
                      ) : (
                        <Badge variant="destructive" className="text-[10px] px-1 py-0">Failed</Badge>
                      )}
                      {conn.lastVerifiedAt && (
                        <span className="text-muted-foreground">
                          {formatDistanceToNow(new Date(conn.lastVerifiedAt), { addSuffix: true })}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {status.googleConnections.length > 3 && (
                  <Link to="/admin/settings#calendar" className="text-xs text-primary hover:underline block">
                    +{status.googleConnections.length - 3} more
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
