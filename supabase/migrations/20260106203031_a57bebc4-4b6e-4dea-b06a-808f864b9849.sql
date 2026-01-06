-- Fix permissive RLS policies by adding proper checks

-- Drop the overly permissive policies
DROP POLICY IF EXISTS "Authenticated users can create meetings" ON public.meetings;
DROP POLICY IF EXISTS "Authenticated users can create audit logs" ON public.audit_logs;

-- Create more restrictive policies
CREATE POLICY "Authenticated users can create meetings" ON public.meetings
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by_user_id = public.get_current_user_internal_id() OR
    created_by_user_id IS NULL
  );

CREATE POLICY "Authenticated users can create audit logs" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_user_id = public.get_current_user_internal_id() OR
    actor_user_id IS NULL
  );