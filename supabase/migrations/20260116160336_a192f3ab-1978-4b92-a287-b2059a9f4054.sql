-- =============================================================================
-- STEP 2: USER APPROVAL SYSTEM + COMPANY CODES + FIX OWNER ACCOUNT
-- =============================================================================

-- Add approval columns to users table
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS approved boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.users(id);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- Backfill existing users as approved
UPDATE public.users SET approved = true WHERE approved IS NULL OR approved = false;

-- Add registration/invite codes and owner_id to companies
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS registration_code text UNIQUE;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS invite_code text UNIQUE;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.users(id);

-- Generate codes for existing companies
UPDATE public.companies
SET registration_code = upper(substr(md5(random()::text), 1, 8)),
    invite_code = upper(substr(md5(random()::text), 1, 8))
WHERE registration_code IS NULL;

-- =============================================================================
-- FIX EXISTING OWNER ACCOUNT (owner@lawscheduler.com)
-- =============================================================================

-- Update user to Owner role (now that enum value is committed)
UPDATE public.users 
SET role = 'Owner', approved = true 
WHERE email = 'owner@lawscheduler.com';

-- Update user_roles to admin for RLS access
UPDATE public.user_roles 
SET role = 'admin' 
WHERE user_id = (SELECT auth_user_id FROM public.users WHERE email = 'owner@lawscheduler.com');

-- Set as owner of default company
UPDATE public.companies 
SET owner_id = (SELECT id FROM public.users WHERE email = 'owner@lawscheduler.com')
WHERE id = '00000000-0000-0000-0000-000000000001';

-- =============================================================================
-- UPDATE TRIGGER FOR NEW USER SIGNUP
-- =============================================================================

-- Drop existing triggers first
DROP TRIGGER IF EXISTS on_auth_user_created_internal ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Drop old function
DROP FUNCTION IF EXISTS public.handle_new_user_internal_record();

-- Create new trigger function for user signup
CREATE OR REPLACE FUNCTION public.handle_new_user_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_is_owner boolean;
  v_signup_code text;
  v_company_name text;
  v_new_user_id uuid;
BEGIN
  -- Get signup metadata from raw_user_meta_data
  v_is_owner := COALESCE((NEW.raw_user_meta_data->>'is_owner')::boolean, false);
  v_signup_code := NEW.raw_user_meta_data->>'signup_code';
  v_company_name := NEW.raw_user_meta_data->>'company_name';

  IF v_is_owner THEN
    -- OWNER SIGNUP
    IF v_company_name IS NOT NULL AND v_company_name != '' THEN
      -- Owner creating new company
      INSERT INTO public.companies (name, registration_code, invite_code)
      VALUES (
        v_company_name,
        upper(substr(md5(random()::text), 1, 8)),
        upper(substr(md5(random()::text), 1, 8))
      )
      RETURNING id INTO v_company_id;
    ELSIF v_signup_code IS NOT NULL AND v_signup_code != '' THEN
      -- Owner claiming existing company via registration code
      SELECT id INTO v_company_id FROM public.companies
      WHERE upper(registration_code) = upper(v_signup_code);

      IF v_company_id IS NULL THEN
        -- Invalid registration code - use default company
        v_company_id := '00000000-0000-0000-0000-000000000001'::uuid;
      END IF;
    ELSE
      -- Fallback to default company
      v_company_id := '00000000-0000-0000-0000-000000000001'::uuid;
    END IF;

    -- Create owner user record (approved, Owner role)
    INSERT INTO public.users (auth_user_id, name, email, role, company_id, approved)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
      NEW.email,
      'Owner',
      v_company_id,
      true
    )
    RETURNING id INTO v_new_user_id;

    -- Set as company owner
    UPDATE public.companies
    SET owner_id = v_new_user_id
    WHERE id = v_company_id AND owner_id IS NULL;

    -- Assign admin app role (for RLS)
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;

  ELSE
    -- EMPLOYEE SIGNUP
    IF v_signup_code IS NOT NULL AND v_signup_code != '' THEN
      -- Employee joining via invite code
      SELECT id INTO v_company_id FROM public.companies
      WHERE upper(invite_code) = upper(v_signup_code);
    END IF;

    -- Fallback to default company if no valid code
    IF v_company_id IS NULL THEN
      v_company_id := '00000000-0000-0000-0000-000000000001'::uuid;
    END IF;

    -- Create employee user record (not approved, awaits approval)
    INSERT INTO public.users (auth_user_id, name, email, role, company_id, approved)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
      NEW.email,
      'SupportStaff',
      v_company_id,
      false
    )
    ON CONFLICT (auth_user_id) DO NOTHING;

    -- Assign staff app role (for RLS)
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'staff')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Create the trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_signup();