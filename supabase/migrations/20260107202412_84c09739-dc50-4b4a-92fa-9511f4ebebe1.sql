-- Add client_email column and RLS for clients

-- 1. Add client_email column to meetings if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'meetings' 
    AND column_name = 'client_email'
  ) THEN
    ALTER TABLE public.meetings ADD COLUMN client_email TEXT;
  END IF;
END $$;

-- 2. Create index for efficient lookups by client_email
CREATE INDEX IF NOT EXISTS idx_meetings_client_email ON public.meetings(client_email);

-- 3. Add RLS policy for clients to view their own meetings
-- First drop if exists to avoid conflicts
DROP POLICY IF EXISTS "Clients can view meetings where they are the client" ON public.meetings;

CREATE POLICY "Clients can view meetings where they are the client"
ON public.meetings
FOR SELECT
USING (
  -- Match by client_email column
  client_email = (SELECT email FROM auth.users WHERE id = auth.uid())
  -- Or match by email in external_attendees JSON array
  OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(external_attendees) AS ea
    WHERE ea->>'email' = (SELECT email FROM auth.users WHERE id = auth.uid())
  )
);