-- Phase 1: Stabilize Auth & Roles

-- 1. Drop the old self-insert policy that allows users to assign their own roles
DROP POLICY IF EXISTS "Users can insert their own role" ON public.user_roles;

-- 2. Create a function to handle new user signup - assigns 'staff' role by default
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert default 'staff' role for new auth users
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'staff')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 3. Create a trigger on auth.users to auto-assign role on signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();

-- 4. Also create a function to create internal user record for staff
CREATE OR REPLACE FUNCTION public.handle_new_user_internal_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Create internal user record for all new signups (they're all staff by default now)
  INSERT INTO public.users (auth_user_id, name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    'SupportStaff'
  )
  ON CONFLICT (auth_user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 5. Create trigger for internal user record
DROP TRIGGER IF EXISTS on_auth_user_created_internal ON auth.users;
CREATE TRIGGER on_auth_user_created_internal
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_internal_record();