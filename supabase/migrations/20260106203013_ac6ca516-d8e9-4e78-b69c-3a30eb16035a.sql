-- Create enum types
CREATE TYPE public.user_role AS ENUM ('Attorney', 'SupportStaff', 'Admin');
CREATE TYPE public.location_mode AS ENUM ('Zoom', 'InPerson');
CREATE TYPE public.in_person_location AS ENUM ('RoomA', 'RoomB', 'AttorneyOffice');
CREATE TYPE public.time_of_day_preference AS ENUM ('Morning', 'Midday', 'Afternoon', 'Evening', 'None');
CREATE TYPE public.meeting_status AS ENUM ('Draft', 'Proposed', 'Booked', 'Rescheduled', 'Cancelled', 'Failed');
CREATE TYPE public.audit_action AS ENUM ('Created', 'SuggestedSlots', 'Booked', 'Rescheduled', 'Cancelled', 'OverrideChange', 'SettingsChange', 'Failed');
CREATE TYPE public.allowed_location_modes AS ENUM ('Zoom', 'InPerson', 'Either');

-- Users (internal staff)
CREATE TABLE public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role user_role NOT NULL DEFAULT 'SupportStaff',
  active BOOLEAN NOT NULL DEFAULT true,
  timezone_default TEXT NOT NULL DEFAULT 'America/New_York',
  weekends_allowed_default BOOLEAN NOT NULL DEFAULT false,
  default_search_window_days INTEGER NOT NULL DEFAULT 30,
  max_search_window_days INTEGER NOT NULL DEFAULT 180,
  zoom_oauth_connected BOOLEAN NOT NULL DEFAULT false,
  zoom_user_id TEXT,
  zoom_access_token TEXT,
  zoom_refresh_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rooms (conference rooms)
CREATE TABLE public.rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  resource_email TEXT UNIQUE NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Meeting Types
CREATE TABLE public.meeting_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  allowed_location_modes allowed_location_modes NOT NULL DEFAULT 'Either',
  title_template TEXT NOT NULL DEFAULT '{Meeting Type} – {Client Last Name} – {Attorney Name}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pairing Presets
CREATE TABLE public.pairing_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  attorney_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  support_user_ids UUID[] NOT NULL DEFAULT '{}',
  meeting_type_id UUID REFERENCES public.meeting_types(id) ON DELETE SET NULL,
  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Meetings
CREATE TABLE public.meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  meeting_type_id UUID REFERENCES public.meeting_types(id) ON DELETE SET NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  host_attorney_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  support_user_ids UUID[] NOT NULL DEFAULT '{}',
  external_attendees JSONB NOT NULL DEFAULT '[]',
  location_mode location_mode NOT NULL DEFAULT 'Zoom',
  in_person_location_choice in_person_location,
  room_id UUID REFERENCES public.rooms(id) ON DELETE SET NULL,
  preferences JSONB NOT NULL DEFAULT '{}',
  search_window_days_used INTEGER NOT NULL DEFAULT 30,
  override_mode_used BOOLEAN NOT NULL DEFAULT false,
  status meeting_status NOT NULL DEFAULT 'Draft',
  m365_event_id TEXT,
  zoom_meeting_id TEXT,
  zoom_join_url TEXT,
  start_datetime TIMESTAMPTZ,
  end_datetime TIMESTAMPTZ,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  booking_request_id UUID UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit Log
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID REFERENCES public.meetings(id) ON DELETE CASCADE,
  action_type audit_action NOT NULL,
  actor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  details_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recent Pairings (auto-tracked)
CREATE TABLE public.recent_pairings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  attorney_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  support_user_ids UUID[] NOT NULL DEFAULT '{}',
  meeting_type_id UUID REFERENCES public.meeting_types(id) ON DELETE SET NULL,
  used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pairing_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recent_pairings ENABLE ROW LEVEL SECURITY;

-- User roles table for admin role management
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function for role checking
CREATE OR REPLACE FUNCTION public.has_admin_role(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = 'admin'
  )
$$;

