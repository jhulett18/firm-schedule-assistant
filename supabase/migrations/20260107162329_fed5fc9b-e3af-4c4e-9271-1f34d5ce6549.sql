-- Create table for storing Lawmatics OAuth connection (firm-wide, single connection)
CREATE TABLE public.lawmatics_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token TEXT NOT NULL,
  connected_by_user_id UUID REFERENCES public.users(id),
  connected_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.lawmatics_connections ENABLE ROW LEVEL SECURITY;

-- Only admins can view and manage the Lawmatics connection
CREATE POLICY "Admins can manage lawmatics connections"
ON public.lawmatics_connections
FOR ALL
USING (has_admin_role(auth.uid()));

-- Create trigger for updated_at
CREATE TRIGGER update_lawmatics_connections_updated_at
BEFORE UPDATE ON public.lawmatics_connections
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();