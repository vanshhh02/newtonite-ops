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

  // Submit comment with optimistic update & rollback/retry on failure
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
      // Retrying failed comment with same idempotency key
      setOptimisticComments((prev) =>
        prev.map((c) => (c.localId === localId ? { ...c, status: "sending" } : c))
      );
    }

    setIsSubmitting(true);

    try {
      await addComment(itemId, textToSend, targetKey);
      // Success: Remove optimistic comment from state and invalidate query
      setOptimisticComments((prev) => prev.filter((c) => c.localId !== localId));
      await queryClient.invalidateQueries({ queryKey: ["activity", itemId] });
    } catch {
      // Mark as failed and allow retry with same idempotency key
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
        return <span>{actor} created this work item.</span>;
      case "claimed":
        return <span>{actor} claimed this item.</span>;
      case "released":
        return <span>{actor} released this item back to unassigned.</span>;
      case "assigned":
        return (
          <span>
            {actor} assigned this item to{" "}
            <strong>{p.to ? p.to.name : "unassigned"}</strong>.
          </span>
        );
      case "status_changed":
        return (
          <div>
            <span>
              {actor} transitioned status from <strong>{p.from}</strong> to{" "}
              <strong>{p.to}</strong>.
            </span>
            {p.reason && (
              <div style={{ marginTop: "4px", color: "var(--text-secondary)", fontStyle: "italic" }}>
                "{p.reason}"
              </div>
            )}
          </div>
        );
      case "priority_changed":
        return (
          <span>
            {actor} updated priority from <strong>{p.from}</strong> to <strong>{p.to}</strong>.
          </span>
        );
      case "edited":
        return (
          <span>
            {actor} edited details: {p.fields ? p.fields.join(", ") : "information updated"}.
          </span>
        );
      case "comment_added":
        return <div style={{ whiteSpace: "pre-wrap", marginTop: "4px" }}>{p.body}</div>;
      default:
        return <span>{actor} performed {event.type}</span>;
    }
  };

  const getEventIcon = (type: string) => {
    switch (type) {
      case "comment_added":
        return "💬";
      case "status_changed":
        return "🔄";
      case "claimed":
        return "🙋";
      case "released":
        return "↩️";
      case "assigned":
        return "👤";
      case "priority_changed":
        return "⚡";
      case "edited":
        return "✏️";
      case "created":
        return "✨";
      default:
        return "📝";
    }
  };

  return (
    <div style={{ marginTop: "24px" }}>
      <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "16px" }}>
        Activity & Comments
      </h3>

      {/* Comment Input Box */}
      {canComment && (
        <div style={{ marginBottom: "20px" }}>
          <textarea
            className="textarea"
            rows={2}
            placeholder="Write a comment or status update..."
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            disabled={isSubmitting}
            aria-label="Add a comment"
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
            <button
              type="button"
              className="btn-primary"
              onClick={() => handleSendComment()}
              disabled={isSubmitting || !commentText.trim()}
            >
              {isSubmitting ? "Posting..." : "Post Comment"}
            </button>
          </div>
        </div>
      )}

      {/* Optimistic Comments List */}
      {optimisticComments.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "12px" }}>
          {optimisticComments.map((opt) => (
            <div
              key={opt.localId}
              className={`timeline-event comment-card ${
                opt.status === "sending" ? "comment-optimistic" : "comment-failed"
              }`}
            >
              <div className="timeline-icon">💬</div>
              <div className="timeline-body">
                <div className="timeline-meta">
                  <strong>{opt.actor_name}</strong>
                  <div>
                    {opt.status === "sending" ? (
                      <span style={{ color: "var(--accent-primary)", fontSize: "11px" }}>
                        Sending...
                      </span>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ color: "#f87171", fontSize: "11px" }}>Failed</span>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ fontSize: "11px", padding: "2px 6px" }}
                          onClick={() => handleSendComment(opt)}
                          disabled={isSubmitting}
                        >
                          Retry
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{opt.body}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Loading & Error States */}
      {isLoading && (
        <div style={{ color: "var(--text-secondary)", fontSize: "13px", padding: "16px 0" }}>
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

      {/* Timeline Events List */}
      <div className="timeline-container">
        {!isLoading && serverEvents.length === 0 && optimisticComments.length === 0 && (
          <div style={{ color: "var(--text-muted)", fontSize: "13px" }}>
            No activity recorded yet for this item.
          </div>
        )}

        {serverEvents.map((event) => (
          <div
            key={event.id}
            className={`timeline-event ${event.type === "comment_added" ? "comment-card" : ""}`}
            data-testid={`event-${event.id}`}
          >
            <div className="timeline-icon">{getEventIcon(event.type)}</div>
            <div className="timeline-body">
              <div className="timeline-meta">
                <strong style={{ color: "var(--text-primary)" }}>
                  {event.actor?.name || "System"}
                </strong>
                <span
                  title={formatAbsoluteDate(event.created_at)}
                  style={{ color: "var(--text-muted)" }}
                >
                  {formatRelativeTime(event.created_at)}
                </span>
              </div>
              <div style={{ color: "var(--text-primary)" }}>{renderEventDescription(event)}</div>
            </div>
          </div>
        ))}

        {/* Keyset Cursor Pagination for older events */}
        {hasNextPage && (
          <div style={{ textAlign: "center", paddingTop: "8px" }}>
            <button
              type="button"
              className="btn-secondary"
              disabled={isFetchingNextPage}
              onClick={() => fetchNextPage()}
            >
              {isFetchingNextPage ? "Loading older events..." : "Load older activity"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
