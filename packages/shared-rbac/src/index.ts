export type RbacRole = 'admin' | 'manager' | 'assist' | 'sales' | 'customer-care' | 'content' | 'viewer';

export const ROLE_PERMISSIONS: Record<RbacRole, string[]> = {
  admin: ['*'],
  manager: ['objectives:write', 'outbox:approve', 'kpi:read', 'campaigns:manage', 'settings:write'],
  assist: ['assist:read', 'assist:write', 'customers:lookup'],
  sales: ['consult:read', 'tasks:read', 'tasks:update'],
  'customer-care': ['inbound:read', 'tasks:read', 'tasks:update'],
  content: ['campaigns:read', 'outbox:read', 'content:write'],
  viewer: ['kpi:read', 'tasks:read', 'outbox:read'],
};

export function can(role: RbacRole, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[role] ?? [];
  return perms.includes('*') || perms.includes(permission);
}
