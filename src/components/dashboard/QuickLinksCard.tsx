import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, FileText, Settings, HelpCircle } from "lucide-react";

export function QuickLinksCard() {
  const navigate = useNavigate();

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
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Quick Links</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-2">
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
  );
}
