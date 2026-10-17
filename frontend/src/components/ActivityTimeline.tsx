import React, { useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ActivityEvent } from "../api/types";
import { fetchActivity, addComment } from "../api/items";
import { formatRelativeTime, formatAbsoluteDate } from "../utils/date";
import { generateIdempotencyKey } from "../utils/idempotency";

interface OptimisticComment {
  localId: string;
  item_id: number;
  body: string;
  actor_name: string;
  created_at: string;
  status: "sending" | "failed";
  idempotencyKey: string;
}

interface ActivityTimelineProps {
  itemId: number;
  currentUserName: string;
  allowedActions: string[];
}

export const ActivityTimeline: React.FC<ActivityTimelineProps> = ({
  itemId,
  currentUserName,
  allowedActions,
}) => {
  const queryClient = useQueryClient();
  const [commentText, setCommentText] = useState("");
  const [optimisticComments, setOptimisticComments] = useState<OptimisticComment[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canComment = allowedActions.includes("comment");

  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ["activity", itemId],
    queryFn: ({ pageParam }) => fetchActivity(itemId, pageParam, 20, "desc"),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });

  const serverEvents = data?.pages.flatMap((p) => p.events) ?? [];

  const handleSendComment = async (optComment?: OptimisticComment) => {
    let targetKey = optComment ? optComment.idempotencyKey : generateIdempotencyKey();
    let textToSend = optComment ? optComment.body : commentText.trim();
    let localId = optComment ? optComment.localId : `opt-${Date.now()}`;

    if (!textToSend) return;

    if (!optComment) {
      const newOptimistic: OptimisticComment = {
        localId,
        item_id: itemId,
        body: textToSend,
        actor_name: currentUserName,
        created_at: new Date().toISOString(),
        status: "sending",
        idempotencyKey: targetKey,
      };
      setOptimisticComments((prev) => [newOptimistic, ...prev]);
      setCommentText("");
    } else {
      setOptimisticComments((prev) =>
        prev.map((c) => (c.localId === localId ? { ...c, status: "sending" } : c))
      );
    }

    setIsSubmitting(true);

    try {
      await addComment(itemId, textToSend, targetKey);
      setOptimisticComments((prev) => prev.filter((c) => c.localId !== localId));
      await queryClient.invalidateQueries({ queryKey: ["activity", itemId] });
    } catch {
      setOptimisticComments((prev) =>
        prev.map((c) => (c.localId === localId ? { ...c, status: "failed" } : c))
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderEventDescription = (event: ActivityEvent) => {
    const actor = event.actor?.name || "System";
    const p = event.payload || {};

    switch (event.type) {
      case "created":
        return `${actor} created this item`;
      case "status_changed":
        return `${actor} changed status to ${p.to_status ? p.to_status.replace("_", " ") : "updated"}`;
      case "assigned":
        return `${actor} assigned this to ${p.assignee_name || "the team"}`;
      case "claimed":
        return `${actor} claimed this item`;
      case "released":
        return `${actor} released this item`;
      case "priority_changed":
        return `${actor} changed priority to ${p.to_priority || "updated"}`;
      case "comment_added":
        return `${actor}: "${p.body || ""}"`;
      case "edited":
        return `${actor} edited item details`;
      default:
        return `${actor} performed ${event.type}`;
    }
  };

  return (
    <div>
      <h2 style={{ fontSize: "18px", fontWeight: "700", color: "#ffffff", marginBottom: "14px" }}>
        Activity
      </h2>

      {/* Add a comment section */}
      {canComment && (
        <div style={{ marginBottom: "20px" }}>
          <label
            htmlFor="activity-comment-input"
            style={{
              display: "block",
              fontSize: "13.5px",
              color: "#9ca3af",
              marginBottom: "8px",
            }}
          >
            Add a comment
          </label>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              id="activity-comment-input"
              type="text"
              className="input"
              placeholder="Value"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && commentText.trim()) {
                  e.preventDefault();
                  handleSendComment();
                }
              }}
              disabled={isSubmitting}
              style={{
                backgroundColor: "#16171b",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                borderRadius: "8px",
                padding: "8px 12px",
                color: "#ffffff",
                fontSize: "13.5px",
                flex: 1,
              }}
              aria-label="Add a comment"
            />
            {commentText.trim() && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => handleSendComment()}
                disabled={isSubmitting}
                style={{
                  backgroundColor: "#ffffff",
                  color: "#111111",
                  borderRadius: "8px",
                  padding: "6px 14px",
                  fontWeight: "500",
                  fontSize: "13px",
                }}
              >
                {isSubmitting ? "Posting..." : "Post"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Optimistic Comments */}
      {optimisticComments.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "12px" }}>
          {optimisticComments.map((opt) => (
            <div
              key={opt.localId}
              style={{
                padding: "10px 0",
                borderTop: "1px solid rgba(255, 255, 255, 0.06)",
                fontSize: "13.5px",
              }}
            >
              <div style={{ color: "#ffffff", fontWeight: "400", marginBottom: "2px" }}>
                {opt.actor_name}: "{opt.body}"
              </div>
              <div style={{ fontSize: "12px", color: opt.status === "sending" ? "#9ca3af" : "#f87171" }}>
                {opt.status === "sending" ? "Posting..." : "Failed to post"}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Loading / Error states */}
      {isLoading && (
        <div style={{ color: "#9ca3af", fontSize: "13px", padding: "12px 0" }}>
          Loading activity timeline...
        </div>
      )}

      {isError && (
        <div className="banner banner-danger" style={{ marginBottom: "12px" }}>
          <span>Failed to load activity: {(error as any)?.message}</span>
          <button type="button" className="btn-secondary" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      )}

      {/* Activity Timeline List (Matching Reference Photo) */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {!isLoading && serverEvents.length === 0 && optimisticComments.length === 0 && (
          <div style={{ color: "#71717a", fontSize: "13px", padding: "12px 0" }}>
            No activity recorded yet for this item.
          </div>
        )}

        {serverEvents.map((event) => (
          <div
            key={event.id}
            data-testid={`event-${event.id}`}
            style={{
              padding: "12px 0",
              borderTop: "1px solid rgba(255, 255, 255, 0.06)",
              fontSize: "13.5px",
            }}
          >
            <div style={{ color: "#ffffff", marginBottom: "3px", lineHeight: "1.4" }}>
              {renderEventDescription(event)}
            </div>
            <div
              title={formatAbsoluteDate(event.created_at)}
              style={{ color: "#71717a", fontSize: "12px" }}
            >
              {formatRelativeTime(event.created_at)}
            </div>
          </div>
        ))}

        {hasNextPage && (
          <div style={{ textAlign: "center", paddingTop: "12px" }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              style={{ fontSize: "12px", padding: "6px 14px", borderRadius: "8px" }}
            >
              {isFetchingNextPage ? "Loading older activity..." : "Load older activity"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
