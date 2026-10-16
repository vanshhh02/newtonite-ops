/**
 * Utility functions for date calculations, relative timestamps, and overdue checks.
 */

export function formatRelativeTime(isoString: string): string {
  if (!isoString) return "";
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 45) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return `${Math.floor(diffMonths / 12)}y ago`;
}

export function formatDueDate(isoString: string | null): { text: string; isOverdue: boolean; overdueText?: string } {
  if (!isoString) {
    return { text: "No due date", isOverdue: false };
  }
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const isPast = diffMs < 0;
  const absDiffHours = Math.floor(Math.abs(diffMs) / (1000 * 60 * 60));
  const absDiffDays = Math.floor(absDiffHours / 24);

  const formattedDate = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });

  if (isPast) {
    const overdueLabel = absDiffDays > 0 ? `Overdue by ${absDiffDays}d` : `Overdue by ${absDiffHours}h`;
    return {
      text: formattedDate,
      isOverdue: true,
      overdueText: overdueLabel,
    };
  }

  if (absDiffDays === 0) {
    return { text: `Today (${absDiffHours}h left)`, isOverdue: false };
  }
  if (absDiffDays === 1) {
    return { text: "Tomorrow", isOverdue: false };
  }
  return { text: formattedDate, isOverdue: false };
}

export function formatAbsoluteDate(isoString: string): string {
  if (!isoString) return "";
  const date = new Date(isoString);
  return date.toLocaleString();
}
