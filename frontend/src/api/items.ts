import { apiFetch } from "./client";
import {
  Item,
  ItemListResponse,
  EventListResponse,
  ActivityEvent,
  DashboardSummaryResponse,
  NotificationListResponse,
  TeamMember,
} from "./types";

export interface ItemsFilterParams {
  view?: string;
  team_id?: number | null;
  types?: string[];
  statuses?: string[];
  priorities?: string[];
  assignee?: string;
  q?: string;
  sort?: string;
  cursor?: string | null;
  limit?: number;
}

export function buildItemsQueryString(params: ItemsFilterParams, cursor?: string | null): string {
  const query = new URLSearchParams();

  if (params.view && params.view !== "all") {
    query.set("view", params.view);
  } else {
    query.set("view", "all");
  }

  if (params.team_id !== undefined && params.team_id !== null) {
    query.set("team_id", String(params.team_id));
  }

  if (params.types && params.types.length > 0) {
    params.types.forEach((t) => query.append("type", t));
  }

  if (params.statuses && params.statuses.length > 0) {
    params.statuses.forEach((s) => query.append("status", s));
  }

  if (params.priorities && params.priorities.length > 0) {
    params.priorities.forEach((p) => query.append("priority", p));
  }

  if (params.assignee) {
    query.set("assignee", params.assignee);
  }

  if (params.q && params.q.trim()) {
    query.set("q", params.q.trim());
  }

  if (params.sort) {
    query.set("sort", params.sort);
  }

  const effectiveCursor = cursor !== undefined ? cursor : params.cursor;
  if (effectiveCursor) {
    query.set("cursor", effectiveCursor);
  }

  if (params.limit) {
    query.set("limit", String(params.limit));
  }

  const qs = query.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchItems(params: ItemsFilterParams, cursor?: string | null): Promise<ItemListResponse> {
  const qs = buildItemsQueryString(params, cursor);
  return apiFetch<ItemListResponse>(`/items${qs}`);
}

export async function fetchItem(id: number): Promise<Item> {
  return apiFetch<Item>(`/items/${id}`);
}

export interface CreateItemPayload {
  team_id: number;
  title: string;
  description: string;
  type: string;
  priority: string;
  requires_approval?: boolean;
  due_at?: string | null;
}

export async function createItem(payload: CreateItemPayload, idempotencyKey: string): Promise<Item> {
  return apiFetch<Item>("/items", {
    method: "POST",
    body: payload,
    idempotencyKey,
  });
}

export interface PatchItemPayload {
  expected_version: number;
  title?: string;
  description?: string;
  priority?: string;
  due_at?: string | null;
}

export async function patchItem(id: number, payload: PatchItemPayload): Promise<Item> {
  return apiFetch<Item>(`/items/${id}`, {
    method: "PATCH",
    body: payload,
  });
}

export async function claimItem(id: number, idempotencyKey: string): Promise<Item> {
  return apiFetch<Item>(`/items/${id}/claim`, {
    method: "POST",
    body: {},
    idempotencyKey,
  });
}

export async function releaseItem(id: number, expectedVersion: number, idempotencyKey: string): Promise<Item> {
  return apiFetch<Item>(`/items/${id}/release`, {
    method: "POST",
    body: { expected_version: expectedVersion },
    idempotencyKey,
  });
}

export async function assignItem(
  id: number,
  assigneeId: number | null,
  expectedVersion: number,
  idempotencyKey: string
): Promise<Item> {
  return apiFetch<Item>(`/items/${id}/assign`, {
    method: "POST",
    body: { assignee_id: assigneeId, expected_version: expectedVersion },
    idempotencyKey,
  });
}

export async function transitionItem(
  id: number,
  toStatus: string,
  expectedVersion: number,
  reason?: string,
  idempotencyKey?: string
): Promise<Item> {
  const body: any = { to_status: toStatus, expected_version: expectedVersion };
  if (reason) body.reason = reason;

  return apiFetch<Item>(`/items/${id}/transition`, {
    method: "POST",
    body,
    idempotencyKey,
  });
}

export async function addComment(id: number, body: string, idempotencyKey: string): Promise<ActivityEvent> {
  return apiFetch<ActivityEvent>(`/items/${id}/comments`, {
    method: "POST",
    body: { body },
    idempotencyKey,
  });
}

export async function fetchActivity(
  id: number,
  cursor?: string | null,
  limit: number = 20,
  order: "desc" | "asc" = "desc"
): Promise<EventListResponse> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  params.set("limit", String(limit));
  params.set("order", order);
  return apiFetch<EventListResponse>(`/items/${id}/activity?${params.toString()}`);
}

export async function fetchTeamMembers(teamId: number): Promise<TeamMember[]> {
  return apiFetch<TeamMember[]>(`/teams/${teamId}/members`);
}

export async function fetchDashboardSummary(): Promise<DashboardSummaryResponse> {
  return apiFetch<DashboardSummaryResponse>("/dashboard/summary");
}

export async function fetchNotifications(unreadOnly: boolean = false, cursor?: string | null): Promise<NotificationListResponse> {
  const params = new URLSearchParams();
  if (unreadOnly) params.set("unread_only", "true");
  if (cursor) params.set("cursor", cursor);
  return apiFetch<NotificationListResponse>(`/notifications?${params.toString()}`);
}

export async function fetchUnreadNotificationCount(): Promise<{ count: number }> {
  return apiFetch<{ count: number }>("/notifications/unread-count");
}

export async function markNotificationRead(id: number): Promise<void> {
  return apiFetch<void>(`/notifications/${id}/read`, { method: "POST" });
}

export async function markAllNotificationsRead(): Promise<void> {
  return apiFetch<void>("/notifications/read-all", { method: "POST" });
}
