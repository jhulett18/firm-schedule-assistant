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

type MeetingType = Tables<"meeting_types">;

export default function AdminMeetingTypes() {
  const [meetingTypes, setMeetingTypes] = useState<MeetingType[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState<MeetingType | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    allowed_location_modes: "Either" as "Zoom" | "InPerson" | "Either",
    title_template: "{Meeting Type} – {Client Last Name} – {Attorney Name}",
    active: true,
  });
  const { toast } = useToast();

  useEffect(() => {
    fetchMeetingTypes();
  }, []);

  async function fetchMeetingTypes() {
    const { data, error } = await supabase
      .from("meeting_types")
      .select("*")
      .order("name");
    
    if (error) {
      toast({ title: "Error fetching meeting types", description: error.message, variant: "destructive" });
    } else {
      setMeetingTypes(data || []);
    }
    setLoading(false);
  }

  function openCreateDialog() {
    setEditingType(null);
    setFormData({
      name: "",
      allowed_location_modes: "Either",
      title_template: "{Meeting Type} – {Client Last Name} – {Attorney Name}",
      active: true,
    });
    setDialogOpen(true);
  }

  function openEditDialog(type: MeetingType) {
    setEditingType(type);
    setFormData({
      name: type.name,
      allowed_location_modes: type.allowed_location_modes,
      title_template: type.title_template,
      active: type.active,
    });
    setDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    if (editingType) {
      const { error } = await supabase
        .from("meeting_types")
        .update(formData)
        .eq("id", editingType.id);
      
      if (error) {
        toast({ title: "Error updating meeting type", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Meeting type updated" });
        setDialogOpen(false);
        fetchMeetingTypes();
      }
    } else {
      const { error } = await supabase.from("meeting_types").insert(formData);
      
      if (error) {
        toast({ title: "Error creating meeting type", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Meeting type created" });
        setDialogOpen(false);
        fetchMeetingTypes();
      }
    }
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-foreground">Meeting Types</h2>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreateDialog}>
                <Plus className="mr-2 h-4 w-4" /> Add Meeting Type
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingType ? "Edit Meeting Type" : "Add Meeting Type"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Initial Consultation"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="location_modes">Allowed Location Modes</Label>
                  <Select
                    value={formData.allowed_location_modes}
                    onValueChange={(value: "Zoom" | "InPerson" | "Either") =>
                      setFormData({ ...formData, allowed_location_modes: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Zoom">Zoom Only</SelectItem>
                      <SelectItem value="InPerson">In-Person Only</SelectItem>
                      <SelectItem value="Either">Either</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="title_template">Title Template</Label>
                  <Input
                    id="title_template"
                    value={formData.title_template}
                    onChange={(e) => setFormData({ ...formData, title_template: e.target.value })}
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
                  {editingType ? "Update" : "Create"}
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
                  <TableHead>Location Modes</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {meetingTypes.map((type) => (
                  <TableRow key={type.id}>
                    <TableCell className="font-medium">{type.name}</TableCell>
                    <TableCell>{type.allowed_location_modes}</TableCell>
                    <TableCell>
                      <span className={type.active ? "text-green-600" : "text-muted-foreground"}>
                        {type.active ? "Active" : "Inactive"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => openEditDialog(type)}>
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
