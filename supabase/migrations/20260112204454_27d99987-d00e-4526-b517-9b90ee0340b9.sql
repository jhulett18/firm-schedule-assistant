-- Update the meetings INSERT policy to use CASE to avoid get_current_user_internal_id() evaluation when created_by_user_id is NULL
-- This prevents "permission denied for table users" errors
DROP POLICY IF EXISTS "Users can create meetings" ON public.meetings;

CREATE POLICY "Users can create meetings"
ON public.meetings
FOR INSERT
TO authenticated
WITH CHECK (
  CASE
    WHEN created_by_user_id IS NULL THEN true
    ELSE created_by_user_id = public.get_current_user_internal_id()
  END
);