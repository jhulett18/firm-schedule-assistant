import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { 
  Building2, 
  Plus, 
  RefreshCw, 
  Users, 
  Key, 
  Copy, 
  Check, 
  Shield,
  LogOut,
  Loader2,
  UserCheck,
  UserX,
  Home
} from 'lucide-react';
import { formatBusinessRole, getPrimaryRoleLabel, type BusinessRole, type SecurityRole } from '@/lib/roles';
import { PrimaryRoleBadge, StatusBadge } from '@/components/ui/role-badge';

interface Company {
  id: string;
  name: string;
  registration_code: string | null;
  invite_code: string | null;
  owner_id: string | null;
  created_at: string;
}

interface CompanyUser {
  id: string;
  name: string;
  email: string;
  role: BusinessRole;
  active: boolean;
  approved: boolean | null;
  approved_at: string | null;
  approved_by: string | null;
  company_id: string;
}

export default function ManagerDashboard() {
  const { signOut } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Fetch companies
  const { data: companies, isLoading: companiesLoading } = useQuery({
    queryKey: ['superuser-companies'],
    queryFn: async () => {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.access_token) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('superuser-companies', {
        method: 'GET',
      });

      if (response.error) throw new Error(response.error.message);
      if (!response.data?.success) throw new Error(response.data?.error || 'Failed to fetch companies');
      
      return response.data.companies as Company[];
    },
  });

  // Fetch users for selected company
  const { data: companyUsers, isLoading: usersLoading } = useQuery({
    queryKey: ['superuser-users', selectedCompanyId],
    queryFn: async () => {
      if (!selectedCompanyId) return [];
      
      const response = await supabase.functions.invoke('superuser-users', {
        body: { action: 'list', companyId: selectedCompanyId },
      });

      if (response.error) throw new Error(response.error.message);
      if (!response.data?.success) throw new Error(response.data?.error || 'Failed to fetch users');
      
      return response.data.users as CompanyUser[];
    },
    enabled: !!selectedCompanyId,
  });

  // Create company mutation
  const createCompanyMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await supabase.functions.invoke('superuser-companies', {
        body: { name },
      });

      if (response.error) throw new Error(response.error.message);
      if (!response.data?.success) throw new Error(response.data?.error || 'Failed to create company');
      
      return response.data.company as Company;
    },
    onSuccess: (company) => {
      queryClient.invalidateQueries({ queryKey: ['superuser-companies'] });
      setNewCompanyName('');
      toast({
        title: 'Company created',
        description: `${company.name} has been created with codes generated.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to create company',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Regenerate codes mutation
  const regenerateCodesMutation = useMutation({
    mutationFn: async ({ companyId, regenerate }: { companyId: string; regenerate: 'both' | 'registration' | 'invite' }) => {
      const response = await supabase.functions.invoke('superuser-companies', {
        method: 'PATCH',
        body: { companyId, regenerate },
      });

      if (response.error) throw new Error(response.error.message);
      if (!response.data?.success) throw new Error(response.data?.error || 'Failed to regenerate codes');
      
      return response.data.company as Company;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['superuser-companies'] });
      toast({
        title: 'Codes regenerated',
        description: 'New codes have been generated for the company.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to regenerate codes',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // User approval mutation
  const userApprovalMutation = useMutation({
    mutationFn: async ({ userId, action }: { userId: string; action: 'approve' | 'reset_approval' }) => {
      const response = await supabase.functions.invoke('superuser-users', {
        body: { action, userId },
      });

      if (response.error) throw new Error(response.error.message);
      if (!response.data?.success) throw new Error(response.data?.error || 'Failed to update user');
      
      return response.data.user as CompanyUser;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['superuser-users', selectedCompanyId] });
      toast({
        title: variables.action === 'approve' ? 'User approved' : 'Approval reset',
        description: variables.action === 'approve' 
          ? 'User can now access the system.' 
          : 'User approval has been reset.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to update user',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const copyToClipboard = async (text: string, codeType: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedCode(codeType);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const selectedCompany = companies?.find(c => c.id === selectedCompanyId);

  // Get security role for a user (simplified - staff for internal users)
  const getSecurityRole = (user: CompanyUser): SecurityRole => {
    if (user.role === 'Owner' || user.role === 'Admin') return 'admin';
    return 'staff';
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Superuser Manager</h1>
              <p className="text-sm text-muted-foreground">System Administration</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate('/dashboard')}>
              <Home className="w-4 h-4 mr-2" />
              Dashboard
            </Button>
            <Button variant="outline" onClick={() => signOut()}>
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="companies" className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="companies" className="flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Companies
            </TabsTrigger>
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              User Approvals
            </TabsTrigger>
          </TabsList>

          {/* Companies Tab */}
          <TabsContent value="companies" className="space-y-6">
            {/* Create Company Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plus className="w-5 h-5" />
                  Create New Company
                </CardTitle>
                <CardDescription>
                  Create a new company with auto-generated registration and invite codes
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4">
                  <div className="flex-1">
                    <Label htmlFor="companyName" className="sr-only">Company Name</Label>
                    <Input
                      id="companyName"
                      placeholder="Enter company name..."
                      value={newCompanyName}
                      onChange={(e) => setNewCompanyName(e.target.value)}
                    />
                  </div>
                  <Button 
                    onClick={() => createCompanyMutation.mutate(newCompanyName)}
                    disabled={!newCompanyName.trim() || createCompanyMutation.isPending}
                  >
                    {createCompanyMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4 mr-2" />
                    )}
                    Create Company
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Company Registry */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="w-5 h-5" />
                  Company Registry
                </CardTitle>
                <CardDescription>
                  All registered companies and their access codes
                </CardDescription>
              </CardHeader>
              <CardContent>
                {companiesLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : !companies?.length ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No companies registered yet
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Company</TableHead>
                        <TableHead>Registration Code</TableHead>
                        <TableHead>Invite Code</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {companies.map((company) => (
                        <TableRow key={company.id}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              {company.name}
                              {company.owner_id && (
                                <Badge variant="outline" className="text-xs">Owner Claimed</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <code className="bg-muted px-2 py-1 rounded text-sm font-mono">
                                {company.registration_code || 'N/A'}
                              </code>
                              {company.registration_code && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => copyToClipboard(company.registration_code!, `reg-${company.id}`)}
                                >
                                  {copiedCode === `reg-${company.id}` ? (
                                    <Check className="w-3 h-3 text-green-500" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                </Button>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <code className="bg-muted px-2 py-1 rounded text-sm font-mono">
                                {company.invite_code || 'N/A'}
                              </code>
                              {company.invite_code && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => copyToClipboard(company.invite_code!, `inv-${company.id}`)}
                                >
                                  {copiedCode === `inv-${company.id}` ? (
                                    <Check className="w-3 h-3 text-green-500" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                </Button>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(company.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => regenerateCodesMutation.mutate({ 
                                companyId: company.id, 
                                regenerate: 'both' 
                              })}
                              disabled={regenerateCodesMutation.isPending}
                            >
                              <RefreshCw className={`w-4 h-4 mr-2 ${regenerateCodesMutation.isPending ? 'animate-spin' : ''}`} />
                              Regenerate Codes
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Users Tab */}
          <TabsContent value="users" className="space-y-6">
            {/* Company Selector */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Key className="w-5 h-5" />
                  Select Company
                </CardTitle>
                <CardDescription>
                  Choose a company to manage user approvals
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Select
                  value={selectedCompanyId || ''}
                  onValueChange={(value) => setSelectedCompanyId(value || null)}
                >
                  <SelectTrigger className="w-full max-w-md">
                    <SelectValue placeholder="Select a company..." />
                  </SelectTrigger>
                  <SelectContent>
                    {companies?.map((company) => (
                      <SelectItem key={company.id} value={company.id}>
                        {company.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            {/* User List */}
            {selectedCompanyId && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    Users - {selectedCompany?.name}
                  </CardTitle>
                  <CardDescription>
                    Manage user approvals for this company
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {usersLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : !companyUsers?.length ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No users in this company
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>User</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {companyUsers.map((user) => {
                          const securityRole = getSecurityRole(user);
                          const primaryRole = getPrimaryRoleLabel(securityRole, user.role, user.approved);
                          
                          return (
                            <TableRow key={user.id}>
                              <TableCell>
                                <div>
                                  <div className="font-medium">{user.name}</div>
                                  <div className="text-sm text-muted-foreground">{user.email}</div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <PrimaryRoleBadge role={primaryRole} />
                                  <span className="text-sm text-muted-foreground">
                                    {formatBusinessRole(user.role)}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <StatusBadge 
                                  active={user.active} 
                                  approved={user.approved} 
                                />
                              </TableCell>
                              <TableCell className="text-right">
                                {user.approved ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => userApprovalMutation.mutate({ 
                                      userId: user.id, 
                                      action: 'reset_approval' 
                                    })}
                                    disabled={userApprovalMutation.isPending}
                                  >
                                    <UserX className="w-4 h-4 mr-2" />
                                    Reset Approval
                                  </Button>
                                ) : (
                                  <Button
                                    variant="default"
                                    size="sm"
                                    onClick={() => userApprovalMutation.mutate({ 
                                      userId: user.id, 
                                      action: 'approve' 
                                    })}
                                    disabled={userApprovalMutation.isPending}
                                  >
                                    <UserCheck className="w-4 h-4 mr-2" />
                                    Approve
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
