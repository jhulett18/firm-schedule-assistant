-- Drop the existing check constraint
ALTER TABLE public.user_roles DROP CONSTRAINT user_roles_role_check;

-- Add new check constraint including 'superuser'
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_role_check 
CHECK (role = ANY (ARRAY['admin'::text, 'staff'::text, 'client'::text, 'superuser'::text]));

-- Assign superuser role to Jonathan
INSERT INTO public.user_roles (user_id, role)
VALUES ('ee1e9012-6fb7-459e-934f-084cfcda6680', 'superuser');