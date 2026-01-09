-- Create booking_progress_logs table for test booking progress tracking
CREATE TABLE public.booking_progress_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id uuid REFERENCES public.meetings(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  level text NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warn', 'error', 'success')),
  step text NOT NULL,
  message text NOT NULL,
  details_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create index for efficient queries by meeting + run_id
CREATE INDEX idx_booking_progress_logs_meeting_run ON public.booking_progress_logs(meeting_id, run_id);
CREATE INDEX idx_booking_progress_logs_created_at ON public.booking_progress_logs(created_at);

-- Enable RLS
ALTER TABLE public.booking_progress_logs ENABLE ROW LEVEL SECURITY;

-- RLS: Admin/staff can read logs for meetings they have access to
CREATE POLICY "Users can view progress logs for accessible meetings"
ON public.booking_progress_logs
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM meetings m
    WHERE m.id = booking_progress_logs.meeting_id
    AND (
      m.created_by_user_id = get_current_user_internal_id()
      OR m.host_attorney_user_id = get_current_user_internal_id()
      OR get_current_user_internal_id() = ANY(m.support_user_ids)
      OR has_admin_role(auth.uid())
    )
  )
);

-- RLS: Only service role can insert (edge functions)
-- No insert policy needed as service role bypasses RLS

-- Enable realtime for live log streaming
ALTER PUBLICATION supabase_realtime ADD TABLE public.booking_progress_logs;