-- Create table for caching Lawmatics reference data
CREATE TABLE IF NOT EXISTS public.lawmatics_reference_data (
  key TEXT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.lawmatics_reference_data ENABLE ROW LEVEL SECURITY;

-- Only admins can manage this data
CREATE POLICY "Admins can manage lawmatics reference data"
ON public.lawmatics_reference_data
FOR ALL
USING (has_admin_role(auth.uid()));