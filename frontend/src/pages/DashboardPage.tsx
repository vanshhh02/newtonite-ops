import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchDashboardSummary, fetchItems } from "../api/items";
import { ItemSummary } from "../api/types";
import { getStatusMeta } from "../constants";

interface AttentionCategory {
  key: "assigned_to_me" | "unassigned_urgent" | "awaiting_my_approval" | "overdue" | "stale";
  label: string;
  countKey: "assigned_to_me" | "unassigned_urgent" | "awaiting_my_approval" | "overdue" | "stale";
}

const ATTENTION_CATEGORIES: AttentionCategory[] = [
  { key: "assigned_to_me", label: "Assigned to me", countKey: "assigned_to_me" },
  { key: "unassigned_urgent", label: "Unassigned urgent", countKey: "unassigned_urgent" },
  { key: "awaiting_my_approval", label: "Awaiting my approval", countKey: "awaiting_my_approval" },
  { key: "overdue", label: "Overdue", countKey: "overdue" },
  { key: "stale", label: "Stale", countKey: "stale" },
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
    <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "8px 0" }}>
      {/* 1. Header (Matching Reference Photo) */}
      <div style={{ marginBottom: "22px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: "700", color: "#ffffff", letterSpacing: "-0.01em" }}>
          Attention needed
        </h1>
        <p style={{ color: "#9ca3af", fontSize: "14px", marginTop: "4px" }}>
          Work that needs action from you or your team.
        </p>
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

      {/* 2. 5 Attention Cards in Single Horizontal Row (Matching Reference Photo) */}
      <div
        className="dashboard-cards-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: "12px",
          marginBottom: "24px",
        }}
      >
        {ATTENTION_CATEGORIES.map((cat) => {
          const count = counts[cat.countKey];
          return (
            <Link
              key={cat.key}
              to={`/items?view=${cat.key}`}
              className="attention-card"
              data-testid={`card-${cat.key}`}
              style={{
                backgroundColor: "#111215",
                border: "1px solid rgba(255, 255, 255, 0.14)",
                borderRadius: "8px",
                padding: "20px 18px",
                display: "block",
                textDecoration: "none",
                transition: "all 0.15s ease",
              }}
            >
              <div
                style={{
                  fontSize: "30px",
                  fontWeight: "700",
                  color: "#ffffff",
                  lineHeight: "1",
                  marginBottom: "10px",
                  fontFamily: "var(--font-sans)",
                }}
              >
                {isLoadingSummary ? "—" : count}
              </div>
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: "500",
                  color: "#9ca3af",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {cat.label}
              </div>
            </Link>
          );
        })}
      </div>

      {/* 3. First Up Section (Matching Reference Photo) */}
      <div
        style={{
          backgroundColor: "#111215",
          border: "1px solid rgba(255, 255, 255, 0.14)",
          borderRadius: "8px",
          padding: "24px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: "18px",
          }}
        >
          <h2 style={{ fontSize: "18px", fontWeight: "700", color: "#ffffff" }}>
            First up
          </h2>

          <Link
            to={`/items?view=${firstNonEmpty.key}`}
            style={{
              fontSize: "12px",
              color: "#9ca3af",
              textDecoration: "none",
            }}
          >
            View all ({counts[firstNonEmpty.countKey]}) →
          </Link>
        </div>

        {/* Loading & Error States */}
        {isLoadingPreview && (
          <div style={{ color: "#9ca3af", fontSize: "13px", padding: "16px 0" }}>
            Loading attention items...
          </div>
        )}

        {isPreviewError && (
          <div style={{ color: "#f87171", fontSize: "13px", padding: "12px 0" }}>
            Failed to load attention items.
          </div>
        )}

        {!isLoadingPreview && previewItems.length === 0 && (
          <div style={{ color: "#9ca3af", fontSize: "13px", padding: "12px 0" }}>
            No items currently need immediate attention in this view.
          </div>
        )}

        {/* Clean Row Layout: Key | Title | Status */}
        {!isLoadingPreview &&
          previewItems.map((item) => {
            const statusLabel = getStatusMeta(item.status).label;
            return (
              <Link
                key={item.id}
                to={`/items/${item.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "12px 0",
                  borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
                  textDecoration: "none",
                  transition: "opacity 0.15s ease",
                }}
              >
                <span
                  style={{
                    width: "110px",
                    color: "#8e8e8e",
                    fontFamily: "var(--font-mono)",
                    fontSize: "13px",
                    fontWeight: "500",
                    flexShrink: 0,
                  }}
                >
                  {item.key}
                </span>

                <span
                  style={{
                    flex: 1,
                    color: "#f1f5f9",
                    fontSize: "14px",
                    fontWeight: "500",
                    paddingRight: "16px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={item.title}
                >
                  {item.title}
                </span>

                <span
                  style={{
                    color: "#9ca3af",
                    fontSize: "13px",
                    textAlign: "right",
                    flexShrink: 0,
                  }}
                >
                  {statusLabel}
                </span>
              </Link>
            );
          })}
      </div>
    </div>
  );
};
