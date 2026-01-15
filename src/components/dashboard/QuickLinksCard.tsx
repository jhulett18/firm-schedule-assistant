import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, FileText, Settings, HelpCircle, CalendarCheck } from "lucide-react";
import { BookClientNowDialog } from "@/components/requests/BookClientNowDialog";

export function QuickLinksCard() {
  const navigate = useNavigate();
  const [bookNowDialogOpen, setBookNowDialogOpen] = useState(false);

  const links = [
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

            {/* Book Client Now - always shown, wizard handles everything */}
            <Button
              variant="outline"
              className="justify-start gap-2 h-auto py-3 bg-primary/10 hover:bg-primary/20 border-primary/20"
              onClick={() => setBookNowDialogOpen(true)}
            >
              <CalendarCheck className="w-4 h-4" />
              Book Client Now
            </Button>

            {/* Other links */}
            {links.map((link) => {
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
        onSuccess={() => {}}
      />
    </>
  );
}
