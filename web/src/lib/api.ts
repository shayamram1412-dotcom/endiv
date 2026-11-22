/** Typed fetch wrapper. Errors carry Hebrew messages, field errors and concurrency conflicts from the server. */
import type { ApiErrorBody } from '@shared/types.ts';

export class ApiError extends Error {
  status: number;
  code: string;
  fields: Record<string, string>;
  conflicts: { field: string; yours: unknown; theirs: unknown }[];
  details: ApiErrorBody['details'] & Record<string, unknown>;
  constructor(status: number, b: ApiErrorBody) {
    super(b.error);
    this.status = status;
    this.code = b.code;
    this.details = (b.details ?? {}) as ApiError['details'];
    this.fields = b.details?.fields ?? {};
    this.conflicts = b.details?.conflicts ?? [];
  }
}

let onUnauthenticated: (() => void) | null = null;
export function setUnauthenticatedHandler(fn: () => void) {
  onUnauthenticated = fn;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'x-mb': '1' } : {}),
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: 'אין חיבור לשרת. בדוק את החיבור ונסה שוב – מה שהקלדת נשמר במסך.', code: 'network' });
  }
  if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthenticated?.();
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data ?? { error: 'שגיאה לא צפויה', code: 'unknown' });
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T = unknown>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T = unknown>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T = unknown>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T = unknown>(path: string) => request<T>('DELETE', path),
  upload: <T = unknown>(path: string, form: FormData) => request<T>('POST', path, form),
};

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
