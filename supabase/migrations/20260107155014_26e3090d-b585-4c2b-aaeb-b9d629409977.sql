-- Add lawmatics_appointment_id column to meetings
ALTER TABLE public.meetings 
ADD COLUMN lawmatics_appointment_id TEXT;

-- Create index for lookups
CREATE INDEX idx_meetings_lawmatics_id ON public.meetings(lawmatics_appointment_id) WHERE lawmatics_appointment_id IS NOT NULL;