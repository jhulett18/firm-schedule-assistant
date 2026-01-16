import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface InternalUser {
  id: string;
  auth_user_id: string;
  name: string;
  email: string;
  role: 'Attorney' | 'SupportStaff' | 'Admin' | 'Owner';
  active: boolean;
  company_id: string;
  timezone_default: string;
  weekends_allowed_default: boolean;
  default_search_window_days: number;
  max_search_window_days: number;
  zoom_oauth_connected: boolean;
  zoom_user_id: string | null;
  approved: boolean;
  approved_by: string | null;
  approved_at: string | null;
}

interface SignupOptions {
  is_owner: boolean;
  signup_code?: string;
  company_name?: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  internalUser: InternalUser | null;
  isAdmin: boolean;
  isStaff: boolean;
  isClient: boolean;
  isSuperuser: boolean;
  userRole: 'admin' | 'staff' | 'client' | null;
  isLoading: boolean;
  rolesLoaded: boolean;
  isDevMode: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, name: string, options?: SignupOptions) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  enableDevMode: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [internalUser, setInternalUser] = useState<InternalUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [isSuperuser, setIsSuperuser] = useState(false);
  const [userRole, setUserRole] = useState<'admin' | 'staff' | 'client' | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [rolesLoaded, setRolesLoaded] = useState(false);
  const [isDevMode, setIsDevMode] = useState(false);

  const fetchInternalUser = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('auth_user_id', userId)
        .maybeSingle();

      if (error) {
        console.error('Error fetching internal user:', error);
        return null;
      }
      return data as unknown as InternalUser | null;
    } catch (err) {
      console.error('Error in fetchInternalUser:', err);
      return null;
    }
  };

  const fetchUserRoles = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);

      if (error) {
        console.error('Error fetching user roles:', error);
        return [];
      }
      console.log('Fetched roles for user:', userId, data);
      return data?.map(r => r.role) || [];
    } catch (err) {
      console.error('Error in fetchUserRoles:', err);
      return [];
    }
  };

  const updateRoleState = (roles: string[]) => {
    console.log('Updating role state with:', roles);
    const hasAdmin = roles.includes('admin');
    const hasStaff = roles.includes('staff');
    const hasClient = roles.includes('client');
    const hasSuperuser = roles.includes('superuser');

    // Compute role hierarchy: admin > staff > client
    const computedIsAdmin = hasAdmin;
    const computedIsStaff = hasAdmin || hasStaff;
    const computedIsClient = hasClient && !hasAdmin && !hasStaff;
    
    let computedRole: 'admin' | 'staff' | 'client' | null = null;
    if (hasAdmin) {
      computedRole = 'admin';
    } else if (hasStaff) {
      computedRole = 'staff';
    } else if (hasClient) {
      computedRole = 'client';
    }

    console.log('Computed roles - isAdmin:', computedIsAdmin, 'isStaff:', computedIsStaff, 'isClient:', computedIsClient, 'isSuperuser:', hasSuperuser, 'userRole:', computedRole);

    setIsAdmin(computedIsAdmin);
    setIsStaff(computedIsStaff);
    setIsClient(computedIsClient);
    setIsSuperuser(hasSuperuser);
    setUserRole(computedRole);
    setRolesLoaded(true);
  };

  const loadUserData = async (authUser: User) => {
    try {
      const [internal, roles] = await Promise.all([
        fetchInternalUser(authUser.id),
        fetchUserRoles(authUser.id)
      ]);
      setInternalUser(internal);
      updateRoleState(roles);
    } catch (err) {
      console.error('Error loading user data:', err);
      setRolesLoaded(true); // Mark as loaded even on error to prevent hanging
    }
  };

  const resetState = () => {
    setUser(null);
    setSession(null);
    setInternalUser(null);
    setIsAdmin(false);
    setIsStaff(false);
    setIsClient(false);
    setIsSuperuser(false);
    setUserRole(null);
    setRolesLoaded(false);
    setIsDevMode(false);
  };

  useEffect(() => {
    let mounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return;
        
        console.log('Auth state change:', event, session?.user?.id);
        
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          // Don't set isLoading false yet - wait for roles to load
          // Defer to avoid Supabase deadlock
          setTimeout(async () => {
            if (!mounted) return;
            await loadUserData(session.user);
            setIsLoading(false);
          }, 0);
        } else {
          resetState();
          setIsLoading(false);
        }
      }
    );

    // Initial session check
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;
      
      console.log('Initial session check:', session?.user?.id);
      
      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        await loadUserData(session.user);
      } else {
        setRolesLoaded(true); // No user, but roles are "loaded" (empty)
      }
      
      setIsLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    setRolesLoaded(false); // Reset roles loaded state
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  // Signup with optional owner/employee metadata - triggers handle role assignment
  const signUp = async (email: string, password: string, name: string, options?: SignupOptions) => {
    const redirectUrl = `${window.location.origin}/`;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          name,
          is_owner: options?.is_owner ?? false,
          signup_code: options?.signup_code,
          company_name: options?.company_name,
        },
      },
    });

    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    resetState();
  };

  const enableDevMode = () => {
    // Create mock user for dev mode
    const mockUser = {
      id: 'dev-user-id',
      email: 'dev@test.com',
      app_metadata: {},
      user_metadata: { name: 'Dev User' },
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    } as User;

    setUser(mockUser);
    setIsAdmin(true);
    setIsStaff(true);
    setIsClient(false);
    setIsSuperuser(false);
    setUserRole('admin');
    setRolesLoaded(true);
    setIsDevMode(true);
    setIsLoading(false);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        internalUser,
        isAdmin,
        isStaff,
        isClient,
        isSuperuser,
        userRole,
        isLoading,
        rolesLoaded,
        isDevMode,
        signIn,
        signUp,
        signOut,
        enableDevMode,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
