import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

import type { ControlCenterSessionRecord, ControlCenterUserRecord, PostgresMirror } from './postgresMirror';
import type { RbacRole } from '@bisp/shared-rbac';

const HASH_PREFIX = 'scrypt.v1';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionPrincipal {
  token: string;
  role: RbacRole;
  user: Pick<ControlCenterUserRecord, 'id' | 'email' | 'fullName' | 'role' | 'status'>;
  expiresAt: string;
}

function toRole(role: string): RbacRole {
  const allowed: RbacRole[] = ['admin', 'manager', 'assist', 'sales', 'customer-care', 'content', 'viewer'];
  return allowed.includes(role as RbacRole) ? (role as RbacRole) : 'viewer';
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${HASH_PREFIX}$${salt}$${hash}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const [scheme, salt, expected] = encoded.split('$');
  if (scheme !== HASH_PREFIX || !salt || !expected) return false;
  const candidate = scryptSync(password, salt, 64);
  const stored = Buffer.from(expected, 'hex');
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

export function extractSessionToken(headers: Record<string, unknown>): string | null {
  const explicit = String(headers['x-bisp-session'] ?? '').trim();
  if (explicit) return explicit;
  const auth = String(headers.authorization ?? '').trim();
  if (!auth) return null;
  const match = auth.match(/^bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

export async function resolveSessionPrincipal(
  postgresMirror: PostgresMirror,
  headers: Record<string, unknown>,
): Promise<SessionPrincipal | null> {
  const token = extractSessionToken(headers);
  if (!token) return null;
  await postgresMirror.deleteExpiredControlCenterSessions();
  const session = await postgresMirror.getControlCenterSession(token);
  if (!session || !session.user || session.user.status !== 'active') return null;
  const expiresAtMs = Date.parse(session.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    await postgresMirror.deleteControlCenterSession(token);
    return null;
  }
  await postgresMirror.touchControlCenterSession(token, new Date().toISOString());
  return {
    token,
    role: toRole(session.user.role),
    user: {
      id: session.user.id,
      email: session.user.email,
      fullName: session.user.fullName,
      role: toRole(session.user.role),
      status: session.user.status,
    },
    expiresAt: session.expiresAt,
  };
}

export async function createSessionForUser(
  postgresMirror: PostgresMirror,
  user: ControlCenterUserRecord,
  headers: Record<string, unknown>,
): Promise<SessionPrincipal> {
  const token = randomBytes(32).toString('hex');
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await postgresMirror.saveControlCenterSession({
    token,
    userId: user.id,
    role: user.role,
    issuedAt,
    expiresAt,
    lastSeenAt: issuedAt,
    ip: String(headers['x-forwarded-for'] ?? headers['x-real-ip'] ?? '').trim() || undefined,
    userAgent: String(headers['user-agent'] ?? '').trim() || undefined,
  } satisfies ControlCenterSessionRecord);
  return {
    token,
    role: toRole(user.role),
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: toRole(user.role),
      status: user.status,
    },
    expiresAt,
  };
}

export function createControlCenterUser(input: {
  email: string;
  fullName: string;
  role: ControlCenterUserRecord['role'];
  password: string;
  status?: ControlCenterUserRecord['status'];
}): ControlCenterUserRecord {
  const now = new Date().toISOString();
  return {
    id: `ccu_${randomUUID().replace(/-/g, '')}`,
    email: input.email.trim().toLowerCase(),
    fullName: input.fullName.trim(),
    role: input.role,
    status: input.status ?? 'active',
    passwordHash: hashPassword(input.password),
    preferences: {},
    createdAt: now,
    updatedAt: now,
  };
}
