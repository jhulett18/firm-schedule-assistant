-- Create notification_type enum
CREATE TYPE public.notification_type AS ENUM ('meeting_cancelled', 'meeting_rescheduled', 'booking_completed', 'system');

-- Create notifications table
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type public.notification_type NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  meeting_id UUID REFERENCES public.meetings(id) ON DELETE SET NULL,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast queries by user
CREATE INDEX idx_notifications_user_read ON public.notifications(user_id, read, created_at DESC);

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- RLS: Users can view their own notifications
CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT
  USING (
    user_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
    OR has_admin_role(auth.uid())
  );

-- RLS: Users can update (mark as read) their own notifications
CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE
  USING (user_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid()));

-- Enable realtime for live notification updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;