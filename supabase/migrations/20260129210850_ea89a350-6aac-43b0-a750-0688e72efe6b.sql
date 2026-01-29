-- Add calendar_provider column to meetings table
-- This allows users to choose between Google Calendar and Microsoft Outlook for event creation
ALTER TABLE public.meetings 
ADD COLUMN calendar_provider public.calendar_provider NULL;

-- Create a table to track Microsoft calendar events per meeting/user (similar to meeting_google_events)
CREATE TABLE public.meeting_microsoft_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  microsoft_calendar_id TEXT NOT NULL,
  microsoft_event_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(meeting_id, user_id)
);

-- Enable RLS on meeting_microsoft_events
ALTER TABLE public.meeting_microsoft_events ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for viewing microsoft events (same pattern as meeting_google_events)
CREATE POLICY "Users can view microsoft events for their meetings" 
ON public.meeting_microsoft_events 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM meetings m
    WHERE m.id = meeting_microsoft_events.meeting_id
    AND (
      m.created_by_user_id = get_current_user_internal_id()
      OR m.host_attorney_user_id = get_current_user_internal_id()
      OR get_current_user_internal_id() = ANY(m.participant_user_ids)
      OR has_admin_role(auth.uid())
    )
  )
);

-- Add index for efficient lookups
CREATE INDEX idx_meeting_microsoft_events_meeting_id ON public.meeting_microsoft_events(meeting_id);
CREATE INDEX idx_meetings_calendar_provider ON public.meetings(calendar_provider);