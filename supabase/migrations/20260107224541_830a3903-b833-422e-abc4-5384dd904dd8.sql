-- Drop and recreate triggers to ensure they're active
DROP TRIGGER IF EXISTS on_auth_user_created_role ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_created_internal ON auth.users;

CREATE TRIGGER on_auth_user_created_role
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();

CREATE TRIGGER on_auth_user_created_internal
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_internal_record();

-- Backfill missing public.users records for existing auth users
INSERT INTO public.users (auth_user_id, name, email, role)
SELECT 
  au.id,
  COALESCE(au.raw_user_meta_data->>'name', split_part(au.email, '@', 1)),
  au.email,
  'SupportStaff'
FROM auth.users au
WHERE NOT EXISTS (
  SELECT 1 FROM public.users u WHERE u.auth_user_id = au.id
)
ON CONFLICT (auth_user_id) DO NOTHING;

-- Backfill missing user_roles for existing auth users
INSERT INTO public.user_roles (user_id, role)
SELECT au.id, 'staff'
FROM auth.users au
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_roles ur WHERE ur.user_id = au.id
)
ON CONFLICT (user_id, role) DO NOTHING;