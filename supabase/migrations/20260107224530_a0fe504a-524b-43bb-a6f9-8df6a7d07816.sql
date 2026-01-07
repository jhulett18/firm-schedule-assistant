-- Add unique constraint on auth_user_id if not exists
ALTER TABLE public.users ADD CONSTRAINT users_auth_user_id_unique UNIQUE (auth_user_id);

-- Add unique constraint on user_roles (user_id, role) if not exists  
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_role_unique UNIQUE (user_id, role);