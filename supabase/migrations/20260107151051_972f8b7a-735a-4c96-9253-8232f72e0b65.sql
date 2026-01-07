
-- Create booking request status enum
CREATE TYPE public.booking_request_status AS ENUM ('Open', 'Completed', 'Expired');

-- Create booking_requests table
CREATE TABLE public.booking_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id UUID REFERENCES public.meetings(id) ON DELETE CASCADE NOT NULL,
  public_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  status public.booking_request_status NOT NULL DEFAULT 'Open',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.booking_requests ENABLE ROW LEVEL SECURITY;

-- Allow public read access by token (for the public scheduling page)
CREATE POLICY "Public can view booking requests by token"
ON public.booking_requests
FOR SELECT
USING (true);

-- Authenticated users who created the meeting can manage booking requests
CREATE POLICY "Meeting creators can manage booking requests"
ON public.booking_requests
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.meetings m
    WHERE m.id = booking_requests.meeting_id
    AND (m.created_by_user_id = get_current_user_internal_id() OR has_admin_role(auth.uid()))
  )
);

-- Create index for token lookups
CREATE INDEX idx_booking_requests_token ON public.booking_requests(public_token);
CREATE INDEX idx_booking_requests_meeting ON public.booking_requests(meeting_id);
