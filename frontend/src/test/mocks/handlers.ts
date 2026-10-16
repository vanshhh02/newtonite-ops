import { http, HttpResponse } from "msw";
import { Item, ItemSummary } from "../../api/types";

export const mockUser = {
  id: 1,
  name: "Maya Chen",
  email: "lead.core@newtonite.local",
};

export const mockMemberships = [
  {
    team_id: 1,
    team_name: "Core Platform",
    role: "lead",
  },
];

export const mockItem: Item = {
  id: 101,
  key: "OPS-101",
  team_id: 1,
  team_name: "Core Platform",
  title: "Database connection pool exhaustion",
  description: "Postgres primary max_connections reached 500 under heavy load.",
  type: "incident",
  status: "open",
  priority: "urgent",
  assignee: null,
  created_by: { id: 2, name: "Jordan Patel" },
  requires_approval: false,
  due_at: "2026-10-20T10:00:00Z",
  version: 1,
  created_at: "2026-10-16T12:00:00Z",
  updated_at: "2026-10-16T12:00:00Z",
  last_activity_at: "2026-10-16T12:00:00Z",
  allowed_actions: ["claim", "assign", "edit", "change_priority", "comment", "transition:in_progress"],
};

export let activeMockItem: Item = { ...mockItem };

export function resetActiveMockItem() {
  activeMockItem = { ...mockItem };
}

export function setActiveMockItem(updated: Partial<Item>) {
  activeMockItem = { ...activeMockItem, ...updated };
}

export const handlers = [
  // GET /me
  http.get("http://localhost:8000/me", () => {
    return HttpResponse.json({
      user: mockUser,
      memberships: mockMemberships,
    });
  }),

  // GET /items
  http.get("http://localhost:8000/items", ({ request }) => {
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");

    // Page 2 request
    if (cursor === "cursor_page_2") {
      const page2Items: ItemSummary[] = [
        {
          id: 103,
          key: "OPS-103",
          team_id: 1,
          team_name: "Core Platform",
          title: "Memory leak in background worker",
          type: "incident",
          status: "open",
          priority: "high",
          assignee: null,
          created_by: { id: 1, name: "Maya Chen" },
          requires_approval: false,
          due_at: null,
          version: 1,
          created_at: "2026-10-16T10:00:00Z",
          updated_at: "2026-10-16T10:00:00Z",
          last_activity_at: "2026-10-16T10:00:00Z",
        },
      ];
      return HttpResponse.json({
        items: page2Items,
        next_cursor: null,
      });
    }

    // Page 1
    const items: ItemSummary[] = [
      {
        id: 101,
        key: "OPS-101",
        team_id: 1,
        team_name: "Core Platform",
        title: "Database connection pool exhaustion",
        type: "incident",
        status: "open",
        priority: "urgent",
        assignee: null,
        created_by: { id: 2, name: "Jordan Patel" },
        requires_approval: false,
        due_at: "2026-10-20T10:00:00Z",
        version: 1,
        created_at: "2026-10-16T12:00:00Z",
        updated_at: "2026-10-16T12:00:00Z",
        last_activity_at: "2026-10-16T12:00:00Z",
      },
      {
        id: 102,
        key: "OPS-102",
        team_id: 1,
        team_name: "Core Platform",
        title: "Stripe payout webhook latency spike",
        type: "payment",
        status: "in_progress",
        priority: "high",
        assignee: { id: 1, name: "Maya Chen" },
        created_by: { id: 2, name: "Jordan Patel" },
        requires_approval: true,
        due_at: "2026-10-15T12:00:00Z", // overdue
        version: 2,
        created_at: "2026-10-14T08:00:00Z",
        updated_at: "2026-10-16T11:00:00Z",
        last_activity_at: "2026-10-16T11:00:00Z",
      },
    ];

    return HttpResponse.json({
      items,
      next_cursor: "cursor_page_2",
    });
  }),

  // GET /items/:id
  http.get("http://localhost:8000/items/:id", ({ params }) => {
    return HttpResponse.json({
      ...activeMockItem,
      id: Number(params.id),
      key: `OPS-${params.id}`,
    });
  }),

  // GET /items/:id/activity
  http.get("http://localhost:8000/items/:id/activity", () => {
    return HttpResponse.json({
      events: [
        {
          id: 501,
          item_id: 101,
          type: "created",
          actor: { id: 2, name: "Jordan Patel" },
          payload: { initial_status: "open" },
          created_at: "2026-10-16T12:00:00Z",
        },
      ],
      next_cursor: null,
    });
  }),

  // GET /teams/:id/members
  http.get("http://localhost:8000/teams/:id/members", () => {
    return HttpResponse.json([
      { user_id: 1, name: "Maya Chen", role: "lead" },
      { user_id: 2, name: "Jordan Patel", role: "member" },
      { user_id: 3, name: "Alex Taylor", role: "viewer" },
    ]);
  }),

  // GET /dashboard/summary
  http.get("http://localhost:8000/dashboard/summary", () => {
    return HttpResponse.json({
      counts: {
        assigned_to_me: 4,
        unassigned_urgent: 2,
        awaiting_my_approval: 1,
        overdue: 3,
        stale: 5,
      },
    });
  }),

  // GET /notifications/unread-count
  http.get("http://localhost:8000/notifications/unread-count", () => {
    return HttpResponse.json({ count: 2 });
  }),
];
