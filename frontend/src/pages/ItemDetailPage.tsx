import React, { useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { Item } from "../api/types";
import { fetchItem, claimItem, releaseItem, transitionItem, patchItem } from "../api/items";
import { getStatusMeta, getPriorityMeta, getTypeMeta } from "../constants";
import { formatAbsoluteDate, formatDueDate } from "../utils/date";
import { generateIdempotencyKey } from "../utils/idempotency";
import { ApiError } from "../api/client";
import { AttentionStrip } from "../components/AttentionStrip";
import { TransitionDialog } from "../components/TransitionDialog";
import { AssignDialog } from "../components/AssignDialog";
import { EditItemDialog } from "../components/EditItemDialog";
import { ActivityTimeline } from "../components/ActivityTimeline";

export const ItemDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const itemId = Number(id);
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Modals state
  const [transitionTarget, setTransitionTarget] = useState<string | null>(null);
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);

  // Concurrency banners & notices
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [networkErrorMsg, setNetworkErrorMsg] = useState<string | null>(null);

  // Stored intent for retrying failed network requests with SAME idempotency key
  const lastFailedIntentRef = useRef<{
    action: () => Promise<any>;
    idempotencyKey: string;
  } | null>(null);

  // 1. Fetch Item query (polled every 15s while tab is visible)
  const {
    data: item,
    isLoading,
    isError,
    error,
  } = useQuery<Item, ApiError>({
    queryKey: ["item", itemId],
    queryFn: () => fetchItem(itemId),
    staleTime: 10_000,
    retry: 2,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    enabled: !isNaN(itemId),
  });

  // 2. Claim Mutation (Optimistic Update)
  const claimMutation = useMutation({
    mutationFn: ({ key }: { key: string }) => claimItem(itemId, key),
    onMutate: async () => {
      // Clear banners
      setConflictMessage(null);
      setNetworkErrorMsg(null);

      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["item", itemId] });

      // Snapshot previous item for rollback
      const previousItem = queryClient.getQueryData<Item>(["item", itemId]);

      // Optimistically update
      if (previousItem && user) {
        queryClient.setQueryData<Item>(["item", itemId], {
          ...previousItem,
          assignee: { id: user.id, name: user.name },
          allowed_actions: previousItem.allowed_actions.filter((a) => a !== "claim").concat(["release"]),
        });
      }

      return { previousItem };
    },
    onError: (err: ApiError, _variables, context) => {
      // Rollback to snapshot
      if (context?.previousItem) {
        queryClient.setQueryData(["item", itemId], context.previousItem);
      }

      if (err.code === "already_claimed") {
        const latest = err.details?.current;
        if (latest) {
          queryClient.setQueryData(["item", itemId], latest);
          const claimant = latest.assignee?.name || "Another user";
          setConflictMessage(`${claimant} just claimed this item.`);
        } else {
          setConflictMessage(err.message);
        }
        return;
      }

      if (err.code === "network_error" || err.status === 0 || err.status >= 500) {
        setNetworkErrorMsg("We couldn't confirm this went through.");
        return;
      }

      setConflictMessage(err.message || "Failed to claim item.");
    },
    onSuccess: (updatedItem) => {
      // Replace cache with fresh server item (updates version for next action)
      queryClient.setQueryData(["item", itemId], updatedItem);
      lastFailedIntentRef.current = null;
      setNetworkErrorMsg(null);
      setConflictMessage(null);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["item", itemId] });
      queryClient.invalidateQueries({ queryKey: ["activity", itemId] });
    },
  });

  // 3. Release Mutation (Optimistic Update)
  const releaseMutation = useMutation({
    mutationFn: ({ version, key }: { version: number; key: string }) =>
      releaseItem(itemId, version, key),
    onMutate: async () => {
      setConflictMessage(null);
      setNetworkErrorMsg(null);
      await queryClient.cancelQueries({ queryKey: ["item", itemId] });
      const previousItem = queryClient.getQueryData<Item>(["item", itemId]);

      if (previousItem) {
        queryClient.setQueryData<Item>(["item", itemId], {
          ...previousItem,
          assignee: null,
          allowed_actions: previousItem.allowed_actions.filter((a) => a !== "release").concat(["claim"]),
        });
      }
      return { previousItem };
    },
    onError: (err: ApiError, _variables, context) => {
      if (context?.previousItem) {
        queryClient.setQueryData(["item", itemId], context.previousItem);
      }
      if (err.code === "version_conflict") {
        const latest = err.details?.current;
        if (latest) queryClient.setQueryData(["item", itemId], latest);
        setConflictMessage("This item changed on the server - showing the latest version.");
        return;
      }
      if (err.code === "network_error" || err.status === 0 || err.status >= 500) {
        setNetworkErrorMsg("We couldn't confirm this went through.");
        return;
      }
      setConflictMessage(err.message || "Failed to release item.");
    },
    onSuccess: (updatedItem) => {
      queryClient.setQueryData(["item", itemId], updatedItem);
      lastFailedIntentRef.current = null;
      setNetworkErrorMsg(null);
      setConflictMessage(null);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["item", itemId] });
      queryClient.invalidateQueries({ queryKey: ["activity", itemId] });
    },
  });

  // 4. Direct Transition Mutation (for transitions that don't need reason)
  const directTransitionMutation = useMutation({
    mutationFn: ({ toStatus, version, key }: { toStatus: string; version: number; key: string }) =>
      transitionItem(itemId, toStatus, version, undefined, key),
    onMutate: async ({ toStatus }) => {
      setConflictMessage(null);
      setNetworkErrorMsg(null);
      await queryClient.cancelQueries({ queryKey: ["item", itemId] });
      const previousItem = queryClient.getQueryData<Item>(["item", itemId]);

      if (previousItem) {
        queryClient.setQueryData<Item>(["item", itemId], {
          ...previousItem,
          status: toStatus,
        });
      }
      return { previousItem };
    },
    onError: (err: ApiError, _variables, context) => {
      if (context?.previousItem) {
        queryClient.setQueryData(["item", itemId], context.previousItem);
      }
      if (err.code === "version_conflict" || err.code === "invalid_transition") {
        const latest = err.details?.current;
        if (latest) queryClient.setQueryData(["item", itemId], latest);
        setConflictMessage("This item changed on the server - showing the latest version.");
        return;
      }
      if (err.code === "network_error" || err.status === 0 || err.status >= 500) {
        setNetworkErrorMsg("We couldn't confirm this went through.");
        return;
      }
      setConflictMessage(err.message || "Failed to transition item.");
    },
    onSuccess: (updatedItem) => {
      queryClient.setQueryData(["item", itemId], updatedItem);
      lastFailedIntentRef.current = null;
      setNetworkErrorMsg(null);
      setConflictMessage(null);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["item", itemId] });
      queryClient.invalidateQueries({ queryKey: ["activity", itemId] });
    },
  });

  // 5. Change Priority Mutation
  const priorityMutation = useMutation({
    mutationFn: ({ priority, version }: { priority: string; version: number }) =>
      patchItem(itemId, { expected_version: version, priority }),
    onError: (err: ApiError) => {
      if (err.code === "version_conflict") {
        const latest = err.details?.current;
        if (latest) queryClient.setQueryData(["item", itemId], latest);
        setConflictMessage("This item changed on the server - showing the latest version.");
        return;
      }
      setConflictMessage(err.message || "Failed to update priority.");
    },
    onSuccess: (updatedItem) => {
      queryClient.setQueryData(["item", itemId], updatedItem);
      setConflictMessage(null);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["item", itemId] });
      queryClient.invalidateQueries({ queryKey: ["activity", itemId] });
    },
  });

  // Global in-flight lock: disables all action buttons while a mutation is running
  const isAnyMutationInFlight =
    claimMutation.isPending ||
    releaseMutation.isPending ||
    directTransitionMutation.isPending ||
    priorityMutation.isPending;

  // Handlers
  const handleClaim = () => {
    if (isAnyMutationInFlight) return; // Prevent double click
    const key = generateIdempotencyKey();
    lastFailedIntentRef.current = {
      action: () => claimMutation.mutateAsync({ key }),
      idempotencyKey: key,
    };
    claimMutation.mutate({ key });
  };

  const handleRelease = () => {
    if (!item || isAnyMutationInFlight) return;
    const key = generateIdempotencyKey();
    lastFailedIntentRef.current = {
      action: () => releaseMutation.mutateAsync({ version: item.version, key }),
      idempotencyKey: key,
    };
    releaseMutation.mutate({ version: item.version, key });
  };

  const handleTransitionClick = (toStatus: string) => {
    if (!item || isAnyMutationInFlight) return;

    // Transitions to 'cancelled' or 'resolved' require/prefer a reason dialog
    if (toStatus === "cancelled" || toStatus === "resolved") {
      setTransitionTarget(toStatus);
    } else {
      const key = generateIdempotencyKey();
      lastFailedIntentRef.current = {
        action: () => directTransitionMutation.mutateAsync({ toStatus, version: item.version, key }),
        idempotencyKey: key,
      };
      directTransitionMutation.mutate({ toStatus, version: item.version, key });
    }
  };

  const handleRetryFailedIntent = () => {
    if (lastFailedIntentRef.current) {
      setNetworkErrorMsg(null);
      lastFailedIntentRef.current.action().catch(() => {});
    }
  };

  const handleMutationSuccess = (updatedItem: Item) => {
    queryClient.setQueryData(["item", itemId], updatedItem);
    setConflictMessage(null);
    setNetworkErrorMsg(null);
    queryClient.invalidateQueries({ queryKey: ["activity", itemId] });
  };

  const handleConflictDetected = (latestItem: Item, message: string) => {
    queryClient.setQueryData(["item", itemId], latestItem);
    setConflictMessage(message);
    queryClient.invalidateQueries({ queryKey: ["activity", itemId] });
  };

  // 404 Not Found handling
  if (isError && error?.status === 404) {
    return (
      <div className="empty-state" style={{ padding: "64px 16px" }}>
        <h2 style={{ fontSize: "20px", marginBottom: "8px" }}>Item Not Found</h2>
        <p style={{ marginBottom: "16px" }}>
          The requested work item OPS-{itemId} does not exist or you do not have permission to access its team.
        </p>
        <Link to="/items" className="btn-secondary">
          ← Back to Items
        </Link>
      </div>
    );
  }

  if (isLoading || !item) {
    return (
      <div style={{ padding: "40px 16px", color: "var(--text-secondary)" }}>
        Loading work item OPS-{itemId}...
      </div>
    );
  }

  const statusMeta = getStatusMeta(item.status);
  const priorityMeta = getPriorityMeta(item.priority);
  const typeMeta = getTypeMeta(item.type);
  const dueInfo = formatDueDate(item.due_at);
  const isOverdue = dueInfo.isOverdue && !["resolved", "closed", "cancelled"].includes(item.status);

  // Transition actions from allowed_actions: "transition:<status>"
  const transitionActions = item.allowed_actions
    .filter((a) => a.startsWith("transition:"))
    .map((a) => a.replace("transition:", ""));

  return (
    <div>
      {/* Breadcrumb Navigation */}
      <div style={{ marginBottom: "14px" }}>
        <Link
          to="/items"
          style={{
            fontSize: "13px",
            color: "var(--text-secondary)",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          ← Back to Items
        </Link>
      </div>

      {/* Concurrency / Conflict Banner */}
      {conflictMessage && (
        <div className="banner banner-warning" role="alert">
          <div>
            <strong>Conflict detected:</strong> {conflictMessage}
          </div>
          <button
            type="button"
            className="btn-ghost"
            style={{ fontSize: "12px", padding: "2px 6px" }}
            onClick={() => setConflictMessage(null)}
          >
            ✕ Dismiss
          </button>
        </div>
      )}

      {/* Network Failure Banner with Idempotent Retry */}
      {networkErrorMsg && (
        <div className="banner banner-danger" role="alert">
          <div>
            <strong>Network Error:</strong> {networkErrorMsg}
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleRetryFailedIntent}
            disabled={isAnyMutationInFlight}
          >
            Retry (same intent)
          </button>
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px", flexWrap: "wrap" }}>
          <span className="key-tag" style={{ fontSize: "14px", padding: "4px 8px" }}>
            {item.key}
          </span>
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
          <span
            className="badge"
            style={{
              color: priorityMeta.color,
              backgroundColor: priorityMeta.bg,
              border: `1px solid ${priorityMeta.border}`,
            }}
          >
            <span className="badge-dot" style={{ backgroundColor: priorityMeta.color }} />
            {priorityMeta.label}
          </span>
          <span
            style={{
              fontSize: "12px",
              color: "var(--text-muted)",
              marginLeft: "auto",
              fontFamily: "var(--font-mono)",
            }}
            title="Optimistic concurrency control version"
          >
            v{item.version}
          </span>
        </div>

        <h1 style={{ fontSize: "22px", fontWeight: "700", color: "var(--text-primary)" }}>
          {item.title}
        </h1>
      </div>

      {/* Attention Strip */}
      <AttentionStrip item={item} />

      {/* Action Bar driven ONLY by item.allowed_actions */}
      <div className="action-bar-container">
        {/* Claim */}
        {item.allowed_actions.includes("claim") && (
          <button
            type="button"
            className="btn-primary"
            onClick={handleClaim}
            disabled={isAnyMutationInFlight}
            data-testid="claim-button"
          >
            {claimMutation.isPending ? "Claiming..." : "Claim item"}
          </button>
        )}

        {/* Release */}
        {item.allowed_actions.includes("release") && (
          <button
            type="button"
            className="btn-secondary"
            onClick={handleRelease}
            disabled={isAnyMutationInFlight}
            data-testid="release-button"
          >
            {releaseMutation.isPending ? "Releasing..." : "Release item"}
          </button>
        )}

        {/* Assign */}
        {item.allowed_actions.includes("assign") && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setIsAssignOpen(true)}
            disabled={isAnyMutationInFlight}
            data-testid="assign-button"
          >
            Assign...
          </button>
        )}

        {/* Edit */}
        {item.allowed_actions.includes("edit") && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setIsEditOpen(true)}
            disabled={isAnyMutationInFlight}
            data-testid="edit-button"
          >
            Edit Details...
          </button>
        )}

        {/* Change Priority */}
        {item.allowed_actions.includes("change_priority") && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
            <select
              className="select"
              style={{ padding: "6px 10px", width: "auto" }}
              value={item.priority}
              onChange={(e) =>
                priorityMutation.mutate({ priority: e.target.value, version: item.version })
              }
              disabled={isAnyMutationInFlight}
              aria-label="Change priority"
            >
              <option value="low">Priority: Low</option>
              <option value="medium">Priority: Medium</option>
              <option value="high">Priority: High</option>
              <option value="urgent">Priority: Urgent</option>
            </select>
          </div>
        )}

        {/* Transition Buttons */}
        {transitionActions.map((toStatus) => {
          const meta = getStatusMeta(toStatus);
          return (
            <button
              key={toStatus}
              type="button"
              className="btn-secondary"
              onClick={() => handleTransitionClick(toStatus)}
              disabled={isAnyMutationInFlight}
              data-testid={`transition-${toStatus}`}
              style={{ borderColor: meta.border, color: meta.color }}
            >
              Transition → {meta.label}
            </button>
          );
        })}
      </div>

      {/* Detail Grid: Left (Description & Activity), Right (Metadata) */}
      <div className="detail-grid">
        {/* Left Column */}
        <div>
          {/* Description Section */}
          <div className="card" style={{ marginBottom: "20px" }}>
            <h3 style={{ fontSize: "14px", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "8px" }}>
              Description
            </h3>
            <div style={{ color: "var(--text-primary)", whiteSpace: "pre-wrap", lineHeight: "1.6" }}>
              {item.description || (
                <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                  No description provided.
                </span>
              )}
            </div>
          </div>

          {/* Activity Timeline & Discussion */}
          <ActivityTimeline
            itemId={item.id}
            currentUserName={user?.name || "Me"}
            allowedActions={item.allowed_actions}
          />
        </div>

        {/* Right Column: Metadata Panel */}
        <div>
          <div className="metadata-panel">
            <h3 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "12px", color: "var(--text-secondary)" }}>
              Item Details
            </h3>

            <div className="metadata-row">
              <span className="metadata-label">Team</span>
              <span className="metadata-value">{item.team_name}</span>
            </div>

            <div className="metadata-row">
              <span className="metadata-label">Assignee</span>
              <span className="metadata-value">
                {item.assignee ? (
                  item.assignee.name
                ) : (
                  <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Unassigned</span>
                )}
              </span>
            </div>

            <div className="metadata-row">
              <span className="metadata-label">Created by</span>
              <span className="metadata-value">{item.created_by.name || "Unknown"}</span>
            </div>

            <div className="metadata-row">
              <span className="metadata-label">Due Date</span>
              <span className="metadata-value">
                {item.due_at ? (
                  <span title={formatAbsoluteDate(item.due_at)}>
                    {isOverdue ? (
                      <span className="overdue-pill">⚠️ {dueInfo.overdueText}</span>
                    ) : (
                      dueInfo.text
                    )}
                  </span>
                ) : (
                  "—"
                )}
              </span>
            </div>

            <div className="metadata-row">
              <span className="metadata-label">Requires Approval</span>
              <span className="metadata-value">{item.requires_approval ? "Yes" : "No"}</span>
            </div>

            <div className="metadata-row">
              <span className="metadata-label">Created</span>
              <span className="metadata-value" title={formatAbsoluteDate(item.created_at)}>
                {new Date(item.created_at).toLocaleDateString()}
              </span>
            </div>

            <div className="metadata-row">
              <span className="metadata-label">Last Updated</span>
              <span className="metadata-value" title={formatAbsoluteDate(item.updated_at)}>
                {new Date(item.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Action Dialogs */}
      {transitionTarget && (
        <TransitionDialog
          isOpen={true}
          onClose={() => setTransitionTarget(null)}
          item={item}
          targetStatus={transitionTarget}
          onTransitionSuccess={handleMutationSuccess}
          onConflict={handleConflictDetected}
        />
      )}

      {isAssignOpen && (
        <AssignDialog
          isOpen={true}
          onClose={() => setIsAssignOpen(false)}
          item={item}
          onAssignSuccess={handleMutationSuccess}
          onConflict={handleConflictDetected}
        />
      )}

      {isEditOpen && (
        <EditItemDialog
          isOpen={true}
          onClose={() => setIsEditOpen(false)}
          item={item}
          onEditSuccess={handleMutationSuccess}
          onConflict={handleConflictDetected}
        />
      )}
    </div>
  );
};
