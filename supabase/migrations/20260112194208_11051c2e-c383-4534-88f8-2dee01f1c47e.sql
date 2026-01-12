
-- The SELECT policy "Clients can view meetings..." uses a subquery to auth.users
-- This gets evaluated even during INSERT when ?select=id is used
-- Fix: use auth.jwt() ->> 'email' instead of querying auth.users

DROP POLICY IF EXISTS "Clients can view meetings where they are the client" ON public.meetings;

CREATE POLICY "Clients can view meetings where they are the client"
ON public.meetings
FOR SELECT
TO authenticated
USING (
  (client_email = (auth.jwt() ->> 'email'))
  OR 
  (EXISTS (
    SELECT 1
    FROM jsonb_array_elements(meetings.external_attendees) ea(value)
    WHERE (ea.value ->> 'email') = (auth.jwt() ->> 'email')
  ))
);
