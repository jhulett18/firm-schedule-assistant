-- Create table to track Google Calendar events per participant
-- This allows idempotent creation of events on each participant's calendar

CREATE TABLE public.meeting_google_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  google_calendar_id TEXT NOT NULL,
  google_event_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Ensure one event per meeting per user
  CONSTRAINT meeting_google_events_unique_per_user UNIQUE (meeting_id, user_id)
);

-- Enable RLS
ALTER TABLE public.meeting_google_events ENABLE ROW LEVEL SECURITY;

-- Staff can view events for meetings they are part of
CREATE POLICY "Users can view google events for their meetings"
ON public.meeting_google_events
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM meetings m
    WHERE m.id = meeting_google_events.meeting_id
    AND (
      m.created_by_user_id = get_current_user_internal_id()
      OR m.host_attorney_user_id = get_current_user_internal_id()
      OR get_current_user_internal_id() = ANY(m.participant_user_ids)
      OR has_admin_role(auth.uid())
    )
  )
);

-- Only service role / edge functions can insert (no direct user inserts)
-- This ensures events are only created through the booking flow

-- Add index for faster lookups
CREATE INDEX idx_meeting_google_events_meeting_id ON public.meeting_google_events(meeting_id);
CREATE INDEX idx_meeting_google_events_user_id ON public.meeting_google_events(user_id);