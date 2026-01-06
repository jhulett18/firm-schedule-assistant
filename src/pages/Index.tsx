import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { ChatProvider } from '@/contexts/ChatContext';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { Button } from '@/components/ui/button';
import { Scale, Settings, LogOut, Menu, Calendar } from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

export default function Index() {
  const { user, internalUser, isAdmin, isLoading, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && !user) {
      navigate('/auth');
    }
  }, [user, isLoading, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse-soft text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <ChatProvider>
      <div className="min-h-screen flex flex-col bg-background">
        {/* Header */}
        <header className="flex-shrink-0 h-14 border-b bg-card flex items-center justify-between px-4 shadow-subtle">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center">
              <Scale className="w-4 h-4 text-primary-foreground" />
            </div>
            <h1 className="font-serif text-lg font-semibold hidden sm:block">LawScheduler</h1>
          </div>

          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button variant="ghost" size="sm" onClick={() => navigate('/admin')} className="hidden sm:flex">
                <Settings className="w-4 h-4 mr-2" />
                Admin
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => navigate('/meetings')} className="hidden sm:flex">
              <Calendar className="w-4 h-4 mr-2" />
              Meetings
            </Button>
            
            {/* Mobile menu */}
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="sm:hidden">
                  <Menu className="w-5 h-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-64">
                <div className="flex flex-col gap-2 mt-6">
                  <div className="px-2 py-3 border-b mb-2">
                    <p className="font-medium">{internalUser?.name || 'User'}</p>
                    <p className="text-sm text-muted-foreground">{internalUser?.email}</p>
                  </div>
                  <Button variant="ghost" className="justify-start" onClick={() => navigate('/meetings')}>
                    <Calendar className="w-4 h-4 mr-2" />
                    Meetings
                  </Button>
                  {isAdmin && (
                    <Button variant="ghost" className="justify-start" onClick={() => navigate('/admin')}>
                      <Settings className="w-4 h-4 mr-2" />
                      Admin
                    </Button>
                  )}
                  <Button variant="ghost" className="justify-start text-destructive" onClick={signOut}>
                    <LogOut className="w-4 h-4 mr-2" />
                    Sign Out
                  </Button>
                </div>
              </SheetContent>
            </Sheet>

            <Button variant="ghost" size="icon" onClick={signOut} className="hidden sm:flex">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </header>

        {/* Chat area */}
        <main className="flex-1 overflow-hidden">
          <ChatContainer />
        </main>
      </div>
    </ChatProvider>
  );
}
