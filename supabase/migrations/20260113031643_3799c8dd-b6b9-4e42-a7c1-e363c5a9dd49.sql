-- =============================================================================
-- COMPANIES + USER MEMBERSHIP + MEETING PARTICIPANTS
-- =============================================================================

-- 1. Create companies table
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on companies
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- 2. Add company_id column to users (nullable initially for backfill)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);

-- 3. Add participant_user_ids column to meetings for storing selected participants
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS participant_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

-- 4. Create a default company and backfill all existing users
INSERT INTO public.companies (id, name) 
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Company')
ON CONFLICT (id) DO NOTHING;

-- Backfill all users to the default company
UPDATE public.users 
SET company_id = '00000000-0000-0000-0000-000000000001'
WHERE company_id IS NULL;

-- 5. Make company_id NOT NULL after backfill
ALTER TABLE public.users ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.users ALTER COLUMN company_id SET DEFAULT '00000000-0000-0000-0000-000000000001'::uuid;

-- =============================================================================
-- HELPER FUNCTION: get_current_user_company_id()
-- Safe function that doesn't trigger RLS recursion
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_current_user_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1
$$;

-- =============================================================================
-- RLS POLICIES FOR COMPANIES
-- =============================================================================

-- Users can view their own company
CREATE POLICY "Users can view their own company"
ON public.companies
FOR SELECT
USING (id = get_current_user_company_id());

-- Admins can manage companies
CREATE POLICY "Admins can manage companies"
ON public.companies
FOR ALL
USING (has_admin_role(auth.uid()));

-- =============================================================================
-- UPDATE USERS RLS FOR COMPANY-SCOPED VISIBILITY
-- =============================================================================

-- Drop existing SELECT policy on users
DROP POLICY IF EXISTS "Users can view all active users" ON public.users;

-- New policy: Users can view active users in their own company + themselves
CREATE POLICY "Users can view company members"
ON public.users
FOR SELECT
USING (
  (active = true AND company_id = get_current_user_company_id())
  OR auth_user_id = auth.uid()
);

-- =============================================================================
-- UPDATE MEETINGS INSERT/UPDATE RLS
-- Ensure participant_user_ids can be set during insert
-- =============================================================================

-- Drop and recreate meetings INSERT policy to allow participant_user_ids
DROP POLICY IF EXISTS "Authenticated users can create meetings" ON public.meetings;
DROP POLICY IF EXISTS "Users can create meetings" ON public.meetings;

-- Allow authenticated users to insert meetings with their own internal user ID as creator
CREATE POLICY "Users can create meetings"
ON public.meetings
FOR INSERT
WITH CHECK (
  CASE
    WHEN created_by_user_id IS NULL THEN true
    ELSE created_by_user_id = get_current_user_internal_id()
  END
);