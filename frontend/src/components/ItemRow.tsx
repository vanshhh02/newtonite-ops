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

  return (
    <tr key={item.id} data-testid={`item-row-${item.id}`}>
      {/* 1. Item Key */}
      <td style={{ width: "90px" }}>
        <Link to={`/items/${item.id}`} className="key-tag" title={`View ${item.key}`}>
          {item.key}
        </Link>
      </td>

      {/* 2. Title */}
      <td>
        <Link
          to={`/items/${item.id}`}
          style={{
            fontWeight: 500,
            color: "var(--text-primary)",
            display: "block",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "380px",
          }}
          title={item.title}
        >
          {item.title}
        </Link>
      </td>

      {/* 3. Type */}
      <td style={{ width: "120px" }}>
        <span
          className="badge"
          style={{
            color: typeMeta.color,
            backgroundColor: typeMeta.bg,
            border: `1px solid ${typeMeta.border}`,
          }}
        >
          {typeMeta.label}
        </span>
      </td>

      {/* 4. Priority */}
      <td style={{ width: "110px" }}>
        <span
          className="badge"
          style={{
            color: priorityMeta.color,
            backgroundColor: priorityMeta.bg,
            border: `1px solid ${priorityMeta.border}`,
          }}
        >
          <span
            className="badge-dot"
            style={{ backgroundColor: priorityMeta.color }}
          />
          {priorityMeta.label}
        </span>
      </td>

      {/* 5. Status */}
      <td style={{ width: "140px" }}>
        <span
          className="badge"
          style={{
            color: statusMeta.color,
            backgroundColor: statusMeta.bg,
            border: `1px solid ${statusMeta.border}`,
          }}
        >
          {statusMeta.label}
        </span>
      </td>

      {/* 6. Assignee */}
      <td style={{ width: "140px" }}>
        {item.assignee ? (
          <span style={{ color: "var(--text-primary)" }}>{item.assignee.name}</span>
        ) : (
          <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Unassigned</span>
        )}
      </td>

      {/* 7. Due Date */}
      <td style={{ width: "150px" }}>
        {item.due_at ? (
          <span title={formatAbsoluteDate(item.due_at)}>
            {isOverdue ? (
              <span className="overdue-pill">
                ⚠️ {dueInfo.overdueText || "Overdue"}
              </span>
            ) : (
              <span style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                {dueInfo.text}
              </span>
            )}
          </span>
        ) : (
          <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>—</span>
        )}
      </td>

      {/* 8. Updated Ago */}
      <td style={{ width: "100px", textAlign: "right" }}>
        <span
          title={formatAbsoluteDate(item.updated_at)}
          style={{ color: "var(--text-muted)", fontSize: "12px" }}
        >
          {formatRelativeTime(item.updated_at)}
        </span>
      </td>
    </tr>
  );
});

ItemRow.displayName = "ItemRow";
