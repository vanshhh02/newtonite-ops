import React from "react";
import { Item } from "../api/types";
import { formatDueDate } from "../utils/date";

interface AttentionStripProps {
  item: Item;
}

export const AttentionStrip: React.FC<AttentionStripProps> = ({ item }) => {
  const dueInfo = formatDueDate(item.due_at);
  const isOverdue = dueInfo.isOverdue && !["resolved", "closed", "cancelled"].includes(item.status);

  let message = "";
  let variant = "normal";

  if (!item.assignee && !["resolved", "closed", "cancelled"].includes(item.status)) {
    variant = "urgent";
    message = "💡 Unassigned: Claim this item to assign it to yourself and begin work.";
  } else if (item.status === "awaiting_approval") {
    variant = "approval";
    message = "⏳ Awaiting Approval: A team lead must review and approve this item before it can proceed.";
  } else if (isOverdue) {
    variant = "urgent";
    message = `⚠️ Overdue: This item is ${dueInfo.overdueText || "past due"} and requires urgent action.`;
  } else if (item.status === "in_progress") {
    message = "⚡ In Progress: Active work is underway. Transition when ready.";
  } else if (item.status === "open") {
    message = "▶️ Open: Item is assigned and ready to be started.";
  } else if (item.status === "resolved") {
    message = "✓ Resolved: Ready for final review or closure.";
  } else {
    message = "✓ Completed: Item is closed with no pending actions.";
  }

  return (
    <div className={`attention-strip ${variant}`} data-testid="attention-strip">
      <span>{message}</span>
    </div>
  );
};
