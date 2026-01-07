import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface InternalUser {
  id: string;
  auth_user_id: string;
  name: string;
  email: string;
  role: 'Attorney' | 'SupportStaff' | 'Admin';
  active: boolean;
  timezone_default: string;
  weekends_allowed_default: boolean;
  default_search_window_days: number;
  max_search_window_days: number;
  zoom_oauth_connected: boolean;
  zoom_user_id: string | null;
}

type AccountType = 'client' | 'staff';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  internalUser: InternalUser | null;
  isAdmin: boolean;
  isStaff: boolean;
  isClient: boolean;
  userRole: 'admin' | 'staff' | 'client' | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, name: string, accountType: AccountType) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [internalUser, setInternalUser] = useState<InternalUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [userRole, setUserRole] = useState<'admin' | 'staff' | 'client' | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchInternalUser = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('auth_user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching internal user:', error);
        return null;
      }
      return data as InternalUser | null;
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
      return data?.map(r => r.role) || [];
    } catch (err) {
      console.error('Error in fetchUserRoles:', err);
      return [];
    }
  };

  const updateRoleState = (roles: string[]) => {
    const hasAdmin = roles.includes('admin');
    const hasStaff = roles.includes('staff');
    const hasClient = roles.includes('client');

    setIsAdmin(hasAdmin);
    setIsStaff(hasAdmin || hasStaff); // Admins are also considered staff
    setIsClient(hasClient && !hasAdmin && !hasStaff);

    // Determine primary role (admin > staff > client)
    if (hasAdmin) {
      setUserRole('admin');
    } else if (hasStaff) {
      setUserRole('staff');
    } else if (hasClient) {
      setUserRole('client');
    } else {
      setUserRole(null);
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          setTimeout(async () => {
            const [internal, roles] = await Promise.all([
              fetchInternalUser(session.user.id),
              fetchUserRoles(session.user.id)
            ]);
            setInternalUser(internal);
            updateRoleState(roles);
            setIsLoading(false);
          }, 0);
        } else {
          setInternalUser(null);
          setIsAdmin(false);
          setIsStaff(false);
          setIsClient(false);
          setUserRole(null);
          setIsLoading(false);
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        Promise.all([
          fetchInternalUser(session.user.id),
          fetchUserRoles(session.user.id)
        ]).then(([internal, roles]) => {
          setInternalUser(internal);
          updateRoleState(roles);
          setIsLoading(false);
        });
      } else {
        setIsLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signUp = async (email: string, password: string, name: string, accountType: AccountType) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: { name },
      },
    });

    if (error) {
      return { error: error as Error };
    }

    if (data.user) {
      // Insert role into user_roles table
      const { error: roleError } = await supabase.from('user_roles').insert({
        user_id: data.user.id,
        role: accountType,
      });

      if (roleError) {
        console.error('Error creating user role:', roleError);
      }

      // Only create internal user record for staff accounts
      if (accountType === 'staff') {
        const { error: insertError } = await supabase.from('users').insert({
          auth_user_id: data.user.id,
          name,
          email,
          role: 'SupportStaff' as const,
        });

        if (insertError) {
          console.error('Error creating internal user:', insertError);
        }
      }
    }

    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setInternalUser(null);
    setIsAdmin(false);
    setIsStaff(false);
    setIsClient(false);
    setUserRole(null);
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
        userRole,
        isLoading,
        signIn,
        signUp,
        signOut,
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
