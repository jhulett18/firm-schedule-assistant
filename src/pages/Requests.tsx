import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Inbox,
  Copy,
  Mail,
  Eye,
  XCircle,
  MoreHorizontal,
  Clock,
  MapPin,
  Video,
  CalendarCheck,
  Search,
  Download,
  Trash2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { copyToClipboard, getBookingUrl, generateClientEmailTemplate } from "@/lib/clipboard";
import { BookClientNowDialog } from "@/components/requests/BookClientNowDialog";
import type { Json } from "@/integrations/supabase/types";

interface Meeting {
  id: string;
  status: string;
  duration_minutes: number;
  location_mode: string;
  start_datetime: string | null;
  created_at: string;
  updated_at: string;
  external_attendees: Json;
  meeting_types: { name: string } | null;
  booking_requests: { id: string; public_token: string; status: string; expires_at: string }[] | null;
}

const statusColors: Record<string, string> = {
  Draft: "bg-muted text-muted-foreground",
  Proposed: "bg-status-info/10 text-status-info border-status-info/20",
  Booked: "bg-status-success/10 text-status-success border-status-success/20",
  Cancelled: "bg-muted text-muted-foreground",
  Failed: "bg-destructive/10 text-destructive border-destructive/20",
  Rescheduled: "bg-status-warning/10 text-status-warning border-status-warning/20",
};

function getClientInfo(attendees: Json): { name: string; email: string } {
  if (!Array.isArray(attendees) || attendees.length === 0) {
    return { name: "Unknown", email: "" };
  }
  const first = attendees[0] as { name?: string; email?: string };
  return {
    name: first?.name || "Unknown",
    email: first?.email || "",
  };
}

