import { Badge } from "@/components/ui/badge";
import { PrimaryRoleLabel, formatBusinessRole } from "@/lib/roles";
import { cn } from "@/lib/utils";

interface PrimaryRoleBadgeProps {
  role: PrimaryRoleLabel;
  className?: string;
}

const roleColors: Record<PrimaryRoleLabel, string> = {
  Owner: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 border-purple-200 dark:border-purple-800",
  Admin: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  Staff: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-green-200 dark:border-green-800",
  Client: "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300 border-slate-200 dark:border-slate-800",
  Pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800",
};

export function PrimaryRoleBadge({ role, className }: PrimaryRoleBadgeProps) {
  return (
    <Badge 
      variant="outline" 
      className={cn(roleColors[role], "font-medium", className)}
    >
      {role}
    </Badge>
  );
}

interface StatusBadgeProps {
  active: boolean;
  approved: boolean | null;
  className?: string;
}

export function StatusBadge({ active, approved, className }: StatusBadgeProps) {
  if (!approved) {
    return (
      <Badge 
        variant="outline" 
        className={cn(
          "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800",
          className
        )}
      >
        Pending Approval
      </Badge>
    );
  }
  
  if (!active) {
    return (
      <Badge 
        variant="outline" 
        className={cn(
          "bg-slate-100 text-slate-500 dark:bg-slate-900/30 dark:text-slate-400 border-slate-200 dark:border-slate-700",
          className
        )}
      >
        Inactive
      </Badge>
    );
  }
  
  return (
    <Badge 
      variant="outline" 
      className={cn(
        "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-green-200 dark:border-green-800",
        className
      )}
    >
      Active
    </Badge>
  );
}

interface BusinessRoleLabelProps {
  role: string;
  className?: string;
}

export function BusinessRoleLabel({ role, className }: BusinessRoleLabelProps) {
  return (
    <span className={cn("text-xs text-muted-foreground", className)}>
      {formatBusinessRole(role)}
    </span>
  );
}
