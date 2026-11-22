import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import { all, get, run } from './db.ts';
import { HttpError, type AppEnv, type Ctx, type SessionUser } from './http.ts';
import type { RoleGrant } from '../../shared/permissions.ts';

const COOKIE = 'mb_session';
const SESSION_DAYS = 14;

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, saltHex, hashHex] = stored.split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

export function loadPrincipal(userId: number): SessionUser | null {
  const u = get<{ id: number; name: string; email: string; active: number }>('SELECT id, name, email, active FROM users WHERE id = ?', userId);
  if (!u || !u.active) return null;
  const grants = all<RoleGrant>('SELECT role, venue FROM user_roles WHERE user_id = ?', userId);
  return { id: u.id, name: u.name, email: u.email, grants };
}

export function createSession(c: Ctx, userId: number): void {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', token, userId, expires.toISOString());
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIE !== '1',
    path: '/',
    expires,
  });
}

export function destroySession(c: Ctx): void {
  const token = getCookie(c, COOKIE);
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
  deleteCookie(c, COOKIE, { path: '/' });
}

/** Authenticates every /api request except the public auth endpoints; blocks cross-site writes. */
export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const path = c.req.path;
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('x-mb') !== '1') {
    throw new HttpError(403, 'בקשה חסומה', 'csrf');
  }
  if (path === '/api/auth/login' || path === '/api/auth/demo-users') return next();
  const token = getCookie(c, COOKIE);
  const s = token ? get<{ user_id: number; expires_at: string }>('SELECT user_id, expires_at FROM sessions WHERE token = ?', token) : undefined;
  if (!s || s.expires_at < new Date().toISOString()) throw new HttpError(401, 'נדרשת התחברות', 'unauthenticated');
  const user = loadPrincipal(s.user_id);
  if (!user) throw new HttpError(401, 'המשתמש אינו פעיל', 'unauthenticated');
  c.set('user', user);
  await next();
};
