
-- Create scheduler_mappings table
CREATE TABLE public.scheduler_mappings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_type_id UUID REFERENCES public.meeting_types(id) ON DELETE CASCADE NOT NULL,
  duration_minutes INTEGER NOT NULL,
  host_attorney_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  location_mode public.location_mode NOT NULL,
  room_id UUID REFERENCES public.rooms(id) ON DELETE SET NULL,
  lawmatics_scheduler_id TEXT,
  booking_link_template TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(meeting_type_id, duration_minutes, host_attorney_user_id, location_mode, room_id)
);

-- Enable RLS
ALTER TABLE public.scheduler_mappings ENABLE ROW LEVEL SECURITY;

-- Admins can manage scheduler mappings
CREATE POLICY "Admins can manage scheduler mappings"
ON public.scheduler_mappings
FOR ALL
USING (has_admin_role(auth.uid()));

-- Authenticated users can view active scheduler mappings
CREATE POLICY "Authenticated users can view active scheduler mappings"
ON public.scheduler_mappings
FOR SELECT
USING (active = true);

-- Add trigger for updated_at
CREATE TRIGGER update_scheduler_mappings_updated_at
BEFORE UPDATE ON public.scheduler_mappings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
