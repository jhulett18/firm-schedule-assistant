import { ReactNode, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  Scale,
  Settings,
  Menu,
  Home,
  FileText,
  HelpCircle,
  Plus,
  Building2,
} from "lucide-react";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { RoleHelpModal } from "@/components/help/RoleHelpModal";
import { cn } from "@/lib/utils";

interface MainLayoutProps {
  children: ReactNode;
}

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/requests", label: "Booking Requests", icon: FileText },
  { href: "/help", label: "Help", icon: HelpCircle },
];

export function MainLayout({ children }: MainLayoutProps) {
  const { internalUser, isAdmin, isStaff, isSuperuser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [showRoleHelp, setShowRoleHelp] = useState(false);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="flex-shrink-0 h-16 border-b bg-card flex items-center justify-between px-4 shadow-subtle">
        <div className="flex items-center gap-4">
          <Link to="/dashboard" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg gradient-primary flex items-center justify-center">
              <Scale className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="hidden sm:block">
              <h1 className="font-serif text-lg font-semibold leading-tight">LawScheduler</h1>
              <p className="text-xs text-muted-foreground leading-tight">Client Scheduling Made Simple</p>
            </div>
          </Link>
        </div>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              if (location.pathname === "/requests/new") {
                // Already on the page, force a full page reload to reset state
                window.location.href = "/requests/new";
              } else {
                navigate("/requests/new");
              }
            }}
            size="sm"
            className="hidden sm:flex gap-2"
          >
            <Plus className="w-4 h-4" />
            New Request
          </Button>

          <NotificationCenter />

          {isSuperuser && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/manager")}
              className="hidden md:flex gap-1"
            >
              <Building2 className="w-4 h-4" />
              Manager
            </Button>
          )}

          {isAdmin ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/admin/settings")}
              className="hidden md:flex"
            >
              <Settings className="w-4 h-4" />
            </Button>
          ) : isStaff ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/settings")}
              className="hidden md:flex"
            >
              <Settings className="w-4 h-4" />
            </Button>
          ) : null}

          {/* Mobile menu */}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu className="w-5 h-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <div className="flex flex-col gap-2 mt-6">
                <div className="px-2 py-3 border-b mb-2">
                  <p className="font-medium">{internalUser?.name || "User"}</p>
                  <p className="text-sm text-muted-foreground">{internalUser?.email}</p>
                </div>

                <Button
                  className="justify-start gap-2"
                  onClick={() => {
                    if (location.pathname === "/requests/new") {
                      // Already on the page, force a full page reload to reset state
                      window.location.href = "/requests/new";
                    } else {
                      navigate("/requests/new");
                    }
                  }}
                >
                  <Plus className="w-4 h-4" />
                  New Booking Request
                </Button>

                <div className="h-px bg-border my-2" />

                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.href;
                  return (
                    <Button
                      key={item.href}
                      variant={isActive ? "secondary" : "ghost"}
                      className="justify-start gap-2"
                      onClick={() => navigate(item.href)}
                    >
                      <Icon className="w-4 h-4" />
                      {item.label}
                    </Button>
                  );
                })}

                {isSuperuser && (
                  <>
                    <div className="h-px bg-border my-2" />
                    <Button
                      variant="ghost"
                      className="justify-start gap-2"
                      onClick={() => navigate("/manager")}
                    >
                      <Building2 className="w-4 h-4" />
                      Manager
                    </Button>
                  </>
                )}

                {isAdmin ? (
                  <>
                    <div className="h-px bg-border my-2" />
                    <Button
                      variant="ghost"
                      className="justify-start gap-2"
                      onClick={() => navigate("/admin/settings")}
                    >
                      <Settings className="w-4 h-4" />
                      Admin Settings
                    </Button>
                  </>
                ) : isStaff ? (
                  <>
                    <div className="h-px bg-border my-2" />
                    <Button
                      variant="ghost"
                      className="justify-start gap-2"
                      onClick={() => navigate("/settings")}
                    >
                      <Settings className="w-4 h-4" />
                      My Settings
                    </Button>
                  </>
                ) : null}

              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="container mx-auto px-4 py-6">
          {children}
        </div>
      </main>

      {/* Floating Role Help Button */}
      {(isAdmin || isStaff) && (
        <Button
          variant="outline"
          size="icon"
          className="fixed bottom-4 right-4 rounded-full shadow-lg z-50 bg-background"
          onClick={() => setShowRoleHelp(true)}
        >
          <HelpCircle className="h-5 w-5" />
        </Button>
      )}

      {/* Role Help Modal */}
      <RoleHelpModal open={showRoleHelp} onOpenChange={setShowRoleHelp} />
    </div>
  );
}
