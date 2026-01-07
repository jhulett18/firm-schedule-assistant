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
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type PairingPreset = Tables<"pairing_presets">;
type User = Tables<"users">;

export default function AdminPresets() {
  const [presets, setPresets] = useState<PairingPreset[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<PairingPreset | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    attorney_user_id: "",
    support_user_ids: [] as string[],
    active: true,
  });
  const { toast } = useToast();

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    const [presetsRes, usersRes] = await Promise.all([
      supabase.from("pairing_presets").select("*").order("name"),
      supabase.from("users").select("*").eq("active", true).order("name"),
    ]);

    if (presetsRes.error) {
      toast({ title: "Error fetching presets", description: presetsRes.error.message, variant: "destructive" });
    } else {
      setPresets(presetsRes.data || []);
    }

    if (usersRes.error) {
      toast({ title: "Error fetching users", description: usersRes.error.message, variant: "destructive" });
    } else {
      setUsers(usersRes.data || []);
    }
    setLoading(false);
  }

  const attorneys = users.filter((u) => u.role === "Attorney");
  const supportStaff = users.filter((u) => u.role === "SupportStaff" || u.role === "Admin");

  function getUserName(id: string) {
    return users.find((u) => u.id === id)?.name || "Unknown";
  }

  function openCreateDialog() {
    setEditingPreset(null);
    setFormData({ name: "", attorney_user_id: "", support_user_ids: [], active: true });
    setDialogOpen(true);
  }

  function openEditDialog(preset: PairingPreset) {
    setEditingPreset(preset);
    setFormData({
      name: preset.name,
      attorney_user_id: preset.attorney_user_id,
      support_user_ids: preset.support_user_ids,
      active: preset.active,
    });
    setDialogOpen(true);
  }

  function toggleSupportUser(userId: string) {
    setFormData((prev) => ({
      ...prev,
      support_user_ids: prev.support_user_ids.includes(userId)
        ? prev.support_user_ids.filter((id) => id !== userId)
        : [...prev.support_user_ids, userId],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (editingPreset) {
      const { error } = await supabase
        .from("pairing_presets")
        .update(formData)
        .eq("id", editingPreset.id);

      if (error) {
        toast({ title: "Error updating preset", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Preset updated" });
        setDialogOpen(false);
        fetchData();
      }
    } else {
      const { error } = await supabase.from("pairing_presets").insert(formData);

      if (error) {
        toast({ title: "Error creating preset", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Preset created" });
        setDialogOpen(false);
        fetchData();
      }
    }
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-foreground">Pairing Presets</h2>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreateDialog}>
                <Plus className="mr-2 h-4 w-4" /> Add Preset
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingPreset ? "Edit Preset" : "Add Preset"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Preset Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Jones + Intake Team"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="attorney">Host Attorney</Label>
                  <Select
                    value={formData.attorney_user_id}
                    onValueChange={(value) => setFormData({ ...formData, attorney_user_id: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select attorney" />
                    </SelectTrigger>
                    <SelectContent>
                      {attorneys.map((attorney) => (
                        <SelectItem key={attorney.id} value={attorney.id}>
                          {attorney.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Support Staff (select multiple)</Label>
                  <div className="flex flex-wrap gap-2">
                    {supportStaff.map((staff) => (
                      <Button
                        key={staff.id}
                        type="button"
                        variant={formData.support_user_ids.includes(staff.id) ? "default" : "outline"}
                        size="sm"
                        onClick={() => toggleSupportUser(staff.id)}
                      >
                        {staff.name}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="active"
                    checked={formData.active}
                    onCheckedChange={(checked) => setFormData({ ...formData, active: checked })}
                  />
                  <Label htmlFor="active">Active</Label>
                </div>
                <Button type="submit" className="w-full" disabled={!formData.attorney_user_id}>
                  {editingPreset ? "Update" : "Create"}
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
                  <TableHead>Attorney</TableHead>
                  <TableHead>Support Staff</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {presets.map((preset) => (
                  <TableRow key={preset.id}>
                    <TableCell className="font-medium">{preset.name}</TableCell>
                    <TableCell>{getUserName(preset.attorney_user_id)}</TableCell>
                    <TableCell>
                      {preset.support_user_ids.map((id) => getUserName(id)).join(", ") || "None"}
                    </TableCell>
                    <TableCell>
                      <span className={preset.active ? "text-green-600" : "text-muted-foreground"}>
                        {preset.active ? "Active" : "Inactive"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => openEditDialog(preset)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
