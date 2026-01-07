import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Clock, ArrowRight, Inbox } from "lucide-react";
import type { Json } from "@/integrations/supabase/types";

interface Meeting {
  id: string;
  status: string;
  duration_minutes: number;
  location_mode: string;
  start_datetime: string | null;
  created_at: string;
  external_attendees: Json;
  meeting_types: { name: string } | null;
  booking_requests: { public_token: string; status: string }[] | null;
}

interface RecentActivityProps {
  meetings: Meeting[];
  isLoading: boolean;
}

const statusColors: Record<string, string> = {
  Draft: "bg-muted text-muted-foreground",
  Proposed: "bg-status-info/10 text-status-info border-status-info/20",
  Booked: "bg-status-success/10 text-status-success border-status-success/20",
  Cancelled: "bg-muted text-muted-foreground line-through",
  Failed: "bg-destructive/10 text-destructive border-destructive/20",
  Rescheduled: "bg-status-warning/10 text-status-warning border-status-warning/20",
};

function getClientName(attendees: Json): string {
  if (!Array.isArray(attendees) || attendees.length === 0) return "Unknown Client";
  const first = attendees[0] as { name?: string; email?: string };
  return first?.name || first?.email || "Unknown Client";
}

export function RecentActivity({ meetings, isLoading }: RecentActivityProps) {
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-16 bg-muted rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (meetings.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Inbox className="w-12 h-12 text-muted-foreground/50 mb-3" />
            <h3 className="font-medium text-foreground mb-1">No booking requests yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create your first booking request to get started
            </p>
            <Button onClick={() => navigate("/requests/new")}>
              Create Booking Request
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-xl">Recent Activity</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => navigate("/requests")}>
          View All
          <ArrowRight className="w-4 h-4 ml-1" />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {meetings.map((meeting) => (
            <div
              key={meeting.id}
              className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors cursor-pointer"
              onClick={() => navigate(`/requests?id=${meeting.id}`)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-foreground truncate">
                    {getClientName(meeting.external_attendees)}
                  </span>
                  <Badge variant="outline" className={statusColors[meeting.status]}>
                    {meeting.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span>{meeting.meeting_types?.name || "Meeting"}</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {meeting.duration_minutes} min
                  </span>
                  <span>
                    {format(new Date(meeting.created_at), "MMM d, h:mm a")}
                  </span>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
