import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, FileText, Settings, HelpCircle, CalendarCheck, User } from "lucide-react";
import { BookClientNowDialog } from "@/components/requests/BookClientNowDialog";

interface QuickLinksCardProps {
  isAdmin?: boolean;
}

export function QuickLinksCard({ isAdmin = false }: QuickLinksCardProps) {
  const navigate = useNavigate();
  const [bookNowDialogOpen, setBookNowDialogOpen] = useState(false);

  const allLinks = [
    {
      label: "View Booking Requests",
      icon: FileText,
      href: "/requests",
      variant: "outline" as const,
      showForStaff: true,
    },
    {
      label: "Admin Settings",
      icon: Settings,
      href: "/admin/settings",
      variant: "outline" as const,
      showForStaff: false,
    },
    {
      label: "My Settings",
      icon: User,
      href: "/settings",
      variant: "outline" as const,
      showForStaff: true,
      hideForAdmin: true,
    },
    {
      label: "Help & How It Works",
      icon: HelpCircle,
      href: "/help",
      variant: "outline" as const,
      showForStaff: true,
    },
  ];

  const links = allLinks.filter(link =>
    isAdmin ? !link.hideForAdmin : link.showForStaff
  );

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
              className="justify-start gap-2 h-auto py-3 bg-accent/10 hover:bg-accent/20 border-accent/30"
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
