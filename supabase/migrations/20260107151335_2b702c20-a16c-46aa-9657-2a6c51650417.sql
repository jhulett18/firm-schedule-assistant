
-- Create calendar provider enum
CREATE TYPE public.calendar_provider AS ENUM ('google', 'microsoft');

-- Create calendar_connections table
CREATE TABLE public.calendar_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider public.calendar_provider NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  resource_email TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMP WITH TIME ZONE,
  scopes TEXT[],
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT unique_user_provider UNIQUE (user_id, provider),
  CONSTRAINT unique_resource_provider UNIQUE (resource_email, provider)
);

-- Enable RLS
ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;

-- Users can view their own connections
CREATE POLICY "Users can view own calendar connections"
ON public.calendar_connections
FOR SELECT
USING (user_id = get_current_user_internal_id() OR has_admin_role(auth.uid()));

-- Users can manage their own connections
CREATE POLICY "Users can manage own calendar connections"
ON public.calendar_connections
FOR ALL
USING (user_id = get_current_user_internal_id() OR has_admin_role(auth.uid()));

-- Admins can view all connections for availability lookups
CREATE POLICY "Admins can view all calendar connections"
ON public.calendar_connections
FOR SELECT
USING (has_admin_role(auth.uid()));

-- Add trigger for updated_at
CREATE TRIGGER update_calendar_connections_updated_at
BEFORE UPDATE ON public.calendar_connections
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for lookups
CREATE INDEX idx_calendar_connections_user ON public.calendar_connections(user_id);
CREATE INDEX idx_calendar_connections_resource ON public.calendar_connections(resource_email);
