-- =============================================================================
-- COMPANY OWNERSHIP + LAWMATICS COMPANY SCOPING
-- =============================================================================

-- 1. Add owner_id to companies table
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.users(id);

-- 2. Add company_id to lawmatics_connections table
ALTER TABLE public.lawmatics_connections ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);

-- 3. Backfill: Set owner to first admin user in each company
UPDATE public.companies c
SET owner_id = (
  SELECT u.id FROM public.users u
  JOIN public.user_roles ur ON ur.user_id = u.auth_user_id
  WHERE u.company_id = c.id AND ur.role = 'admin'
  LIMIT 1
)
WHERE owner_id IS NULL;

-- 4. Backfill: Link existing lawmatics_connections to default company
UPDATE public.lawmatics_connections
SET company_id = '00000000-0000-0000-0000-000000000001'
WHERE company_id IS NULL;

-- =============================================================================
-- UPDATE RLS POLICIES FOR LAWMATICS CONNECTIONS
-- =============================================================================

-- Drop existing admin-only policy
DROP POLICY IF EXISTS "Admins can manage lawmatics connections" ON public.lawmatics_connections;

-- All users in a company can VIEW the connection (to see status on dashboard)
CREATE POLICY "Users can view company lawmatics connection"
ON public.lawmatics_connections
FOR SELECT
USING (company_id = get_current_user_company_id());

-- Only company owner or admins can manage (connect/disconnect)
CREATE POLICY "Company owner can manage lawmatics connection"
ON public.lawmatics_connections
FOR ALL
USING (
  company_id = get_current_user_company_id()
  AND (
    -- Company owner
    EXISTS (
      SELECT 1 FROM public.companies
      WHERE id = lawmatics_connections.company_id
      AND owner_id = get_current_user_internal_id()
    )
    -- Or admin role
    OR has_admin_role(auth.uid())
  )
);