-- Helper function to get current user's internal user id
CREATE OR REPLACE FUNCTION public.get_current_user_internal_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1
$$;

-- RLS Policies for users table
CREATE POLICY "Users can view all active users" ON public.users
  FOR SELECT TO authenticated
  USING (active = true OR auth_user_id = auth.uid());

CREATE POLICY "Admins can manage users" ON public.users
  FOR ALL TO authenticated
  USING (public.has_admin_role(auth.uid()));

-- RLS Policies for rooms
CREATE POLICY "Authenticated users can view active rooms" ON public.rooms
  FOR SELECT TO authenticated
  USING (active = true);

CREATE POLICY "Admins can manage rooms" ON public.rooms
  FOR ALL TO authenticated
  USING (public.has_admin_role(auth.uid()));

-- RLS Policies for meeting_types
CREATE POLICY "Authenticated users can view active meeting types" ON public.meeting_types
  FOR SELECT TO authenticated
  USING (active = true);

CREATE POLICY "Admins can manage meeting types" ON public.meeting_types
  FOR ALL TO authenticated
  USING (public.has_admin_role(auth.uid()));

-- RLS Policies for pairing_presets
CREATE POLICY "Authenticated users can view active presets" ON public.pairing_presets
  FOR SELECT TO authenticated
  USING (active = true);

CREATE POLICY "Admins can manage presets" ON public.pairing_presets
  FOR ALL TO authenticated
  USING (public.has_admin_role(auth.uid()));

-- RLS Policies for meetings
CREATE POLICY "Users can view meetings they created or are part of" ON public.meetings
  FOR SELECT TO authenticated
  USING (
    created_by_user_id = public.get_current_user_internal_id() OR
    host_attorney_user_id = public.get_current_user_internal_id() OR
    public.get_current_user_internal_id() = ANY(support_user_ids) OR
    public.has_admin_role(auth.uid())
  );

CREATE POLICY "Authenticated users can create meetings" ON public.meetings
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update their meetings" ON public.meetings
  FOR UPDATE TO authenticated
  USING (
    created_by_user_id = public.get_current_user_internal_id() OR
    public.has_admin_role(auth.uid())
  );

-- RLS Policies for audit_logs
CREATE POLICY "Users can view audit logs for meetings they can see" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.meetings m
      WHERE m.id = audit_logs.meeting_id
      AND (
        m.created_by_user_id = public.get_current_user_internal_id() OR
        m.host_attorney_user_id = public.get_current_user_internal_id() OR
        public.get_current_user_internal_id() = ANY(m.support_user_ids) OR
        public.has_admin_role(auth.uid())
      )
    )
  );

CREATE POLICY "Authenticated users can create audit logs" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- RLS Policies for recent_pairings
CREATE POLICY "Users can view their recent pairings" ON public.recent_pairings
  FOR SELECT TO authenticated
  USING (user_id = public.get_current_user_internal_id());

CREATE POLICY "Users can create recent pairings" ON public.recent_pairings
  FOR INSERT TO authenticated
  WITH CHECK (user_id = public.get_current_user_internal_id());

-- RLS Policies for user_roles
CREATE POLICY "Admins can manage user roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_admin_role(auth.uid()));

CREATE POLICY "Users can view their own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Updated at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Apply updated_at triggers
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_rooms_updated_at BEFORE UPDATE ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_meeting_types_updated_at BEFORE UPDATE ON public.meeting_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_pairing_presets_updated_at BEFORE UPDATE ON public.pairing_presets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_meetings_updated_at BEFORE UPDATE ON public.meetings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default meeting types
INSERT INTO public.meeting_types (name, allowed_location_modes) VALUES
  ('Initial Consultation', 'Either'),
  ('Case Review', 'Either'),
  ('Document Signing', 'InPerson'),
  ('Follow-up Call', 'Zoom');

-- Insert default rooms
INSERT INTO public.rooms (name, resource_email) VALUES
  ('Conference Room A', 'conf-room-a@lawfirm.com'),
  ('Conference Room B', 'conf-room-b@lawfirm.com');