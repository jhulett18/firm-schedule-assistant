-- Add superuser role support and enforce owner signup via registration code

-- 1. Extend app_role enum for role checks
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'superuser';

-- 2. Expand user_roles check constraint to include superuser
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE public.user_roles
ADD CONSTRAINT user_roles_role_check
CHECK (role IN ('admin', 'staff', 'client', 'superuser'));

-- 3. Update role helper functions to include superuser
CREATE OR REPLACE FUNCTION public.has_admin_role(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin', 'superuser')
  )
$$;

CREATE OR REPLACE FUNCTION public.has_superuser_role(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = 'superuser'
  )
$$;

CREATE OR REPLACE FUNCTION public.has_staff_role(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin', 'staff', 'superuser')
  )
$$;

-- 4. Enforce owner signup via registration code only (no company creation on signup)
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
  v_new_user_id uuid;
BEGIN
  v_is_owner := COALESCE((NEW.raw_user_meta_data->>'is_owner')::boolean, false);
  v_signup_code := NEW.raw_user_meta_data->>'signup_code';

  IF v_is_owner THEN
    IF v_signup_code IS NULL OR v_signup_code = '' THEN
      RAISE EXCEPTION 'Registration code required for owner signup';
    END IF;

    SELECT id INTO v_company_id FROM public.companies
    WHERE upper(registration_code) = upper(v_signup_code);

    IF v_company_id IS NULL THEN
      RAISE EXCEPTION 'Invalid registration code';
    END IF;

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

    UPDATE public.companies
    SET owner_id = v_new_user_id
    WHERE id = v_company_id AND owner_id IS NULL;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    IF v_signup_code IS NOT NULL AND v_signup_code != '' THEN
      SELECT id INTO v_company_id FROM public.companies
      WHERE upper(invite_code) = upper(v_signup_code);
    END IF;

    IF v_company_id IS NULL THEN
      v_company_id := '00000000-0000-0000-0000-000000000001'::uuid;
    END IF;

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

    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'staff')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- 5. Promote Jonathan to superuser (replace existing role)
UPDATE public.user_roles
SET role = 'superuser'
WHERE user_id = (
  SELECT auth_user_id FROM public.users WHERE email = 'jonathan@legaleasemarketing.com'
);
