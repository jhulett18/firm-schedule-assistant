import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GoogleCalendarConnections } from "@/components/admin/GoogleCalendarConnections";
import { DeleteAccountDialog } from "@/components/account/DeleteAccountDialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { Calendar, LogOut, Trash2 } from "lucide-react";

export default function StaffSettings() {
  const { signOut } = useAuth();

  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Settings</h1>
          <p className="text-muted-foreground">
            Manage your personal settings and integrations
          </p>
        </div>

        {/* Google Calendar Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Google Calendar
            </CardTitle>
            <CardDescription>
              Connect your calendar for availability checking when scheduling meetings
            </CardDescription>
          </CardHeader>
          <CardContent>
            <GoogleCalendarConnections />
          </CardContent>
        </Card>

        {/* Account Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>
              Manage your account and session
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                variant="outline"
                onClick={signOut}
                className="gap-2"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </Button>
              
              <DeleteAccountDialog
                trigger={
                  <Button variant="outline" className="gap-2 text-destructive hover:text-destructive border-destructive/50 hover:border-destructive hover:bg-destructive/10">
                    <Trash2 className="w-4 h-4" />
                    Delete My Account
                  </Button>
                }
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
