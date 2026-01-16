import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Scale, Clock, LogOut } from 'lucide-react';
import Footer from '@/components/layout/Footer';

export default function PendingApproval() {
  const { signOut, internalUser } = useAuth();

  return (
    <div className="min-h-screen flex flex-col gradient-subtle">
      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-floating animate-fade-in">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto w-14 h-14 rounded-xl gradient-primary flex items-center justify-center mb-2">
              <Scale className="w-7 h-7 text-primary-foreground" />
            </div>
            <CardTitle className="text-2xl font-serif">LawScheduler</CardTitle>
            <CardDescription>Account Pending Approval</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <Clock className="w-8 h-8 text-amber-600 dark:text-amber-400" />
              </div>
            </div>

            <div className="text-center space-y-2">
              <h2 className="text-lg font-medium">Your account is pending approval</h2>
              <p className="text-sm text-muted-foreground">
                An administrator will review your request shortly. You'll be able to access the system once your account has been approved.
              </p>
            </div>

            {internalUser?.email && (
              <div className="text-center text-sm text-muted-foreground">
                Signed in as <strong>{internalUser.email}</strong>
              </div>
            )}

            <Button
              variant="outline"
              className="w-full"
              onClick={() => signOut()}
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>
      <Footer />
    </div>
  );
}
