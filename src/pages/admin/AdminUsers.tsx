import { useState, useEffect } from "react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, CheckCircle, XCircle, Clock, Copy, Key, HelpCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { PrimaryRoleBadge, StatusBadge, BusinessRoleLabel } from "@/components/ui/role-badge";
import { getPrimaryRoleLabel } from "@/lib/roles";
import { RoleHelpModal } from "@/components/help/RoleHelpModal";

interface User {
  id: string;
  name: string;
  email: string;
  role: "Attorney" | "SupportStaff" | "Admin" | "Owner";
  active: boolean;
  timezone_default: string;
  approved: boolean;
  approved_by: string | null;
  approved_at: string | null;
  company_id: string;
}

interface Company {
  id: string;
  name: string;
  registration_code: string | null;
  invite_code: string | null;
}

export default function AdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showRoleHelp, setShowRoleHelp] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    role: "SupportStaff" as "Attorney" | "SupportStaff" | "Admin" | "Owner",
    active: true,
    timezone_default: "America/New_York",
  });
  const { toast } = useToast();
  const { internalUser, isAdmin } = useAuth();

  useEffect(() => {
    fetchUsers();
    fetchCompany();
  }, []);

  async function fetchUsers() {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .order("approved", { ascending: true })
      .order("name");

    if (error) {
      toast({ title: "Error fetching users", description: error.message, variant: "destructive" });
    } else {
      setUsers((data as unknown as User[]) || []);
    }
    setLoading(false);
  }

  async function fetchCompany() {
    const { data, error } = await supabase
      .from("companies")
      .select("id, name, registration_code, invite_code")
      .single();

    if (error) {
      console.error("Error fetching company:", error);
    } else {
      setCompany(data as unknown as Company);
    }
  }

  function openCreateDialog() {
    setEditingUser(null);
    setFormData({
      name: "",
      email: "",
      role: "SupportStaff",
      active: true,
      timezone_default: "America/New_York",
    });
    setDialogOpen(true);
  }

  function openEditDialog(user: User) {
    setEditingUser(user);
    setFormData({
      name: user.name,
      email: user.email,
      role: user.role,
      active: user.active,
      timezone_default: user.timezone_default,
    });
    setDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (editingUser) {
      const { error } = await supabase
        .from("users")
        .update(formData as any)
        .eq("id", editingUser.id);

      if (error) {
        toast({ title: "Error updating user", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "User updated" });
        setDialogOpen(false);
        fetchUsers();
      }
    } else {
      const { error } = await supabase.from("users").insert(formData as any);

      if (error) {
        toast({ title: "Error creating user", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "User created" });
        setDialogOpen(false);
        fetchUsers();
      }
    }
  }

  async function approveUser(userId: string) {
    const { error } = await supabase
      .from("users")
      .update({
        approved: true,
        approved_by: internalUser?.id,
        approved_at: new Date().toISOString(),
      } as any)
      .eq("id", userId);

    if (error) {
      toast({ title: "Error approving user", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "User approved", description: "The user can now access the system." });
      fetchUsers();
    }
  }

  async function rejectUser(userId: string) {
    // For now, just delete the user record
    const { error } = await supabase
      .from("users")
      .delete()
      .eq("id", userId);

    if (error) {
      toast({ title: "Error rejecting user", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "User rejected", description: "The user request has been removed." });
      fetchUsers();
    }
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copied to clipboard` });
  }

  const pendingUsers = users.filter(u => !u.approved);
  const approvedUsers = users.filter(u => u.approved);

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Company Codes Section - Admin only */}
        {isAdmin && company && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Company Codes
              </CardTitle>
              <CardDescription>
                Share these codes with new team members to join your company
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                  <Label className="text-xs text-muted-foreground">Registration Code (for Owners)</Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-background rounded border text-lg font-mono tracking-wider">
                      {company.registration_code || "N/A"}
                    </code>
                    {company.registration_code && (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => copyToClipboard(company.registration_code!, "Registration code")}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                  <Label className="text-xs text-muted-foreground">Invite Code (for Employees)</Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-background rounded border text-lg font-mono tracking-wider">
                      {company.invite_code || "N/A"}
                    </code>
                    {company.invite_code && (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => copyToClipboard(company.invite_code!, "Invite code")}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Pending Approvals Section - Admin only */}
        {isAdmin && pendingUsers.length > 0 && (
          <Card className="border-amber-200 dark:border-amber-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <Clock className="h-5 w-5" />
                Pending Approvals ({pendingUsers.length})
              </CardTitle>
              <CardDescription>
                These users are waiting for approval to access the system
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead className="w-[150px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingUsers.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">{user.name}</TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <PrimaryRoleBadge role="Pending" />
                            <BusinessRoleLabel role={user.role} />
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-green-600 hover:text-green-700 hover:bg-green-50"
                              onClick={() => approveUser(user.id)}
                            >
                              <CheckCircle className="h-4 w-4 mr-1" />
                              Approve
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={() => rejectUser(user.id)}
                            >
                              <XCircle className="h-4 w-4 mr-1" />
                              Reject
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* All Users Section */}
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-foreground">Team Members</h2>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreateDialog}>
                <Plus className="mr-2 h-4 w-4" /> Add User
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingUser ? "Edit User" : "Add User"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <Select
                    value={formData.role}
                    onValueChange={(value: "Attorney" | "SupportStaff" | "Admin" | "Owner") =>
                      setFormData({ ...formData, role: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Owner">Owner</SelectItem>
                      <SelectItem value="Attorney">Attorney</SelectItem>
                      <SelectItem value="SupportStaff">Support Staff</SelectItem>
                      <SelectItem value="Admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="timezone">Timezone</Label>
                  <Input
                    id="timezone"
                    value={formData.timezone_default}
                    onChange={(e) => setFormData({ ...formData, timezone_default: e.target.value })}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="active"
                    checked={formData.active}
                    onCheckedChange={(checked) => setFormData({ ...formData, active: checked })}
                  />
                  <Label htmlFor="active">Active</Label>
                </div>
                <Button type="submit" className="w-full">
                  {editingUser ? "Update" : "Create"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="text-muted-foreground">Loading...</div>
        ) : (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      Role
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-5 w-5" 
                        onClick={() => setShowRoleHelp(true)}
                      >
                        <HelpCircle className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {approvedUsers.map((user) => {
                  const primaryRole = getPrimaryRoleLabel(
                    user.role === 'Admin' || user.role === 'Owner' ? 'admin' : 'staff',
                    user.role,
                    user.approved
                  );
                  const showBusinessRole = primaryRole !== 'Owner' && primaryRole !== 'Admin';
                  
                  return (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <PrimaryRoleBadge role={primaryRole} />
                          {showBusinessRole && <BusinessRoleLabel role={user.role} />}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge active={user.active} approved={user.approved} />
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => openEditDialog(user)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Role Help Modal */}
        <RoleHelpModal open={showRoleHelp} onOpenChange={setShowRoleHelp} />
      </div>
    </AdminLayout>
  );
}