export default function Requests() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailMeeting, setEmailMeeting] = useState<Meeting | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelMeeting, setCancelMeeting] = useState<Meeting | null>(null);
  const [bookNowDialogOpen, setBookNowDialogOpen] = useState(false);
  const [bookNowMeeting, setBookNowMeeting] = useState<Meeting | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [clearAllDialogOpen, setClearAllDialogOpen] = useState(false);

  // Check for detail view from URL
  const detailId = searchParams.get("id");

  // Scope meetings to current user via RLS (created_by_user_id = internalUser.id)
  const { data: meetings, isLoading } = useQuery({
    queryKey: ["booking-requests"],
    queryFn: async () => {
      // RLS will automatically filter to meetings where created_by_user_id = current user
      const { data, error } = await supabase
        .from("meetings")
        .select(`
          id,
          status,
          duration_minutes,
          location_mode,
          start_datetime,
          created_at,
          updated_at,
          external_attendees,
          meeting_types (name),
          booking_requests (id, public_token, status, expires_at)
        `)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as Meeting[];
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (meetingId: string) => {
      const { error } = await supabase
        .from("meetings")
        .update({ status: "Cancelled", updated_at: new Date().toISOString() })
        .eq("id", meetingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["booking-requests"] });
      toast.success("Request cancelled");
      setCancelDialogOpen(false);
      setCancelMeeting(null);
    },
    onError: (error) => {
      toast.error(`Failed to cancel: ${error.message}`);
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      // Delete all meetings for the current user (RLS will scope this)
      const { error } = await supabase
        .from("meetings")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000"); // Delete all (RLS scopes to user)
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["booking-requests"] });
      queryClient.invalidateQueries({ queryKey: ["recent-meetings"] });
      toast.success("All requests cleared");
      setClearAllDialogOpen(false);
    },
    onError: (error) => {
      toast.error(`Failed to clear requests: ${error.message}`);
    },
  });

  // Filter meetings based on search query
  const filteredMeetings = meetings?.filter((meeting) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const client = getClientInfo(meeting.external_attendees);
    const dateStr = format(new Date(meeting.created_at), "MMM d yyyy").toLowerCase();
    return (
      client.name.toLowerCase().includes(query) ||
      client.email.toLowerCase().includes(query) ||
      dateStr.includes(query)
    );
  });

  // Download all history as CSV
  const handleDownloadHistory = () => {
    if (!meetings || meetings.length === 0) {
      toast.error("No requests to download");
      return;
    }

    const headers = ["Client Name", "Client Email", "Meeting Type", "Duration", "Location", "Status", "Created", "Scheduled Time"];
    const rows = meetings.map((meeting) => {
      const client = getClientInfo(meeting.external_attendees);
      return [
        client.name,
        client.email,
        meeting.meeting_types?.name || "",
        `${meeting.duration_minutes} min`,
        meeting.location_mode,
        meeting.status,
        format(new Date(meeting.created_at), "yyyy-MM-dd HH:mm"),
        meeting.start_datetime ? format(new Date(meeting.start_datetime), "yyyy-MM-dd HH:mm") : "",
      ];
    });

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `booking-requests-${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("History downloaded");
  };

  const handleCopyLink = (meeting: Meeting) => {
    const token = meeting.booking_requests?.[0]?.public_token;
    if (token) {
      copyToClipboard(getBookingUrl(token), "Client link copied!");
    }
  };

  const handleShowEmail = (meeting: Meeting) => {
    setEmailMeeting(meeting);
    setEmailDialogOpen(true);
  };

  const handleCopyEmail = () => {
    if (!emailMeeting) return;
    const client = getClientInfo(emailMeeting.external_attendees);
    const token = emailMeeting.booking_requests?.[0]?.public_token;
    const expires = emailMeeting.booking_requests?.[0]?.expires_at;
    
    if (!token) return;
    
    const template = generateClientEmailTemplate({
      clientName: client.name,
      meetingTypeName: emailMeeting.meeting_types?.name || "Meeting",
      bookingUrl: getBookingUrl(token),
      expiresAt: expires ? format(new Date(expires), "MMMM d, yyyy 'at' h:mm a") : "soon",
    });
    
    copyToClipboard(template, "Email template copied!");
    setEmailDialogOpen(false);
  };

  const handleCancelRequest = (meeting: Meeting) => {
    setCancelMeeting(meeting);
    setCancelDialogOpen(true);
  };

  const handleBookNow = (meeting: Meeting) => {
    setBookNowMeeting(meeting);
    setBookNowDialogOpen(true);
  };

  const handleBookNowSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["booking-requests"] });
  };

  // Detail view
  const detailMeeting = detailId ? meetings?.find((m) => m.id === detailId) : null;

  if (detailMeeting) {
    const client = getClientInfo(detailMeeting.external_attendees);
    const token = detailMeeting.booking_requests?.[0]?.public_token;

    return (
      <MainLayout>
        <div className="max-w-2xl mx-auto space-y-6">
          <Button variant="ghost" onClick={() => navigate("/requests")} className="mb-4">
            ← Back to Requests
          </Button>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-2xl">{client.name}</CardTitle>
                  <CardDescription>{client.email}</CardDescription>
                </div>
                <Badge variant="outline" className={statusColors[detailMeeting.status]}>
                  {detailMeeting.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Meeting Type</p>
                  <p className="font-medium">{detailMeeting.meeting_types?.name || "Meeting"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Duration</p>
                  <p className="font-medium">{detailMeeting.duration_minutes} minutes</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Location</p>
                  <p className="font-medium flex items-center gap-1">
                    {detailMeeting.location_mode === "Zoom" ? (
                      <><Video className="w-4 h-4" /> Video Call</>
                    ) : (
                      <><MapPin className="w-4 h-4" /> In Person</>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Created</p>
                  <p className="font-medium">
                    {format(new Date(detailMeeting.created_at), "MMM d, yyyy h:mm a")}
                  </p>
                </div>
                {detailMeeting.start_datetime && (
                  <div className="col-span-2">
                    <p className="text-sm text-muted-foreground">Scheduled Time</p>
                    <p className="font-medium">
                      {format(new Date(detailMeeting.start_datetime), "EEEE, MMMM d, yyyy 'at' h:mm a")}
                    </p>
                  </div>
                )}
              </div>

              {token && detailMeeting.status !== "Cancelled" && detailMeeting.status !== "Booked" && (
                <div className="pt-4 border-t space-y-3">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Client Booking Link</p>
                    <div className="flex gap-2">
                      <code className="flex-1 px-3 py-2 bg-muted rounded text-sm break-all">
                        {getBookingUrl(token)}
                      </code>
                      <Button variant="outline" size="sm" onClick={() => handleCopyLink(detailMeeting)}>
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button onClick={() => handleBookNow(detailMeeting)}>
                      <CalendarCheck className="w-4 h-4 mr-2" />
                      Book Client Now
                    </Button>
                    <Button variant="outline" onClick={() => handleShowEmail(detailMeeting)}>
                      <Mail className="w-4 h-4 mr-2" />
                      Copy Email Template
                    </Button>
                    <Button variant="outline" onClick={() => handleCancelRequest(detailMeeting)}>
                      <XCircle className="w-4 h-4 mr-2" />
                      Cancel Request
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-serif font-bold text-foreground">Booking Requests</h1>
            <p className="text-muted-foreground">Track and manage client scheduling links</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleDownloadHistory} disabled={!meetings || meetings.length === 0}>
              <Download className="w-4 h-4 mr-2" />
              Download History
            </Button>
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setClearAllDialogOpen(true)} disabled={!meetings || meetings.length === 0}>
              <Trash2 className="w-4 h-4 mr-2" />
              Clear All
            </Button>
          </div>
        </div>

        {/* Search/Filter */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, or date..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="py-8">
              <div className="animate-pulse space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 bg-muted rounded" />
                ))}
              </div>
            </CardContent>
          </Card>
        ) : filteredMeetings && filteredMeetings.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="flex flex-col items-center text-center">
                <Inbox className="w-16 h-16 text-muted-foreground/50 mb-4" />
                <h3 className="text-xl font-semibold mb-2">
                  {searchQuery ? "No matching requests" : "No booking requests yet"}
                </h3>
                <p className="text-muted-foreground max-w-md">
                  {searchQuery
                    ? "Try adjusting your search terms to find what you're looking for."
                    : "When you create a booking request, you'll get a unique link to send to your client."}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Meeting Type</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMeetings?.map((meeting) => {
                    const client = getClientInfo(meeting.external_attendees);
                    const hasToken = meeting.booking_requests?.[0]?.public_token;

                    return (
                      <TableRow
                        key={meeting.id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/requests?id=${meeting.id}`)}
                      >
                        <TableCell>
                          <div>
                            <p className="font-medium">{client.name}</p>
                            <p className="text-sm text-muted-foreground">{client.email}</p>
                          </div>
                        </TableCell>
                        <TableCell>{meeting.meeting_types?.name || "—"}</TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {meeting.duration_minutes}m
                          </span>
                        </TableCell>
                        <TableCell>
                          {meeting.location_mode === "Zoom" ? (
                            <span className="flex items-center gap-1">
                              <Video className="w-3 h-3" />
                              Zoom
                            </span>
                          ) : (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              In-Person
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusColors[meeting.status]}>
                            {meeting.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {format(new Date(meeting.created_at), "MMM d, h:mm a")}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/requests?id=${meeting.id}`);
                              }}>
                                <Eye className="w-4 h-4 mr-2" />
                                View Details
                              </DropdownMenuItem>
                              {hasToken && meeting.status !== "Cancelled" && meeting.status !== "Booked" && (
                                <>
                                  <DropdownMenuItem onClick={(e) => {
                                    e.stopPropagation();
                                    handleBookNow(meeting);
                                  }}>
                                    <CalendarCheck className="w-4 h-4 mr-2" />
                                    Book Client Now
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={(e) => {
                                    e.stopPropagation();
                                    handleCopyLink(meeting);
                                  }}>
                                    <Copy className="w-4 h-4 mr-2" />
                                    Copy Link
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={(e) => {
                                    e.stopPropagation();
                                    handleShowEmail(meeting);
                                  }}>
                                    <Mail className="w-4 h-4 mr-2" />
                                    Copy Email
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-destructive"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCancelRequest(meeting);
                                    }}
                                  >
                                    <XCircle className="w-4 h-4 mr-2" />
                                    Cancel
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </div>

      {/* Email Template Dialog */}
      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Email Template</DialogTitle>
            <DialogDescription>
              Copy this message to send to your client
            </DialogDescription>
          </DialogHeader>
          {emailMeeting && (
            <div className="bg-muted rounded-lg p-4 text-sm whitespace-pre-wrap font-mono max-h-[300px] overflow-y-auto">
              {generateClientEmailTemplate({
                clientName: getClientInfo(emailMeeting.external_attendees).name,
                meetingTypeName: emailMeeting.meeting_types?.name || "Meeting",
                bookingUrl: getBookingUrl(emailMeeting.booking_requests?.[0]?.public_token || ""),
                expiresAt: emailMeeting.booking_requests?.[0]?.expires_at
                  ? format(new Date(emailMeeting.booking_requests[0].expires_at), "MMMM d, yyyy 'at' h:mm a")
                  : "soon",
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailDialogOpen(false)}>
              Close
            </Button>
            <Button onClick={handleCopyEmail}>
              <Copy className="w-4 h-4 mr-2" />
              Copy to Clipboard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Confirmation Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Booking Request?</DialogTitle>
            <DialogDescription>
              This will prevent the client from using the booking link. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>
              Keep Request
            </Button>
            <Button
              variant="destructive"
              onClick={() => cancelMeeting && cancelMutation.mutate(cancelMeeting.id)}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending ? "Cancelling..." : "Cancel Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Book Client Now Dialog */}
      <BookClientNowDialog
        open={bookNowDialogOpen}
        onOpenChange={setBookNowDialogOpen}
        onSuccess={handleBookNowSuccess}
      />

      {/* Clear All Confirmation Dialog */}
      <Dialog open={clearAllDialogOpen} onOpenChange={setClearAllDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear All Requests?</DialogTitle>
            <DialogDescription>
              This will permanently delete all your booking requests. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearAllDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => clearAllMutation.mutate()}
              disabled={clearAllMutation.isPending}
            >
              {clearAllMutation.isPending ? "Clearing..." : "Clear All Requests"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
