import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchDashboardSummary, fetchItems } from "../api/items";
import { ItemRow } from "../components/ItemRow";
import { ItemSummary } from "../api/types";

interface AttentionCategory {
  key: "assigned_to_me" | "unassigned_urgent" | "awaiting_my_approval" | "overdue" | "stale";
  label: string;
  countKey: "assigned_to_me" | "unassigned_urgent" | "awaiting_my_approval" | "overdue" | "stale";
  variant: "has-items" | "has-urgent" | "has-approval" | "has-overdue";
  description: string;
}

const ATTENTION_CATEGORIES: AttentionCategory[] = [
  {
    key: "assigned_to_me",
    label: "Assigned to Me",
    countKey: "assigned_to_me",
    variant: "has-items",
    description: "Items waiting on your active contribution",
  },
  {
    key: "unassigned_urgent",
    label: "Unassigned Urgent",
    countKey: "unassigned_urgent",
    variant: "has-urgent",
    description: "Urgent items needing immediate ownership",
  },
  {
    key: "awaiting_my_approval",
    label: "Awaiting My Approval",
    countKey: "awaiting_my_approval",
    variant: "has-approval",
    description: "Items pending team lead review & sign-off",
  },
  {
    key: "overdue",
    label: "Overdue",
    countKey: "overdue",
    variant: "has-overdue",
    description: "Items that have exceeded target resolution time",
  },
  {
    key: "stale",
    label: "Stale Items",
    countKey: "stale",
    variant: "has-items",
    description: "No activity recorded in the past 24 hours",
  },
];

export const DashboardPage: React.FC = () => {
  // 1. Summary Query: poll every 30s while tab is visible
  const {
    data: summary,
    isLoading: isLoadingSummary,
    isError: isSummaryError,
    error: summaryError,
    refetch: refetchSummary,
  } = useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: fetchDashboardSummary,
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const counts = summary?.counts || {
    assigned_to_me: 0,
    unassigned_urgent: 0,
    awaiting_my_approval: 0,
    overdue: 0,
    stale: 0,
  };

  // 2. Identify the first non-empty attention view for the top-5 preview
  const firstNonEmpty = useMemo(() => {
    for (const cat of ATTENTION_CATEGORIES) {
      if (counts[cat.countKey] > 0) {
        return cat;
      }
    }
    return ATTENTION_CATEGORIES[0];
  }, [counts]);

  // 3. Top-5 Preview Items Query
  const {
    data: previewData,
    isLoading: isLoadingPreview,
    isError: isPreviewError,
  } = useQuery({
    queryKey: ["dashboard", "preview", firstNonEmpty.key],
    queryFn: () => fetchItems({ view: firstNonEmpty.key, limit: 5 }),
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const previewItems: ItemSummary[] = previewData?.items || [];

  return (
    <div>
      {/* Dashboard Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "20px",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: "700", color: "var(--text-primary)" }}>
            Operations Command Center
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "13px", marginTop: "2px" }}>
            Real-time attention queues and workload distribution across all teams.
          </p>
        </div>

        <Link to="/items/new" className="btn-primary" style={{ textDecoration: "none" }}>
          + New Item
        </Link>
      </div>

      {/* Summary Error Banner */}
      {isSummaryError && (
        <div className="banner banner-danger" style={{ marginBottom: "20px" }}>
          <span>Failed to load dashboard metrics: {(summaryError as any)?.message}</span>
          <button type="button" className="btn-secondary" onClick={() => refetchSummary()}>
            Retry
          </button>
        </div>
      )}

      {/* Attention Cards Grid */}
      <div className="dashboard-cards-grid">
        {ATTENTION_CATEGORIES.map((cat) => {
          const count = counts[cat.countKey];
          const hasCount = count > 0;
          return (
            <Link
              key={cat.key}
              to={`/items?view=${cat.key}`}
              className={`attention-card ${hasCount ? cat.variant : ""}`}
              data-testid={`card-${cat.key}`}
            >
              <div>
                <div className="attention-card-count">
                  {isLoadingSummary ? "—" : count}
                </div>
                <div className="attention-card-label">{cat.label}</div>
              </div>
              <div
                style={{
                  fontSize: "11px",
                  color: "var(--text-muted)",
                  marginTop: "12px",
                  lineHeight: "1.3",
                }}
              >
                {cat.description}
              </div>
            </Link>
          );
        })}
      </div>

      {/* Top-5 Preview Section */}
      <div style={{ marginTop: "12px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: "14px",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          <div>
            <h2 style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)" }}>
              Top Priority Preview: {firstNonEmpty.label}
            </h2>
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              Top 5 items requiring active attention right now
            </span>
          </div>

          <Link
            to={`/items?view=${firstNonEmpty.key}`}
            style={{
              fontSize: "13px",
              color: "var(--accent-primary)",
              fontWeight: "500",
              textDecoration: "none",
            }}
          >
            View all {counts[firstNonEmpty.countKey]} items →
          </Link>
        </div>

        {/* Table for Top-5 Preview */}
        <div className="table-container">
          <table className="data-table" aria-label="Top priority items preview">
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">Title</th>
                <th scope="col">Type</th>
                <th scope="col">Priority</th>
                <th scope="col">Status</th>
                <th scope="col">Assignee</th>
                <th scope="col">Due Date</th>
                <th scope="col" style={{ textAlign: "right" }}>
                  Updated
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoadingPreview && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "32px" }}>
                    <div style={{ color: "var(--text-secondary)" }}>Loading preview items...</div>
                  </td>
                </tr>
              )}

              {isPreviewError && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "24px", color: "#f87171" }}>
                    Failed to load preview items.
                  </td>
                </tr>
              )}

              {!isLoadingPreview && previewItems.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <div className="empty-state" style={{ padding: "32px 16px" }}>
                      <h3>No attention items</h3>
                      <p>All items in this attention view have been handled!</p>
                    </div>
                  </td>
                </tr>
              )}

              {!isLoadingPreview &&
                previewItems.map((item) => <ItemRow key={item.id} item={item} />)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
