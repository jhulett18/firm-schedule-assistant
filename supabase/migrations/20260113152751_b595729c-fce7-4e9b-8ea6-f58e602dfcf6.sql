-- Add Lawmatics contact and matter tracking columns to meetings table
ALTER TABLE public.meetings 
ADD COLUMN IF NOT EXISTS lawmatics_contact_id text NULL,
ADD COLUMN IF NOT EXISTS lawmatics_matter_id text NULL;

-- Add comments for documentation
COMMENT ON COLUMN public.meetings.lawmatics_contact_id IS 'Lawmatics contact ID for the client who booked';
COMMENT ON COLUMN public.meetings.lawmatics_matter_id IS 'Lawmatics matter ID created for this booking';