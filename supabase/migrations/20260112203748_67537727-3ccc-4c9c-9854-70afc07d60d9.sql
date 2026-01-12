-- Add google_calendar_id column to meetings table to store the admin-selected calendar
ALTER TABLE public.meetings 
ADD COLUMN IF NOT EXISTS google_calendar_id text NULL;

-- Add comment explaining the column
COMMENT ON COLUMN public.meetings.google_calendar_id IS 'The Google Calendar ID selected by the admin when creating the booking request. Used to create calendar events on this specific calendar.';

-- Update the meetings INSERT RLS policy to allow setting created_by_user_id to the current internal user id
-- First, drop the existing policy and recreate with updated logic
DROP POLICY IF EXISTS "Users can create meetings" ON public.meetings;

CREATE POLICY "Users can create meetings"
ON public.meetings
FOR INSERT
TO authenticated
WITH CHECK (
  -- Allow insert if created_by_user_id is either null OR matches the current internal user id
  (created_by_user_id IS NULL OR created_by_user_id = public.get_current_user_internal_id())
);