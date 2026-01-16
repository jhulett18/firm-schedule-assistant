import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Check, X } from "lucide-react";
import { PrimaryRoleBadge } from "@/components/ui/role-badge";

interface RoleHelpModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const accessMatrix = [
  { role: "Owner" as const, dashboard: true, createBookings: true, viewAllBookings: true, adminSettings: true, userManagement: true },
  { role: "Admin" as const, dashboard: true, createBookings: true, viewAllBookings: true, adminSettings: true, userManagement: true },
  { role: "Staff" as const, dashboard: true, createBookings: true, viewAllBookings: false, adminSettings: false, userManagement: false },
  { role: "Client" as const, dashboard: false, createBookings: false, viewAllBookings: false, adminSettings: false, userManagement: false },
];

function AccessIcon({ allowed }: { allowed: boolean }) {
  return allowed ? (
    <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
  ) : (
    <X className="h-4 w-4 text-muted-foreground" />
  );
}

export function RoleHelpModal({ open, onOpenChange }: RoleHelpModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Understanding Roles & Access</DialogTitle>
          <DialogDescription>
            Learn what each role can access in the system
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Access Matrix Table */}
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Role</TableHead>
                  <TableHead className="text-center">Dashboard</TableHead>
                  <TableHead className="text-center">Create Bookings</TableHead>
                  <TableHead className="text-center">View All Bookings</TableHead>
                  <TableHead className="text-center">Admin Settings</TableHead>
                  <TableHead className="text-center">User Management</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accessMatrix.map((row) => (
                  <TableRow key={row.role}>
                    <TableCell>
                      <PrimaryRoleBadge role={row.role} />
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex justify-center">
                        <AccessIcon allowed={row.dashboard} />
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex justify-center">
                        <AccessIcon allowed={row.createBookings} />
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex justify-center">
                        <AccessIcon allowed={row.viewAllBookings} />
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex justify-center">
                        <AccessIcon allowed={row.adminSettings} />
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex justify-center">
                        <AccessIcon allowed={row.userManagement} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Role Descriptions */}
          <div className="space-y-4">
            <h4 className="font-semibold text-sm">Role Descriptions</h4>
            
            <div className="grid gap-3">
              <div className="flex gap-3 items-start">
                <PrimaryRoleBadge role="Owner" className="mt-0.5" />
                <p className="text-sm text-muted-foreground">
                  Company owner with full system access. Can manage all settings, users, and view all data.
                </p>
              </div>
              
              <div className="flex gap-3 items-start">
                <PrimaryRoleBadge role="Admin" className="mt-0.5" />
                <p className="text-sm text-muted-foreground">
                  System administrator with full access to settings and user management.
                </p>
              </div>
              
              <div className="flex gap-3 items-start">
                <PrimaryRoleBadge role="Staff" className="mt-0.5" />
                <p className="text-sm text-muted-foreground">
                  Internal team members (Attorneys, Support Staff) who can create booking requests and manage their own work. Cannot access admin areas.
                </p>
              </div>
              
              <div className="flex gap-3 items-start">
                <PrimaryRoleBadge role="Client" className="mt-0.5" />
                <p className="text-sm text-muted-foreground">
                  External users who access the client portal to view their bookings and select meeting times.
                </p>
              </div>
            </div>
          </div>

          {/* Business Roles Note */}
          <div className="rounded-lg bg-muted/50 p-4">
            <h4 className="font-semibold text-sm mb-2">Business Roles</h4>
            <p className="text-sm text-muted-foreground">
              Staff members may also have a business role (<span className="font-medium">Owner</span>, <span className="font-medium">Admin</span>, <span className="font-medium">Attorney</span>, <span className="font-medium">Support Staff</span>) which determines their function within your organization. This is separate from their system access level.
            </p>
          </div>

          {/* Pending Approval Note */}
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10 p-4">
            <div className="flex items-center gap-2 mb-2">
              <PrimaryRoleBadge role="Pending" />
              <span className="font-semibold text-sm">Pending Approval</span>
            </div>
            <p className="text-sm text-muted-foreground">
              New users who have signed up are placed in a pending state until an administrator approves their account. They cannot access the system until approved.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
