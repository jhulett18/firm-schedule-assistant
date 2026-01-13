-- Update meetings SELECT policy to scope to created_by_user_id
DROP POLICY IF EXISTS "Users can view meetings they created or are part of" ON public.meetings;

CREATE POLICY "Users can view meetings they created or are part of" 
ON public.meetings 
FOR SELECT 
USING (
  (created_by_user_id IS NOT NULL AND created_by_user_id = public.get_current_user_internal_id())
  OR (created_by_user_id IS NULL AND (
    host_attorney_user_id = public.get_current_user_internal_id()
    OR public.get_current_user_internal_id() = ANY (support_user_ids)
  ))
  OR public.has_admin_role(auth.uid())
);

-- Update meetings UPDATE policy for user scoping
DROP POLICY IF EXISTS "Users can update their meetings" ON public.meetings;

CREATE POLICY "Users can update their meetings" 
ON public.meetings 
FOR UPDATE 
USING (
  CASE 
    WHEN created_by_user_id IS NOT NULL THEN created_by_user_id = public.get_current_user_internal_id()
    ELSE host_attorney_user_id = public.get_current_user_internal_id()
  END
  OR public.has_admin_role(auth.uid())
);

-- Update booking_requests to scope by meeting creator
DROP POLICY IF EXISTS "Meeting creators can manage booking requests" ON public.booking_requests;

CREATE POLICY "Meeting creators can manage booking requests" 
ON public.booking_requests 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.meetings m
    WHERE m.id = booking_requests.meeting_id
    AND (
      (m.created_by_user_id IS NOT NULL AND m.created_by_user_id = public.get_current_user_internal_id())
      OR public.has_admin_role(auth.uid())
    )
  )
);

-- Ensure users can only set created_by_user_id to their own ID (using safe CASE)
DROP POLICY IF EXISTS "Users can create meetings" ON public.meetings;

CREATE POLICY "Users can create meetings" 
ON public.meetings 
FOR INSERT 
WITH CHECK (
  CASE
    WHEN created_by_user_id IS NULL THEN true
    ELSE created_by_user_id = public.get_current_user_internal_id()
  END
);