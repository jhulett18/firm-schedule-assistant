-- Add DELETE policy for meetings table
-- Users can delete meetings they created
CREATE POLICY "Users can delete their meetings"
ON public.meetings
FOR DELETE
USING (
  CASE
    WHEN created_by_user_id IS NOT NULL THEN created_by_user_id = get_current_user_internal_id()
    ELSE host_attorney_user_id = get_current_user_internal_id()
  END
  OR has_admin_role(auth.uid())
);