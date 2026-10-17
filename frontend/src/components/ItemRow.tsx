import React from "react";
import { Link } from "react-router-dom";
import { ItemSummary } from "../api/types";
import { getStatusMeta, getPriorityMeta, getTypeMeta } from "../constants";
import { formatRelativeTime, formatDueDate, formatAbsoluteDate } from "../utils/date";

interface ItemRowProps {
  item: ItemSummary;
}

export const ItemRow: React.FC<ItemRowProps> = React.memo(({ item }) => {
  const statusMeta = getStatusMeta(item.status);
  const priorityMeta = getPriorityMeta(item.priority);
  const typeMeta = getTypeMeta(item.type);

  const dueInfo = formatDueDate(item.due_at);
  const isOverdue = dueInfo.isOverdue && !["resolved", "closed", "cancelled"].includes(item.status);

  // Friendly due display
  let dueDisplay = "—";
  if (item.due_at) {
    if (isOverdue) {
      dueDisplay = dueInfo.overdueText || "Overdue";
    } else {
      dueDisplay = dueInfo.text;
    }
  }

  // Friendly assignee display: first name or unassigned
  const assigneeDisplay = item.assignee ? item.assignee.name.split(" ")[0] : "Unassigned";

  return (
    <tr
      key={item.id}
      data-testid={`item-row-${item.id}`}
      style={{
        borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
        transition: "background-color 0.15s ease",
      }}
    >
      {/* 1. Item Key (Grey) */}
      <td style={{ width: "95px", padding: "14px 16px" }}>
        <Link
          to={`/items/${item.id}`}
          style={{
            color: "#71717a",
            fontFamily: "var(--font-mono)",
            fontSize: "13px",
            fontWeight: "500",
            textDecoration: "none",
          }}
          title={`View ${item.key}`}
        >
          {item.key}
        </Link>
      </td>

      {/* 2. Title (Crisp White) */}
      <td style={{ padding: "14px 16px" }}>
        <Link
          to={`/items/${item.id}`}
          style={{
            fontWeight: "500",
            color: "#f4f4f5",
            fontSize: "13.5px",
            display: "block",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "360px",
            textDecoration: "none",
          }}
          title={item.title}
        >
          {item.title}
        </Link>
      </td>

      {/* 3. Type (Muted grey text) */}
      <td style={{ width: "110px", padding: "14px 16px", color: "#9ca3af", fontSize: "13.5px" }}>
        {typeMeta.label}
      </td>

      {/* 4. Status (Muted grey text) */}
      <td style={{ width: "140px", padding: "14px 16px", color: "#9ca3af", fontSize: "13.5px" }}>
        {statusMeta.label}
      </td>

      {/* 5. Priority (Muted grey text) */}
      <td style={{ width: "100px", padding: "14px 16px", color: "#9ca3af", fontSize: "13.5px", textTransform: "capitalize" }}>
        {priorityMeta.label}
      </td>

      {/* 6. Assignee (Muted grey text) */}
      <td style={{ width: "110px", padding: "14px 16px", color: "#9ca3af", fontSize: "13.5px" }}>
        {assigneeDisplay}
      </td>

      {/* 7. Due Date (Muted grey text or overdue) */}
      <td style={{ width: "100px", padding: "14px 16px", color: isOverdue ? "#f87171" : "#9ca3af", fontSize: "13.5px" }}>
        {dueDisplay}
      </td>

      {/* 8. Updated Ago (Muted grey text, right-aligned) */}
      <td
        style={{
          width: "90px",
          padding: "14px 16px",
          color: "#71717a",
          fontSize: "13px",
          textAlign: "right",
        }}
        title={formatAbsoluteDate(item.updated_at)}
      >
        {formatRelativeTime(item.updated_at)}
      </td>
    </tr>
  );
});

ItemRow.displayName = "ItemRow";
