const API_BASE_URL = (import.meta.env.VITE_API_URL as string) || "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: any;

  constructor(status: number, code: string, message: string, details?: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getToken(): string | null {
  return localStorage.getItem("newtonite_token");
}

export function setToken(token: string): void {
  localStorage.setItem("newtonite_token", token);
}

export function clearToken(): void {
  localStorage.removeItem("newtonite_token");
}

export function handleUnauthorized(): void {
  clearToken();
  if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?returnUrl=${returnUrl}`;
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  body?: any;
  headers?: Record<string, string>;
  idempotencyKey?: string;
}

export async function apiFetch<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, headers = {}, idempotencyKey } = options;

  const requestHeaders: Record<string, string> = {
    Accept: "application/json",
    ...headers,
  };

  if (body !== undefined && !(body instanceof FormData)) {
    requestHeaders["Content-Type"] = "application/json";
  }

  const token = getToken();
  if (token) {
    requestHeaders["Authorization"] = `Bearer ${token}`;
  }

  if (idempotencyKey) {
    requestHeaders["Idempotency-Key"] = idempotencyKey;
  }

  const url = endpoint.startsWith("http") ? endpoint : `${API_BASE_URL}${endpoint}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body !== undefined && !(body instanceof FormData) ? JSON.stringify(body) : body,
    });
  } catch (networkError: any) {
    // Network failures / timeouts (outcome unknown)
    throw new ApiError(
      0,
      "network_error",
      networkError.message || "Network request failed. We couldn't confirm this went through."
    );
  }

  // Handle 401 Unauthorized globally
  if (response.status === 401) {
    handleUnauthorized();
    throw new ApiError(401, "unauthenticated", "Session expired or invalid credentials");
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as unknown as T;
  }

  let data: any = null;
  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const errorCode = data?.error?.code || `HTTP_${response.status}`;
    const errorMessage = data?.error?.message || response.statusText || "An unexpected error occurred";
    const details = data?.error?.details;

    throw new ApiError(response.status, errorCode, errorMessage, details);
  }

  return data as T;
}
