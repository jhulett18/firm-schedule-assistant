import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Scale, 
  Calendar, 
  Clock, 
  Video, 
  Building2,
  Link as LinkIcon, 
  HelpCircle, 
  ChevronDown, 
  ChevronRight,
  LogOut,
  ArrowRight,
  CalendarCheck,
  MousePointerClick,
  CheckCircle2
} from 'lucide-react';
import { format } from 'date-fns';

const ACTIVE_BOOKING_TOKEN_KEY = 'ACTIVE_BOOKING_TOKEN';

interface MeetingSummary {
  meetingTypeName: string;
  durationMinutes: number;
  locationMode: "Zoom" | "InPerson";
  timezone: string;
  startDatetime?: string;
  endDatetime?: string;
}

interface BookingInfo {
  state: "needs_scheduling" | "already_booked" | "expired" | "cancelled" | "error";
  meeting?: MeetingSummary;
  contact?: {
    phone?: string;
    email?: string;
    message?: string;
  };
}

export default function ClientHome() {
  const { user, signOut, isClient } = useAuth();
  const navigate = useNavigate();
  const [scheduleLink, setScheduleLink] = useState('');
  const [faqOpen, setFaqOpen] = useState(false);
  
  // Token-based booking state
  const [activeToken, setActiveToken] = useState<string | null>(null);
  const [bookingInfo, setBookingInfo] = useState<BookingInfo | null>(null);
  const [isLoadingBooking, setIsLoadingBooking] = useState(true);

  // Check for stored token and fetch booking info
  useEffect(() => {
    const storedToken = localStorage.getItem(ACTIVE_BOOKING_TOKEN_KEY);
    setActiveToken(storedToken);
    
    if (storedToken) {
      fetchBookingInfo(storedToken);
    } else {
      setIsLoadingBooking(false);
    }
  }, []);

  const fetchBookingInfo = async (token: string) => {
    setIsLoadingBooking(true);
    try {
      const { data, error } = await supabase.functions.invoke("public-booking-info", {
        body: { token },
      });

      if (error || data?.error) {
        console.error("Error fetching booking info:", error || data?.error);
        // Token might be invalid - clear it
        localStorage.removeItem(ACTIVE_BOOKING_TOKEN_KEY);
        setActiveToken(null);
        setBookingInfo(null);
      } else {
        setBookingInfo(data);
      }
    } catch (err) {
      console.error("Error in fetchBookingInfo:", err);
      localStorage.removeItem(ACTIVE_BOOKING_TOKEN_KEY);
      setActiveToken(null);
      setBookingInfo(null);
    } finally {
      setIsLoadingBooking(false);
    }
  };

  const extractToken = (input: string): string | null => {
    const trimmed = input.trim();
    if (!trimmed) return null;
    
    const urlMatch = trimmed.match(/\/r\/([a-zA-Z0-9_-]+)/i);
    if (urlMatch) {
      return urlMatch[1];
    }
    
    if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
      return trimmed;
    }
    
    return null;
  };

  const handleOpenScheduleLink = () => {
    const token = extractToken(scheduleLink);
    if (!token) return;
    
    localStorage.setItem(ACTIVE_BOOKING_TOKEN_KEY, token);
    setActiveToken(token);
    setScheduleLink('');
    fetchBookingInfo(token);
  };

  const handleChooseTime = () => {
    navigate('/schedule');
  };

  const handleClearToken = () => {
    localStorage.removeItem(ACTIVE_BOOKING_TOKEN_KEY);
    setActiveToken(null);
    setBookingInfo(null);
  };

  const handleSignOut = async () => {
    handleClearToken();
    await signOut();
    navigate('/auth');
  };

  const getLocationDisplay = (locationMode: string) => {
    return locationMode === "Zoom" ? "Video Call (Zoom)" : "In Person";
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Scale className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-serif font-semibold">LawScheduler</span>
          </div>
          {user && isClient && (
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          )}
        </div>
      </header>

      <main className="container max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Welcome */}
        <div>
          <h1 className="text-2xl font-serif font-semibold">
            {user ? 'Welcome back' : 'Schedule Your Appointment'}
          </h1>
          {user && <p className="text-muted-foreground">{user.email}</p>}
        </div>

        {isLoadingBooking ? (
          <div className="space-y-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : activeToken && bookingInfo ? (
          /* Has Active Token */
          <div className="space-y-6">
            {bookingInfo.state === "already_booked" && bookingInfo.meeting ? (
              /* Already Booked State */
              <Card className="border-green-200 bg-green-50/50">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2 text-green-700">
                    <CheckCircle2 className="w-5 h-5" />
                    Your Appointment is Confirmed
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    {bookingInfo.meeting.startDatetime && (
                      <span>{format(new Date(bookingInfo.meeting.startDatetime), 'EEEE, MMMM d, yyyy')}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    {bookingInfo.meeting.startDatetime && (
                      <span>
                        {format(new Date(bookingInfo.meeting.startDatetime), 'h:mm a')} ({bookingInfo.meeting.durationMinutes} min)
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    {bookingInfo.meeting.locationMode === 'Zoom' ? (
                      <Video className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <Building2 className="w-4 h-4 text-muted-foreground" />
                    )}
                    <span>{getLocationDisplay(bookingInfo.meeting.locationMode)}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">
                    {bookingInfo.meeting.meetingTypeName}
                  </p>
                </CardContent>
              </Card>
            ) : bookingInfo.state === "needs_scheduling" && bookingInfo.meeting ? (
              /* Needs Scheduling State */
              <>
                {/* Guided Help Panel */}
                <Card className="border-primary/20 bg-primary/5">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg text-primary flex items-center gap-2">
                      <CalendarCheck className="h-5 w-5" />
                      You don't have an appointment scheduled yet
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Follow these simple steps to schedule your meeting:
                    </p>
                    
                    <div className="space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">
                          1
                        </div>
                        <div className="flex items-center gap-2">
                          <CalendarCheck className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">Choose a day</span>
                        </div>
                      </div>
                      
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">
                          2
                        </div>
                        <div className="flex items-center gap-2">
                          <MousePointerClick className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">Pick a time that works for you</span>
                        </div>
                      </div>
                      
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">
                          3
                        </div>
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">Confirm — we'll send details right after</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Meeting Summary Card */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">{bookingInfo.meeting.meetingTypeName}</CardTitle>
                    <CardDescription>Your meeting details</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <span>{bookingInfo.meeting.durationMinutes} minutes</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {bookingInfo.meeting.locationMode === 'Zoom' ? (
                        <Video className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <Building2 className="w-4 h-4 text-muted-foreground" />
                      )}
                      <span>{getLocationDisplay(bookingInfo.meeting.locationMode)}</span>
                    </div>
                    
                    <Button onClick={handleChooseTime} className="w-full mt-4">
                      Choose a Time
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </CardContent>
                </Card>
              </>
            ) : (
              /* Expired/Cancelled/Error State */
              <Card className="border-amber-200 bg-amber-50/50">
                <CardHeader>
                  <CardTitle className="text-lg text-amber-700">
                    {bookingInfo.state === "expired" && "Scheduling Link Expired"}
                    {bookingInfo.state === "cancelled" && "Appointment Cancelled"}
                    {bookingInfo.state === "error" && "Something went wrong"}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    {bookingInfo.state === "expired" && "This scheduling link has expired. Please contact our office for a new link."}
                    {bookingInfo.state === "cancelled" && "This appointment has been cancelled. Please contact our office if you need to reschedule."}
                    {bookingInfo.state === "error" && "We couldn't load your booking information. Please try again or contact our office."}
                  </p>
                  <Button variant="outline" onClick={handleClearToken}>
                    Enter a different code
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Use Different Code */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <LinkIcon className="w-4 h-4 text-muted-foreground" />
                  Have a different scheduling code?
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input
                    placeholder="Paste your link or code here..."
                    value={scheduleLink}
                    onChange={(e) => setScheduleLink(e.target.value)}
                    className="flex-1"
                  />
                  <Button onClick={handleOpenScheduleLink} disabled={!scheduleLink.trim()} size="sm">
                    Use This
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          /* No Token - Empty State */
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
                      <p className="font-medium">Enter your scheduling code</p>
                      <p className="text-sm text-muted-foreground">Use the code or link from our office</p>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium">2</span>
                    <div>
                      <p className="font-medium">Choose a time that works for you</p>
                      <p className="text-sm text-muted-foreground">Select from available time slots</p>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium">3</span>
                    <div>
                      <p className="font-medium">Confirm and you're all set</p>
                      <p className="text-sm text-muted-foreground">You'll receive confirmation details right after</p>
                    </div>
                  </li>
                </ol>

                <Button onClick={() => navigate('/access')} className="w-full">
                  Enter Scheduling Code
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </CardContent>
            </Card>

            {/* Paste Link Helper */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <LinkIcon className="w-5 h-5 text-muted-foreground" />
                  Have a scheduling link or code?
                </CardTitle>
                <CardDescription>
                  Paste it below to get started
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input
                    placeholder="Paste your link or code here..."
                    value={scheduleLink}
                    onChange={(e) => setScheduleLink(e.target.value)}
                    className="flex-1"
                  />
                  <Button onClick={handleOpenScheduleLink} disabled={!scheduleLink.trim()}>
                    Continue
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
                      <h4 className="font-medium">Where do I find my scheduling code?</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        Check your email or text messages. We sent you a link that looks like lawscheduler.com/r/ABC123. You can paste the full link or just the code at the end.
                      </p>
                    </div>
                    <div>
                      <h4 className="font-medium">What if I can't find the link?</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        Check your spam folder, or contact our office directly. We can send you a new scheduling link.
                      </p>
                    </div>
                    <div>
                      <h4 className="font-medium">What if none of the available times work?</h4>
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
        )}
      </main>
    </div>
  );
}
