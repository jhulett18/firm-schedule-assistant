import { useState, useEffect } from "react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type Room = Tables<"rooms">;

export default function AdminRooms() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    resource_email: "",
    active: true,
  });
  const { toast } = useToast();

  useEffect(() => {
    fetchRooms();
  }, []);

  async function fetchRooms() {
    const { data, error } = await supabase
      .from("rooms")
      .select("*")
      .order("name");
    
    if (error) {
      toast({ title: "Error fetching rooms", description: error.message, variant: "destructive" });
    } else {
      setRooms(data || []);
    }
    setLoading(false);
  }

  function openCreateDialog() {
    setEditingRoom(null);
    setFormData({ name: "", resource_email: "", active: true });
    setDialogOpen(true);
  }

  function openEditDialog(room: Room) {
    setEditingRoom(room);
    setFormData({
      name: room.name,
      resource_email: room.resource_email,
      active: room.active,
    });
    setDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    if (editingRoom) {
      const { error } = await supabase
        .from("rooms")
        .update(formData)
        .eq("id", editingRoom.id);
      
      if (error) {
        toast({ title: "Error updating room", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Room updated" });
        setDialogOpen(false);
        fetchRooms();
      }
    } else {
      const { error } = await supabase.from("rooms").insert(formData);
      
      if (error) {
        toast({ title: "Error creating room", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Room created" });
        setDialogOpen(false);
        fetchRooms();
      }
    }
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-foreground">Rooms</h2>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreateDialog}>
                <Plus className="mr-2 h-4 w-4" /> Add Room
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingRoom ? "Edit Room" : "Add Room"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Room Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Conference Room A"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="resource_email">Resource Email (M365)</Label>
                  <Input
                    id="resource_email"
                    type="email"
                    value={formData.resource_email}
                    onChange={(e) => setFormData({ ...formData, resource_email: e.target.value })}
                    placeholder="conf-room-a@firm.com"
                    required
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
                  {editingRoom ? "Update" : "Create"}
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
                  <TableHead>Resource Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rooms.map((room) => (
                  <TableRow key={room.id}>
                    <TableCell className="font-medium">{room.name}</TableCell>
                    <TableCell>{room.resource_email}</TableCell>
                    <TableCell>
                      <span className={room.active ? "text-green-600" : "text-muted-foreground"}>
                        {room.active ? "Active" : "Inactive"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => openEditDialog(room)}>
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
