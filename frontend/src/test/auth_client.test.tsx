import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiFetch, setToken, getToken, clearToken, ApiError } from "../api/client";

describe("API Client & Auth Error Handling", () => {
  beforeEach(() => {
    clearToken();
    vi.restoreAllMocks();
  });

  it("attaches Authorization header when token is present", async () => {
    setToken("test-jwt-token-123");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ status: "ok" }),
    });
    global.fetch = mockFetch;

    await apiFetch("/test-endpoint");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/test-endpoint",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-jwt-token-123",
        }),
      })
    );
  });

  it("attaches Idempotency-Key header when idempotencyKey option is provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ id: 1 }),
    });
    global.fetch = mockFetch;

    await apiFetch("/items", {
      method: "POST",
      body: { title: "Test" },
      idempotencyKey: "11111111-2222-3333-4444-555555555555",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/items",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key": "11111111-2222-3333-4444-555555555555",
        }),
      })
    );
  });

  it("test requirement 7: a 401 clears the session and throws unauthenticated ApiError", async () => {
    setToken("expired-token");
    expect(getToken()).toBe("expired-token");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        error: {
          code: "unauthenticated",
          message: "Session expired or invalid credentials",
        },
      }),
    });
    global.fetch = mockFetch;

    await expect(apiFetch("/me")).rejects.toThrow(ApiError);

    // Verify token was cleared from localStorage
    expect(getToken()).toBeNull();
  });

  it("normalizes non-2xx error envelope into ApiError with status, code, message, and details", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        error: {
          code: "already_claimed",
          message: "Work item has already been claimed",
          details: { current: { id: 142, assignee: { id: 4, name: "Maya" } } },
        },
      }),
    });
    global.fetch = mockFetch;

    try {
      await apiFetch("/items/142/claim", { method: "POST" });
      expect.unreachable();
    } catch (err: any) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err.status).toBe(409);
      expect(err.code).toBe("already_claimed");
      expect(err.message).toBe("Work item has already been claimed");
      expect(err.details.current.id).toBe(142);
    }
  });
});
