-- Create app_settings table for feature flags and configuration
CREATE TABLE public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Only admins can manage settings
CREATE POLICY "Admins can manage app settings" 
ON public.app_settings 
FOR ALL 
USING (has_admin_role(auth.uid()));

-- Authenticated users can view settings
CREATE POLICY "Authenticated users can view app settings" 
ON public.app_settings 
FOR SELECT 
USING (auth.role() = 'authenticated');

-- Insert the room_reservation_mode feature flag with default value
INSERT INTO public.app_settings (key, value, description) VALUES
  ('room_reservation_mode', 'LawmaticsSync', 'Room reservation mode: LawmaticsSync (default) or DirectCalendar');