-- =============================================================================
-- LAWMATICS CONNECTIONS: Add company_id for multi-tenant isolation
-- =============================================================================

-- Add company_id column to lawmatics_connections
ALTER TABLE public.lawmatics_connections 
ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);

-- Backfill existing connection with the company_id from the connected_by_user
UPDATE public.lawmatics_connections lc
SET company_id = (
  SELECT u.company_id FROM public.users u WHERE u.id = lc.connected_by_user_id
)
WHERE lc.company_id IS NULL;

-- Drop existing policies
DROP POLICY IF EXISTS "Admins can manage lawmatics connections" ON public.lawmatics_connections;

-- Create new RLS policies scoped to company
CREATE POLICY "Users can view their company lawmatics connection"
ON public.lawmatics_connections
FOR SELECT
USING (company_id = get_current_user_company_id());

CREATE POLICY "Admins can manage their company lawmatics connection"
ON public.lawmatics_connections
FOR ALL
USING (
  company_id = get_current_user_company_id() 
  AND has_admin_role(auth.uid())
);

-- Add unique constraint so each company can only have one connection
ALTER TABLE public.lawmatics_connections
ADD CONSTRAINT lawmatics_connections_company_unique UNIQUE (company_id);