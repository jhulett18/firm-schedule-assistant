import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2, AlertTriangle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface DeleteAccountDialogProps {
  trigger?: React.ReactNode;
}

export function DeleteAccountDialog({ trigger }: DeleteAccountDialogProps) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const isConfirmed = confirmText === "DELETE";

  async function handleDelete() {
    if (!isConfirmed) return;

    setIsDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-account", {
        method: "POST",
      });

      if (error) {
        throw new Error(error.message || "Failed to delete account");
      }

      if (!data?.success) {
        throw new Error(data?.error || "Failed to delete account");
      }

      toast({
        title: "Account deleted",
        description: "Your account has been permanently deleted.",
      });

      // Sign out and redirect
      await signOut();
      navigate("/auth");
    } catch (err: any) {
      toast({
        title: "Error deleting account",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setConfirmText(""); }}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" className="justify-start gap-2 text-destructive hover:text-destructive">
            <Trash2 className="w-4 h-4" />
            Delete My Account
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Delete Your Account
          </DialogTitle>
          <DialogDescription className="text-left space-y-3 pt-2">
            <p>
              <strong>This action is permanent and cannot be undone.</strong>
            </p>
            <p>
              Deleting your account will:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-sm">
              <li>Remove your profile and all personal data</li>
              <li>Disconnect your calendar integrations</li>
              <li>Remove you from all meetings you created or are assigned to</li>
              <li>Delete all your notifications</li>
            </ul>
            <p className="text-sm">
              Meeting records will be preserved for audit purposes, but your name will be removed.
            </p>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Data export option */}
          <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
            <Download className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            <div className="text-sm">
              <p className="font-medium">Want to save your data first?</p>
              <p className="text-muted-foreground">
                Contact your administrator to request a data export before proceeding.
              </p>
            </div>
          </div>

          {/* Confirmation input */}
          <div className="space-y-2">
            <Label htmlFor="confirm-delete">
              Type <span className="font-mono font-bold text-destructive">DELETE</span> to confirm
            </Label>
            <Input
              id="confirm-delete"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type DELETE"
              className="font-mono"
              disabled={isDeleting}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={!isConfirmed || isDeleting}
          >
            {isDeleting ? "Deleting..." : "Delete My Account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
