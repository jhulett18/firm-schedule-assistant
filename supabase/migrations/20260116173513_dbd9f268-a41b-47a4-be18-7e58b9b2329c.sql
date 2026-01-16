-- Fix: Scope booking_requests RLS to company
-- Drop the existing policy with global admin bypass
DROP POLICY IF EXISTS "Meeting creators can manage booking requests" ON public.booking_requests;

-- Create new company-scoped policy
CREATE POLICY "Meeting creators can manage booking requests"
ON public.booking_requests
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM meetings m
    WHERE m.id = booking_requests.meeting_id 
    AND (
      -- Creator can access their own
      (m.created_by_user_id IS NOT NULL AND m.created_by_user_id = get_current_user_internal_id())
      -- Admins can only access their company's booking requests
      OR (has_admin_role(auth.uid()) AND m.company_id = get_current_user_company_id())
    )
  )
);