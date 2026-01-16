// Role utility functions for deriving display labels from security + business roles

export type SecurityRole = 'admin' | 'staff' | 'client' | null;
export type BusinessRole = 'Owner' | 'Admin' | 'Attorney' | 'SupportStaff';
export type PrimaryRoleLabel = 'Owner' | 'Admin' | 'Staff' | 'Client' | 'Pending';

/**
 * Derive a unified primary role label from security role + business role + approval status
 */
export function getPrimaryRoleLabel(
  securityRole: SecurityRole,
  businessRole: BusinessRole | null,
  approved: boolean | null
): PrimaryRoleLabel {
  // Pending takes priority if not approved
  if (approved === false || approved === null) return 'Pending';
  
  // Owner business role takes highest priority
  if (businessRole === 'Owner') return 'Owner';
  
  // Admin security role or Admin business role
  if (securityRole === 'admin' || businessRole === 'Admin') return 'Admin';
  
  // Staff security role (includes Attorney, SupportStaff)
  if (securityRole === 'staff') return 'Staff';
  
  // Client role
  if (securityRole === 'client') return 'Client';
  
  // Default for internal users
  return 'Staff';
}

/**
 * Format business role for display (e.g., "SupportStaff" -> "Support Staff")
 */
export function formatBusinessRole(role: BusinessRole | string): string {
  if (role === 'SupportStaff') return 'Support Staff';
  return role;
}

/**
 * Get color class for primary role badge
 */
export function getRoleBadgeVariant(role: PrimaryRoleLabel): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (role) {
    case 'Owner':
    case 'Admin':
      return 'default';
    case 'Staff':
      return 'secondary';
    case 'Client':
      return 'outline';
    case 'Pending':
      return 'destructive';
    default:
      return 'outline';
  }
}
