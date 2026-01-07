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

type SchedulerMapping = Tables<"scheduler_mappings">;
type MeetingType = Tables<"meeting_types">;
type User = Tables<"users">;
type Room = Tables<"rooms">;

const DURATION_OPTIONS = [30, 60, 90, 120];

export default function AdminSchedulerMapping() {
  const [mappings, setMappings] = useState<SchedulerMapping[]>([]);
  const [meetingTypes, setMeetingTypes] = useState<MeetingType[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMapping, setEditingMapping] = useState<SchedulerMapping | null>(null);
  const [formData, setFormData] = useState({
    meeting_type_id: "",
    duration_minutes: 60,
    host_attorney_user_id: "",
    location_mode: "Zoom" as "Zoom" | "InPerson",
    room_id: null as string | null,
    lawmatics_scheduler_id: "",
    booking_link_template: "",
    active: true,
  });
  const { toast } = useToast();

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    const [mappingsRes, typesRes, usersRes, roomsRes] = await Promise.all([
      supabase.from("scheduler_mappings").select("*").order("created_at", { ascending: false }),
      supabase.from("meeting_types").select("*").eq("active", true).order("name"),
      supabase.from("users").select("*").eq("active", true).eq("role", "Attorney").order("name"),
      supabase.from("rooms").select("*").eq("active", true).order("name"),
    ]);

    if (mappingsRes.error) {
      toast({ title: "Error fetching mappings", description: mappingsRes.error.message, variant: "destructive" });
    } else {
      setMappings(mappingsRes.data || []);
    }
    setMeetingTypes(typesRes.data || []);
    setUsers(usersRes.data || []);
    setRooms(roomsRes.data || []);
    setLoading(false);
  }

  function getMeetingTypeName(id: string) {
    return meetingTypes.find((t) => t.id === id)?.name || "Unknown";
  }

  function getUserName(id: string) {
    return users.find((u) => u.id === id)?.name || "Unknown";
  }

  function getRoomName(id: string | null) {
    if (!id) return "—";
    return rooms.find((r) => r.id === id)?.name || "Unknown";
  }

  function openCreateDialog() {
    setEditingMapping(null);
    setFormData({
      meeting_type_id: "",
      duration_minutes: 60,
      host_attorney_user_id: "",
      location_mode: "Zoom",
      room_id: null,
      lawmatics_scheduler_id: "",
      booking_link_template: "",
      active: true,
    });
    setDialogOpen(true);
  }

  function openEditDialog(mapping: SchedulerMapping) {
    setEditingMapping(mapping);
    setFormData({
      meeting_type_id: mapping.meeting_type_id,
      duration_minutes: mapping.duration_minutes,
      host_attorney_user_id: mapping.host_attorney_user_id,
      location_mode: mapping.location_mode,
      room_id: mapping.room_id,
      lawmatics_scheduler_id: mapping.lawmatics_scheduler_id || "",
      booking_link_template: mapping.booking_link_template || "",
      active: mapping.active,
    });
    setDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const payload = {
      ...formData,
      lawmatics_scheduler_id: formData.lawmatics_scheduler_id || null,
      booking_link_template: formData.booking_link_template || null,
    };

    if (editingMapping) {
      const { error } = await supabase
        .from("scheduler_mappings")
        .update(payload)
        .eq("id", editingMapping.id);

      if (error) {
        toast({ title: "Error updating mapping", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Mapping updated" });
        setDialogOpen(false);
        fetchData();
      }
    } else {
      const { error } = await supabase.from("scheduler_mappings").insert(payload);

      if (error) {
        toast({ title: "Error creating mapping", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Mapping created" });
        setDialogOpen(false);
        fetchData();
      }
    }
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Scheduler Mapping</h2>
            <p className="text-sm text-muted-foreground">
              Map meeting configurations to Lawmatics scheduler IDs or booking links
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreateDialog}>
                <Plus className="mr-2 h-4 w-4" /> Add Mapping
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{editingMapping ? "Edit Mapping" : "Add Mapping"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Meeting Type</Label>
                    <Select
                      value={formData.meeting_type_id}
                      onValueChange={(value) => setFormData({ ...formData, meeting_type_id: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        {meetingTypes.map((type) => (
                          <SelectItem key={type.id} value={type.id}>
                            {type.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Duration</Label>
                    <Select
                      value={String(formData.duration_minutes)}
                      onValueChange={(value) => setFormData({ ...formData, duration_minutes: Number(value) })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DURATION_OPTIONS.map((d) => (
                          <SelectItem key={d} value={String(d)}>
                            {d} min
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Host Attorney</Label>
                  <Select
                    value={formData.host_attorney_user_id}
                    onValueChange={(value) => setFormData({ ...formData, host_attorney_user_id: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select attorney" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Location Mode</Label>
                    <Select
                      value={formData.location_mode}
                      onValueChange={(value: "Zoom" | "InPerson") =>
                        setFormData({ ...formData, location_mode: value, room_id: value === "Zoom" ? null : formData.room_id })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Zoom">Zoom</SelectItem>
                        <SelectItem value="InPerson">In-Person</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {formData.location_mode === "InPerson" && (
                    <div className="space-y-2">
                      <Label>Room (optional)</Label>
                      <Select
                        value={formData.room_id || "none"}
                        onValueChange={(value) => setFormData({ ...formData, room_id: value === "none" ? null : value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Attorney Office</SelectItem>
                          {rooms.map((room) => (
                            <SelectItem key={room.id} value={room.id}>
                              {room.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lawmatics_id">Lawmatics Scheduler ID</Label>
                  <Input
                    id="lawmatics_id"
                    value={formData.lawmatics_scheduler_id}
                    onChange={(e) => setFormData({ ...formData, lawmatics_scheduler_id: e.target.value })}
                    placeholder="abc123..."
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="booking_link">Booking Link Template</Label>
                  <Input
                    id="booking_link"
                    value={formData.booking_link_template}
                    onChange={(e) => setFormData({ ...formData, booking_link_template: e.target.value })}
                    placeholder="https://scheduler.lawmatics.com/..."
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
                <Button
                  type="submit"
                  className="w-full"
                  disabled={!formData.meeting_type_id || !formData.host_attorney_user_id}
                >
                  {editingMapping ? "Update" : "Create"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="text-muted-foreground">Loading...</div>
        ) : (
          <div className="rounded-lg border border-border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Meeting Type</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Attorney</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Room</TableHead>
                  <TableHead>Lawmatics ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mappings.map((mapping) => (
                  <TableRow key={mapping.id}>
                    <TableCell className="font-medium">{getMeetingTypeName(mapping.meeting_type_id)}</TableCell>
                    <TableCell>{mapping.duration_minutes} min</TableCell>
                    <TableCell>{getUserName(mapping.host_attorney_user_id)}</TableCell>
                    <TableCell>{mapping.location_mode}</TableCell>
                    <TableCell>{getRoomName(mapping.room_id)}</TableCell>
                    <TableCell className="max-w-[150px] truncate">
                      {mapping.lawmatics_scheduler_id || "—"}
                    </TableCell>
                    <TableCell>
                      <span className={mapping.active ? "text-green-600" : "text-muted-foreground"}>
                        {mapping.active ? "Active" : "Inactive"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => openEditDialog(mapping)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {mappings.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No mappings configured yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
