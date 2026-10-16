export type ItemType = "incident" | "customer_issue" | "payment" | "compliance" | "task" | string;
export type ItemStatus = "open" | "in_progress" | "awaiting_approval" | "resolved" | "closed" | "cancelled" | string;
export type ItemPriority = "low" | "medium" | "high" | "urgent" | string;
export type TeamRole = "viewer" | "member" | "lead" | string;

export interface UserRef {
  id: number;
  name: string;
}

export interface UserBrief {
  id: number;
  name: string;
  email: string;
}

export interface TeamMembership {
  team_id: number;
  team_name: string;
  role: TeamRole;
}

export interface MeResponse {
  user: UserBrief;
  memberships: TeamMembership[];
}

export interface TeamMember {
  user_id: number;
  name: string;
  role: TeamRole;
}

export interface ItemSummary {
  id: number;
  key: string;
  team_id: number;
  team_name: string;
  title: string;
  type: ItemType;
  status: ItemStatus;
  priority: ItemPriority;
  assignee: UserRef | null;
  created_by: UserRef;
  requires_approval: boolean;
  due_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
}

export interface Item extends ItemSummary {
  description: string;
  allowed_actions: string[];
}

export interface ItemListResponse {
  items: ItemSummary[];
  next_cursor: string | null;
}

export interface ActivityEvent {
  id: number;
  item_id: number;
  type: "created" | "comment_added" | "claimed" | "released" | "assigned" | "edited" | "priority_changed" | "status_changed" | string;
  actor: UserRef;
  payload: Record<string, any>;
  created_at: string;
}

export interface EventListResponse {
  events: ActivityEvent[];
  next_cursor: string | null;
}

export interface DashboardCounts {
  assigned_to_me: number;
  unassigned_urgent: number;
  awaiting_my_approval: number;
  overdue: number;
  stale: number;
}

export interface DashboardSummaryResponse {
  counts: DashboardCounts;
}

export interface NotificationItem {
  id: number;
  item_id: number;
  item_key: string;
  type: string;
  message: string;
  read_at: string | null;
  created_at: string;
}

export interface NotificationListResponse {
  notifications: NotificationItem[];
  next_cursor: string | null;
}

export interface UnreadCountResponse {
  count: number;
}
