-- Step 1: Add company_id column to meetings table
ALTER TABLE public.meetings 
ADD COLUMN company_id uuid REFERENCES public.companies(id);

-- Step 2: Backfill existing meetings with company_id from creator
UPDATE public.meetings m
SET company_id = u.company_id
FROM public.users u
WHERE m.created_by_user_id = u.id
  AND m.company_id IS NULL;

-- Step 3: Create trigger function to auto-set company_id on insert
CREATE OR REPLACE FUNCTION public.set_meeting_company_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NULL AND NEW.created_by_user_id IS NOT NULL THEN
    SELECT company_id INTO NEW.company_id
    FROM public.users
    WHERE id = NEW.created_by_user_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Step 4: Create trigger
CREATE TRIGGER set_meeting_company_id_trigger
BEFORE INSERT ON public.meetings
FOR EACH ROW
EXECUTE FUNCTION set_meeting_company_id();

-- Step 5: Drop existing RLS policies on meetings
DROP POLICY IF EXISTS "Users can view meetings they created or are part of" ON public.meetings;
DROP POLICY IF EXISTS "Clients can view meetings where they are the client" ON public.meetings;
DROP POLICY IF EXISTS "Users can update their meetings" ON public.meetings;
DROP POLICY IF EXISTS "Users can delete their meetings" ON public.meetings;
DROP POLICY IF EXISTS "Users can create meetings" ON public.meetings;

-- Step 6: Create updated SELECT policy - company-scoped admin access
CREATE POLICY "Users can view meetings they created or are part of" 
ON public.meetings 
FOR SELECT 
USING (
  -- User is the creator
  (created_by_user_id IS NOT NULL AND created_by_user_id = get_current_user_internal_id())
  -- User is host or support (legacy meetings without creator)
  OR (created_by_user_id IS NULL AND (
    host_attorney_user_id = get_current_user_internal_id()
    OR get_current_user_internal_id() = ANY (support_user_ids)
  ))
  -- Admin/Owner can see meetings in THEIR company only
  OR (has_admin_role(auth.uid()) AND company_id = get_current_user_company_id())
);

-- Step 7: Create client view policy (unchanged but recreated)
CREATE POLICY "Clients can view meetings where they are the client" 
ON public.meetings 
FOR SELECT 
USING (
  (client_email = (auth.jwt() ->> 'email'::text)) 
  OR (EXISTS ( 
    SELECT 1
    FROM jsonb_array_elements(meetings.external_attendees) ea(value)
    WHERE ((ea.value ->> 'email'::text) = (auth.jwt() ->> 'email'::text))
  ))
);

-- Step 8: Create updated UPDATE policy - company-scoped admin access
CREATE POLICY "Users can update their meetings" 
ON public.meetings 
FOR UPDATE 
USING (
  CASE 
    WHEN created_by_user_id IS NOT NULL THEN created_by_user_id = get_current_user_internal_id()
    ELSE host_attorney_user_id = get_current_user_internal_id()
  END
  OR (has_admin_role(auth.uid()) AND company_id = get_current_user_company_id())
);

-- Step 9: Create updated DELETE policy - company-scoped admin access
CREATE POLICY "Users can delete their meetings" 
ON public.meetings 
FOR DELETE 
USING (
  CASE 
    WHEN created_by_user_id IS NOT NULL THEN created_by_user_id = get_current_user_internal_id()
    ELSE host_attorney_user_id = get_current_user_internal_id()
  END
  OR (has_admin_role(auth.uid()) AND company_id = get_current_user_company_id())
);

-- Step 10: Create updated INSERT policy - ensure company_id matches user's company
CREATE POLICY "Users can create meetings"
ON public.meetings
FOR INSERT
WITH CHECK (
  CASE
    WHEN created_by_user_id IS NULL THEN true
    ELSE created_by_user_id = get_current_user_internal_id()
  END
  AND (company_id IS NULL OR company_id = get_current_user_company_id())
);