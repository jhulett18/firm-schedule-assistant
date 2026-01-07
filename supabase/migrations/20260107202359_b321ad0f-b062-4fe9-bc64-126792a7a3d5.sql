-- Fix role constraint to allow admin, staff, client roles

-- 1. Drop the old restrictive check constraint
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;

-- 2. Add updated check constraint with all valid roles
ALTER TABLE public.user_roles 
ADD CONSTRAINT user_roles_role_check 
CHECK (role IN ('admin', 'staff', 'client'));

-- 3. Update any 'user' roles to 'staff' for compatibility
UPDATE public.user_roles SET role = 'staff' WHERE role = 'user';

-- 4. Now insert the client role for test user
INSERT INTO public.user_roles (user_id, role)
VALUES ('7d9a5e23-7677-46b4-bc08-2a2448ce80a9', 'client')
ON CONFLICT (user_id, role) DO NOTHING;

-- 5. Remove any admin/staff roles from test user if they exist
DELETE FROM public.user_roles 
WHERE user_id = '7d9a5e23-7677-46b4-bc08-2a2448ce80a9' 
AND role IN ('admin', 'staff');