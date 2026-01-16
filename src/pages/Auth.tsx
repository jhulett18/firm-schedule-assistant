import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Scale, Mail, Lock, User, Building2, Users, Key } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { z } from 'zod';
import Footer from '@/components/layout/Footer';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const signupSchema = loginSchema.extend({
  name: z.string().min(2, 'Name must be at least 2 characters'),
});

type SignupRole = 'owner' | 'employee';
type OwnerOption = 'create' | 'code';

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Signup-specific state
  const [signupRole, setSignupRole] = useState<SignupRole | null>(null);
  const [ownerOption, setOwnerOption] = useState<OwnerOption>('create');
  const [companyName, setCompanyName] = useState('');
  const [signupCode, setSignupCode] = useState('');

  const { user, isLoading: authLoading, rolesLoaded, isAdmin, isStaff, isClient, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Redirect authenticated users based on role
  useEffect(() => {
    if (authLoading || (user && !rolesLoaded)) {
      return;
    }

    if (user && rolesLoaded) {
      if (isClient) {
        navigate('/client', { replace: true });
      } else if (isAdmin || isStaff) {
        navigate('/dashboard', { replace: true });
      }
    }
  }, [user, authLoading, rolesLoaded, isAdmin, isStaff, isClient, navigate]);

  // Reset signup state when switching modes
  useEffect(() => {
    if (isLogin) {
      setSignupRole(null);
      setOwnerOption('create');
      setCompanyName('');
      setSignupCode('');
    }
  }, [isLogin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (isLogin) {
        // LOGIN
        const validation = loginSchema.safeParse({ email, password });
        if (!validation.success) {
          toast({
            title: 'Validation Error',
            description: validation.error.errors[0].message,
            variant: 'destructive',
          });
          setIsLoading(false);
          return;
        }

        const { error } = await signIn(email, password);
        if (error) {
          toast({
            title: 'Sign in failed',
            description: error.message,
            variant: 'destructive',
          });
        }
      } else {
        // SIGNUP
        const validation = signupSchema.safeParse({ email, password, name });
        if (!validation.success) {
          toast({
            title: 'Validation Error',
            description: validation.error.errors[0].message,
            variant: 'destructive',
          });
          setIsLoading(false);
          return;
        }

        // Validate role-specific fields
        if (!signupRole) {
          toast({
            title: 'Please select a role',
            description: 'Choose whether you are an Owner or Employee',
            variant: 'destructive',
          });
          setIsLoading(false);
          return;
        }

        if (signupRole === 'owner' && ownerOption === 'create' && !companyName.trim()) {
          toast({
            title: 'Company name required',
            description: 'Please enter your company name',
            variant: 'destructive',
          });
          setIsLoading(false);
          return;
        }

        if (signupRole === 'owner' && ownerOption === 'code' && !signupCode.trim()) {
          toast({
            title: 'Registration code required',
            description: 'Please enter your registration code',
            variant: 'destructive',
          });
          setIsLoading(false);
          return;
        }

        if (signupRole === 'employee' && !signupCode.trim()) {
          toast({
            title: 'Invite code required',
            description: 'Please enter your company invite code',
            variant: 'destructive',
          });
          setIsLoading(false);
          return;
        }

        // Build signup options
        const signupOptions: {
          is_owner: boolean;
          signup_code?: string;
          company_name?: string;
        } = {
          is_owner: signupRole === 'owner',
        };

        if (signupRole === 'owner') {
          if (ownerOption === 'create') {
            signupOptions.company_name = companyName.trim();
          } else {
            signupOptions.signup_code = signupCode.trim();
          }
        } else {
          signupOptions.signup_code = signupCode.trim();
        }

        const { error } = await signUp(email, password, name, signupOptions);
        if (error) {
          toast({
            title: 'Sign up failed',
            description: error.message,
            variant: 'destructive',
          });
        } else {
          if (signupRole === 'owner') {
            toast({
              title: 'Account created!',
              description: 'You can now sign in to your account.',
            });
          } else {
            toast({
              title: 'Account created!',
              description: 'Your account is pending approval. An administrator will review your request.',
            });
          }
          setIsLogin(true);
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const getDescription = () => {
    if (isLogin) return 'Sign in to your account';
    if (!signupRole) return 'Create your account';
    if (signupRole === 'owner') return 'Set up your company account';
    return 'Join your company';
  };

  return (
    <div className="min-h-screen flex flex-col gradient-subtle">
      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-floating animate-fade-in">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto w-14 h-14 rounded-xl gradient-primary flex items-center justify-center mb-2">
              <Scale className="w-7 h-7 text-primary-foreground" />
            </div>
            <CardTitle className="text-2xl font-serif">LawScheduler</CardTitle>
            <CardDescription>{getDescription()}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name field - only for signup */}
              {!isLogin && (
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="John Smith"
                      className="pl-10"
                      required
                    />
                  </div>
                </div>
              )}

              {/* Role selection - only for signup */}
              {!isLogin && (
                <div className="space-y-3">
                  <Label>I am a...</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setSignupRole('owner')}
                      className={`p-4 rounded-lg border-2 transition-all text-left ${
                        signupRole === 'owner'
                          ? 'border-primary bg-primary/5'
                          : 'border-muted hover:border-muted-foreground/50'
                      }`}
                    >
                      <Building2 className={`w-5 h-5 mb-2 ${signupRole === 'owner' ? 'text-primary' : 'text-muted-foreground'}`} />
                      <div className="font-medium">Owner</div>
                      <div className="text-xs text-muted-foreground">Set up a new company</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSignupRole('employee')}
                      className={`p-4 rounded-lg border-2 transition-all text-left ${
                        signupRole === 'employee'
                          ? 'border-primary bg-primary/5'
                          : 'border-muted hover:border-muted-foreground/50'
                      }`}
                    >
                      <Users className={`w-5 h-5 mb-2 ${signupRole === 'employee' ? 'text-primary' : 'text-muted-foreground'}`} />
                      <div className="font-medium">Employee</div>
                      <div className="text-xs text-muted-foreground">Join existing company</div>
                    </button>
                  </div>
                </div>
              )}

              {/* Owner-specific options */}
              {!isLogin && signupRole === 'owner' && (
                <div className="space-y-3 p-3 rounded-lg bg-muted/50">
                  <RadioGroup value={ownerOption} onValueChange={(v) => setOwnerOption(v as OwnerOption)}>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="create" id="create" />
                      <Label htmlFor="create" className="font-normal cursor-pointer">Create a new company</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="code" id="code" />
                      <Label htmlFor="code" className="font-normal cursor-pointer">I have a registration code</Label>
                    </div>
                  </RadioGroup>

                  {ownerOption === 'create' && (
                    <div className="space-y-2 pt-2">
                      <Label htmlFor="companyName">Company Name</Label>
                      <div className="relative">
                        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          id="companyName"
                          type="text"
                          value={companyName}
                          onChange={(e) => setCompanyName(e.target.value)}
                          placeholder="Acme Law Firm"
                          className="pl-10"
                        />
                      </div>
                    </div>
                  )}

                  {ownerOption === 'code' && (
                    <div className="space-y-2 pt-2">
                      <Label htmlFor="regCode">Registration Code</Label>
                      <div className="relative">
                        <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          id="regCode"
                          type="text"
                          value={signupCode}
                          onChange={(e) => setSignupCode(e.target.value.toUpperCase())}
                          placeholder="ABCD1234"
                          className="pl-10 uppercase"
                          maxLength={8}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Employee invite code */}
              {!isLogin && signupRole === 'employee' && (
                <div className="space-y-2 p-3 rounded-lg bg-muted/50">
                  <Label htmlFor="inviteCode">Company Invite Code</Label>
                  <div className="relative">
                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="inviteCode"
                      type="text"
                      value={signupCode}
                      onChange={(e) => setSignupCode(e.target.value.toUpperCase())}
                      placeholder="ABCD1234"
                      className="pl-10 uppercase"
                      maxLength={8}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Get this code from your company administrator
                  </p>
                </div>
              )}

              {/* Email field */}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@lawfirm.com"
                    className="pl-10"
                    required
                  />
                </div>
              </div>

              {/* Password field */}
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="pl-10"
                    required
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" size="lg" disabled={isLoading}>
                {isLoading ? 'Please wait...' : isLogin ? 'Sign In' : 'Create Account'}
              </Button>
            </form>

            <div className="mt-6 text-center space-y-3">
              {/* Toggle login/signup - now a prominent button */}
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsLogin(!isLogin)}
                className="w-full"
              >
                {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
              </Button>

              <div className="pt-2 border-t border-muted">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/access')}
                  className="text-xs w-full"
                >
                  I have a scheduling code
                </Button>
              </div>

              <div className="flex items-center justify-center gap-4 pt-3 text-xs text-muted-foreground">
                <Link to="/privacy" className="hover:text-foreground transition-colors">
                  Privacy Policy
                </Link>
                <span>•</span>
                <Link to="/terms" className="hover:text-foreground transition-colors">
                  Terms of Service
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      <Footer />
    </div>
  );
}
