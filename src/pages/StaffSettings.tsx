import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GoogleCalendarConnections } from "@/components/admin/GoogleCalendarConnections";
import { Calendar } from "lucide-react";

export default function StaffSettings() {
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

        {/* Placeholder for future sections */}
        {/* 
        <Card>
          <CardHeader>
            <CardTitle>Notification Preferences</CardTitle>
            <CardDescription>Configure how you receive notifications</CardDescription>
          </CardHeader>
          <CardContent>
            Coming soon...
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Availability Settings</CardTitle>
            <CardDescription>Set your default working hours</CardDescription>
          </CardHeader>
          <CardContent>
            Coming soon...
          </CardContent>
        </Card>
        */}
      </div>
    </MainLayout>
  );
}
