import { ROLE_PERMISSIONS, can, type RbacRole } from '@bisp/shared-rbac';

export interface ResolvedAuth {
  enabled: boolean;
  mode: 'none' | 'header';
  role: RbacRole;
}

export function resolveRole(headers: Record<string, unknown>): RbacRole {
  const raw = String(headers['x-bisp-role'] ?? 'admin');
  const role = raw as RbacRole;
  return role in ROLE_PERMISSIONS ? role : 'viewer';
}

export function resolveAuth(headers: Record<string, unknown>, mode: 'none' | 'header'): ResolvedAuth {
  return {
    enabled: mode === 'header',
    mode,
    role: resolveRole(headers),
  };
}

export function isAllowed(headers: Record<string, unknown>, mode: 'none' | 'header', permission: string): boolean {
  const auth = resolveAuth(headers, mode);
  if (!auth.enabled) return true;
  return can(auth.role, permission);
}
