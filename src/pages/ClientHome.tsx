import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  Scale, 
  Calendar, 
  Clock, 
  MapPin, 
  Video, 
  Building2,
  Link as LinkIcon, 
  HelpCircle, 
  ChevronDown, 
  ChevronRight,
  Mail,
  LogOut,
  ArrowRight
} from 'lucide-react';
import { format } from 'date-fns';

interface Meeting {
  id: string;
  start_datetime: string | null;
  end_datetime: string | null;
  duration_minutes: number;
  location_mode: 'Zoom' | 'InPerson';
  status: string;
  meeting_type: {
    name: string;
  } | null;
  booking_request: {
    public_token: string;
  } | null;
}

export default function ClientHome() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [scheduleLink, setScheduleLink] = useState('');
  const [faqOpen, setFaqOpen] = useState(false);

  // Fetch meetings where client_email matches or email in external_attendees
  const { data: meetings, isLoading } = useQuery({
    queryKey: ['client-meetings', user?.email],
    queryFn: async () => {
      if (!user?.email) return [];
      
      const { data, error } = await supabase
        .from('meetings')
        .select(`
          id,
          start_datetime,
          end_datetime,
          duration_minutes,
          location_mode,
          status,
          meeting_type:meeting_types(name),
          booking_request:booking_requests(public_token)
        `)
        .order('start_datetime', { ascending: true });

      if (error) {
        console.error('Error fetching client meetings:', error);
        return [];
      }

      return (data || []) as unknown as Meeting[];
    },
    enabled: !!user?.email,
  });

  const handleOpenScheduleLink = () => {
    if (!scheduleLink.trim()) return;
    
    // Extract token from link or use as-is if it's just a token
    let token = scheduleLink.trim();
    
    // Check if it's a full URL
    if (token.includes('/r/')) {
      const match = token.match(/\/r\/([a-zA-Z0-9]+)/);
      if (match) {
        token = match[1];
      }
    }
    
    // Navigate to the booking page
    navigate(`/r/${token}`);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  // Separate upcoming vs past/cancelled
  const upcomingMeetings = meetings?.filter(m => 
    m.status === 'Booked' && m.start_datetime && new Date(m.start_datetime) > new Date()
  ) || [];
  
  const pendingMeetings = meetings?.filter(m => 
    m.status === 'Proposed' || m.status === 'Draft'
  ) || [];

  const hasAppointments = upcomingMeetings.length > 0 || pendingMeetings.length > 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center">
              <Scale className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-serif font-semibold">LawScheduler</span>
          </div>
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </header>

      <main className="container max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Welcome */}
        <div>
          <h1 className="text-2xl font-serif font-semibold">Welcome back</h1>
          <p className="text-muted-foreground">{user?.email}</p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-pulse text-muted-foreground">Loading your appointments...</div>
          </div>
        ) : !hasAppointments ? (
          /* Empty State */
          <div className="space-y-6">
            {/* Guided Help Panel */}
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-muted-foreground" />
                  You don't have any appointments scheduled yet
                </CardTitle>
                <CardDescription>
                  Here's how to book your appointment:
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ol className="space-y-3">
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium">1</span>
                    <div>
                      <p className="font-medium">Check your email or text</p>
                      <p className="text-sm text-muted-foreground">Look for a scheduling link from our office</p>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium">2</span>
                    <div>
                      <p className="font-medium">Open the link and choose a time</p>
                      <p className="text-sm text-muted-foreground">Select a date and time that works for you</p>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium">3</span>
                    <div>
                      <p className="font-medium">Your appointment will appear here</p>
                      <p className="text-sm text-muted-foreground">You'll see all the details once it's confirmed</p>
                    </div>
                  </li>
                </ol>
              </CardContent>
            </Card>

            {/* Paste Link Helper */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <LinkIcon className="w-5 h-5 text-muted-foreground" />
                  Have a scheduling link?
                </CardTitle>
                <CardDescription>
                  Paste your scheduling link below to open it
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input
                    placeholder="Paste your link here..."
                    value={scheduleLink}
                    onChange={(e) => setScheduleLink(e.target.value)}
                    className="flex-1"
                  />
                  <Button onClick={handleOpenScheduleLink} disabled={!scheduleLink.trim()}>
                    Open
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* FAQ */}
            <Collapsible open={faqOpen} onOpenChange={setFaqOpen}>
              <Card>
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                    <CardTitle className="text-lg flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <HelpCircle className="w-5 h-5 text-muted-foreground" />
                        Need help?
                      </span>
                      {faqOpen ? (
                        <ChevronDown className="w-5 h-5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-muted-foreground" />
                      )}
                    </CardTitle>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-4">
                    <div>
                      <h4 className="font-medium">What if I can't find the scheduling link?</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        Check your spam folder, or contact our office directly. The link would have been sent from our scheduling system.
                      </p>
                    </div>
                    <div>
                      <h4 className="font-medium">What if none of the available times work for me?</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        Contact our office and we'll work with you to find an alternative time that fits your schedule.
                      </p>
                    </div>
                    <div>
                      <h4 className="font-medium">Will I get confirmation details?</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        Yes! Once you book, you'll receive an email confirmation with all the meeting details, including any video call links.
                      </p>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </div>
        ) : (
          /* Has Appointments */
          <div className="space-y-6">
            {/* Pending/Proposed Meetings */}
            {pendingMeetings.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Clock className="w-5 h-5 text-amber-500" />
                  Scheduling in Progress
                </h2>
                <div className="space-y-3">
                  {pendingMeetings.map((meeting) => (
                    <Card key={meeting.id} className="border-amber-200 bg-amber-50/50">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{meeting.meeting_type?.name || 'Meeting'}</p>
                            <p className="text-sm text-muted-foreground">Still deciding on a time?</p>
                          </div>
                          {meeting.booking_request?.public_token && (
                            <Button 
                              size="sm"
                              onClick={() => navigate(`/r/${meeting.booking_request!.public_token}`)}
                            >
                              Continue Booking
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Upcoming Appointments */}
            {upcomingMeetings.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-primary" />
                  Upcoming Appointments
                </h2>
                <div className="space-y-3">
                  {upcomingMeetings.map((meeting) => (
                    <Card key={meeting.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <p className="font-medium">{meeting.meeting_type?.name || 'Meeting'}</p>
                              <Badge variant="secondary">{meeting.status}</Badge>
                            </div>
                            
                            {meeting.start_datetime && (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Calendar className="w-4 h-4" />
                                {format(new Date(meeting.start_datetime), 'EEEE, MMMM d, yyyy')}
                              </div>
                            )}
                            
                            {meeting.start_datetime && (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Clock className="w-4 h-4" />
                                {format(new Date(meeting.start_datetime), 'h:mm a')} ({meeting.duration_minutes} min)
                              </div>
                            )}
                            
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              {meeting.location_mode === 'Zoom' ? (
                                <>
                                  <Video className="w-4 h-4" />
                                  Video Call (Zoom)
                                </>
                              ) : (
                                <>
                                  <Building2 className="w-4 h-4" />
                                  In Person
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Paste Link Helper - also available when they have appointments */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <LinkIcon className="w-4 h-4 text-muted-foreground" />
                  Have another scheduling link?
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input
                    placeholder="Paste your link here..."
                    value={scheduleLink}
                    onChange={(e) => setScheduleLink(e.target.value)}
                    className="flex-1"
                    size={1}
                  />
                  <Button onClick={handleOpenScheduleLink} disabled={!scheduleLink.trim()} size="sm">
                    Open
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
