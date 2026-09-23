// Empty (production default) means "same origin as the page, under the app's own base path" —
// nginx reverse-proxies <base>api to the api container (see apps/web/nginx.conf), matching
// wherever the SPA itself is served (import.meta.env.BASE_URL — see vite.config.ts), so the
// frontend never needs to know its own public host/IP or panel path at build time twice.
// Local dev sets VITE_API_URL explicitly since there's no proxy there.
const API_URL = import.meta.env.VITE_API_URL || `${import.meta.env.BASE_URL}api`;

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof body?.error === "string" ? body.error : res.statusText;
    throw new ApiError(res.status, message, typeof body?.code === "string" ? body.code : undefined);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "POST", body: data !== undefined ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PUT", body: data !== undefined ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

/**
 * POST that survives the API's "server is out of disk/RAM" pre-flight (409 server_overloaded): asks
 * the user once and, if they insist, repeats the request with ?force=true.
 */
export async function postConfirmingOverload<T>(path: string, data?: unknown): Promise<T> {
  try {
    return await api.post<T>(path, data);
  } catch (err) {
    if (err instanceof ApiError && err.code === "server_overloaded" && window.confirm(`${err.message}

Continuar mesmo assim?`)) {
      return api.post<T>(`${path}${path.includes("?") ? "&" : "?"}force=true`, data);
    }
    throw err;
  }
}
