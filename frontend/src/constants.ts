export interface MetaConfig {
  label: string;
  color: string;
  bg: string;
  border: string;
}

export const STATUS_CONFIG: Record<string, MetaConfig> = {
  open: {
    label: "Open",
    color: "#60a5fa",
    bg: "rgba(59, 130, 246, 0.12)",
    border: "rgba(59, 130, 246, 0.3)",
  },
  in_progress: {
    label: "In progress",
    color: "#a78bfa",
    bg: "rgba(139, 92, 246, 0.12)",
    border: "rgba(139, 92, 246, 0.3)",
  },
  awaiting_approval: {
    label: "Awaiting approval",
    color: "#fbbf24",
    bg: "rgba(245, 158, 11, 0.12)",
    border: "rgba(245, 158, 11, 0.3)",
  },
  resolved: {
    label: "Resolved",
    color: "#34d399",
    bg: "rgba(16, 185, 129, 0.12)",
    border: "rgba(16, 185, 129, 0.3)",
  },
  closed: {
    label: "Closed",
    color: "#9ca3af",
    bg: "rgba(107, 114, 128, 0.12)",
    border: "rgba(107, 114, 128, 0.3)",
  },
  cancelled: {
    label: "Cancelled",
    color: "#f87171",
    bg: "rgba(239, 68, 68, 0.12)",
    border: "rgba(239, 68, 68, 0.3)",
  },
};

export const PRIORITY_CONFIG: Record<string, MetaConfig> = {
  low: {
    label: "Low",
    color: "#9ca3af",
    bg: "rgba(107, 114, 128, 0.12)",
    border: "rgba(107, 114, 128, 0.3)",
  },
  medium: {
    label: "Medium",
    color: "#60a5fa",
    bg: "rgba(59, 130, 246, 0.12)",
    border: "rgba(59, 130, 246, 0.3)",
  },
  high: {
    label: "High",
    color: "#fbbf24",
    bg: "rgba(245, 158, 11, 0.12)",
    border: "rgba(245, 158, 11, 0.3)",
  },
  urgent: {
    label: "Urgent",
    color: "#f87171",
    bg: "rgba(239, 68, 68, 0.15)",
    border: "rgba(239, 68, 68, 0.4)",
  },
};

export const TYPE_CONFIG: Record<string, MetaConfig> = {
  incident: {
    label: "Incident",
    color: "#f87171",
    bg: "rgba(239, 68, 68, 0.1)",
    border: "rgba(239, 68, 68, 0.25)",
  },
  customer_issue: {
    label: "Customer Issue",
    color: "#38bdf8",
    bg: "rgba(56, 189, 248, 0.1)",
    border: "rgba(56, 189, 248, 0.25)",
  },
  payment: {
    label: "Payment",
    color: "#fbbf24",
    bg: "rgba(245, 158, 11, 0.1)",
    border: "rgba(245, 158, 11, 0.25)",
  },
  compliance: {
    label: "Compliance",
    color: "#c084fc",
    bg: "rgba(192, 132, 252, 0.1)",
    border: "rgba(192, 132, 252, 0.25)",
  },
  task: {
    label: "Task",
    color: "#9ca3af",
    bg: "rgba(107, 114, 128, 0.1)",
    border: "rgba(107, 114, 128, 0.25)",
  },
};

/**
 * Graceful fallbacks for unknown server values:
 * Shows the raw string value capitalized with neutral grey styling.
 */
export function getStatusMeta(status: string): MetaConfig {
  if (STATUS_CONFIG[status]) return STATUS_CONFIG[status];
  return {
    label: status.replace(/_/g, " "),
    color: "#9ca3af",
    bg: "rgba(107, 114, 128, 0.12)",
    border: "rgba(107, 114, 128, 0.25)",
  };
}

export function getPriorityMeta(priority: string): MetaConfig {
  if (PRIORITY_CONFIG[priority]) return PRIORITY_CONFIG[priority];
  return {
    label: priority.replace(/_/g, " "),
    color: "#9ca3af",
    bg: "rgba(107, 114, 128, 0.12)",
    border: "rgba(107, 114, 128, 0.25)",
  };
}

export function getTypeMeta(type: string): MetaConfig {
  if (TYPE_CONFIG[type]) return TYPE_CONFIG[type];
  return {
    label: type.replace(/_/g, " "),
    color: "#9ca3af",
    bg: "rgba(107, 114, 128, 0.12)",
    border: "rgba(107, 114, 128, 0.25)",
  };
}

export const SEEDED_LOGINS = [
  { role: "Lead", team: "Core Platform", email: "lead.core@newtonite.local", name: "Maya Chen" },
  { role: "Member", team: "Core Platform", email: "member.core@newtonite.local", name: "Jordan Patel" },
  { role: "Viewer", team: "Core Platform", email: "viewer.core@newtonite.local", name: "Alex Taylor" },
  { role: "Lead", team: "Payments & Risk", email: "lead.payments@newtonite.local", name: "Rehan Ahmed" },
  { role: "Lead", team: "Compliance & Security", email: "lead.compliance@newtonite.local", name: "Priya Sharma" },
];
