import { ReactNode, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Users, DoorOpen, Calendar, Link2, Map, Settings, HelpCircle, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RoleHelpModal } from "@/components/help/RoleHelpModal";
import { DeleteAccountDialog } from "@/components/account/DeleteAccountDialog";

interface AdminLayoutProps {
  children: ReactNode;
}

const navItems = [
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/rooms", label: "Rooms", icon: DoorOpen },
  { href: "/admin/meeting-types", label: "Meeting Types", icon: Calendar },
  { href: "/admin/presets", label: "Pairing Presets", icon: Link2 },
  { href: "/admin/scheduler-mapping", label: "Scheduler Mapping", icon: Map },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export function AdminLayout({ children }: AdminLayoutProps) {
  const location = useLocation();
  const [showRoleHelp, setShowRoleHelp] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold text-foreground">Admin</h1>
            <div className="flex items-center gap-3">
              <DeleteAccountDialog
                trigger={
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive gap-2">
                    <Trash2 className="w-4 h-4" />
                    <span className="hidden sm:inline">Delete My Account</span>
                  </Button>
                }
              />
              <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
                ← Back to Chat
              </Link>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        <nav className="mb-6 flex flex-wrap gap-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <main>{children}</main>
      </div>

      {/* Floating Role Help Button */}
      <Button
        variant="outline"
        size="icon"
        className="fixed bottom-4 right-4 rounded-full shadow-lg z-50 bg-background"
        onClick={() => setShowRoleHelp(true)}
      >
        <HelpCircle className="h-5 w-5" />
      </Button>

      {/* Role Help Modal */}
      <RoleHelpModal open={showRoleHelp} onOpenChange={setShowRoleHelp} />
    </div>
  );
}
