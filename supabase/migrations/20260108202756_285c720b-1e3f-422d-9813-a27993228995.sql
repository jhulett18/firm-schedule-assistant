-- Add Lawmatics mapping columns to meeting_types and rooms
ALTER TABLE public.meeting_types
ADD COLUMN IF NOT EXISTS lawmatics_event_type_id TEXT;

ALTER TABLE public.rooms
ADD COLUMN IF NOT EXISTS lawmatics_location_id TEXT;

-- Add Lawmatics test result settings
INSERT INTO public.app_settings (key, value, description)
VALUES 
  ('lawmatics_last_test_at', '', 'Last time Lawmatics API was tested'),
  ('lawmatics_last_test_ok', '', 'Whether last Lawmatics API test succeeded'),
  ('lawmatics_last_test_error', '', 'Error from last Lawmatics API test')
ON CONFLICT (key) DO NOTHING;