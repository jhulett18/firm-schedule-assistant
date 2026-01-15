import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, FileText, Settings, HelpCircle, CalendarCheck } from "lucide-react";
import { BookClientNowDialog } from "@/components/requests/BookClientNowDialog";
import type { Json } from "@/integrations/supabase/types";

interface Meeting {
  id: string;
  meeting_types: { name: string } | null;
  duration_minutes: number;
  location_mode: string;
  booking_requests: { public_token: string }[] | null;
}

export function QuickLinksCard() {
  const navigate = useNavigate();
  const [bookNowDialogOpen, setBookNowDialogOpen] = useState(false);

  // Fetch a bookable meeting (Proposed or Draft with a token)
  const { data: bookableMeeting, refetch } = useQuery({
    queryKey: ["bookable-meeting-dashboard"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meetings")
        .select(`
          id,
          status,
          duration_minutes,
          location_mode,
          meeting_types (name),
          booking_requests (public_token)
        `)
        .in("status", ["Proposed", "Draft"])
        .order("created_at", { ascending: false })
        .limit(1);
      
      if (error) throw error;
      
      // Find first meeting with a valid token
      const meeting = data?.find(m => m.booking_requests?.[0]?.public_token);
      return meeting as Meeting | null;
    },
  });

  const links = [
    {
      label: "Create Booking Request",
      icon: Plus,
      href: "/requests/new",
      variant: "default" as const,
    },
    {
      label: "View Booking Requests",
      icon: FileText,
      href: "/requests",
      variant: "outline" as const,
    },
    {
      label: "Admin Settings",
      icon: Settings,
      href: "/admin/settings",
      variant: "outline" as const,
    },
    {
      label: "Help & How It Works",
      icon: HelpCircle,
      href: "/help",
      variant: "outline" as const,
    },
  ];

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Quick Links</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-2">
            {/* Create Booking Request */}
            <Button
              variant="default"
              className="justify-start gap-2 h-auto py-3"
              onClick={() => navigate("/requests/new")}
            >
              <Plus className="w-4 h-4" />
              Create Booking Request
            </Button>

            {/* Book Client Now - shown if there's a bookable meeting */}
            {bookableMeeting && (
              <Button
                variant="outline"
                className="justify-start gap-2 h-auto py-3 bg-primary/10 hover:bg-primary/20 border-primary/20"
                onClick={() => setBookNowDialogOpen(true)}
              >
                <CalendarCheck className="w-4 h-4" />
                Book Client Now
              </Button>
            )}

            {/* Other links */}
            {links.slice(1).map((link) => {
              const Icon = link.icon;
              return (
                <Button
                  key={link.href}
                  variant={link.variant}
                  className="justify-start gap-2 h-auto py-3"
                  onClick={() => navigate(link.href)}
                >
                  <Icon className="w-4 h-4" />
                  {link.label}
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Book Client Now Dialog */}
      <BookClientNowDialog
        open={bookNowDialogOpen}
        onOpenChange={setBookNowDialogOpen}
        onSuccess={() => refetch()}
      />
    </>
  );
}
