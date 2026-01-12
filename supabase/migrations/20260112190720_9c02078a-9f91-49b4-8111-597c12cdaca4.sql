-- Fix meetings INSERT RLS to avoid evaluating get_current_user_internal_id() when created_by_user_id is NULL
-- This prevents permission errors caused by the helper function querying public.users.

DO $$
BEGIN
  -- Drop existing policy if it exists
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'meetings'
      AND policyname = 'Authenticated users can create meetings'
  ) THEN
    EXECUTE 'DROP POLICY "Authenticated users can create meetings" ON public.meetings';
  END IF;
END $$;

-- Recreate policy with CASE to guarantee the function is not evaluated for NULL inserts
CREATE POLICY "Authenticated users can create meetings"
ON public.meetings
FOR INSERT
TO authenticated
WITH CHECK (
  CASE
    WHEN created_by_user_id IS NULL THEN true
    ELSE created_by_user_id = public.get_current_user_internal_id()
  END
);
