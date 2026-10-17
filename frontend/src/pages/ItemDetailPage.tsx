import React, { useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { Item } from "../api/types";
import { fetchItem, claimItem, releaseItem, transitionItem, patchItem } from "../api/items";
import { getStatusMeta, getPriorityMeta, getTypeMeta } from "../constants";
import { formatDueDate } from "../utils/date";
import { generateIdempotencyKey } from "../utils/idempotency";
import { ApiError } from "../api/client";
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
      setConflictMessage(null);
      setNetworkErrorMsg(null);
      await queryClient.cancelQueries({ queryKey: ["item", itemId] });

      const previousItem = queryClient.getQueryData<Item>(["item", itemId]);

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
        if (latest) {
          queryClient.setQueryData(["item", itemId], latest);
          setConflictMessage(err.message || "Someone modified this item while you were viewing it.");
        }
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

  // 4. Direct Transition Mutation
  const directTransitionMutation = useMutation({
    mutationFn: ({
      toStatus,
      version,
      key,
    }: {
      toStatus: string;
      version: number;
      key: string;
    }) => transitionItem(itemId, toStatus, version, undefined, key),
    onError: (err: ApiError) => {
      if (err.code === "version_conflict") {
        const latest = err.details?.current;
        if (latest) {
          queryClient.setQueryData(["item", itemId], latest);
          setConflictMessage("This item changed on the server - showing the latest version.");
        }
        return;
      }
      if (err.code === "network_error" || err.status === 0 || err.status >= 500) {
        setNetworkErrorMsg("We couldn't confirm this went through.");
        return;
      }
      setConflictMessage(err.message || "Failed to transition status.");
    },
    onSuccess: (updatedItem) => {
      queryClient.setQueryData(["item", itemId], updatedItem);
      lastFailedIntentRef.current = null;
      setNetworkErrorMsg(null);
      setConflictMessage(null);
      queryClient.invalidateQueries({ queryKey: ["activity", itemId] });
    },
  });

  // 5. Priority Change Mutation
  const priorityMutation = useMutation({
    mutationFn: ({ priority, version }: { priority: string; version: number }) =>
      patchItem(itemId, { priority, expected_version: version }),
    onError: (err: ApiError) => {
      if (err.code === "version_conflict") {
        const latest = err.details?.current;
        if (latest) {
          queryClient.setQueryData(["item", itemId], latest);
          setConflictMessage(err.message || "Someone modified this item while you were viewing it.");
        }
        return;
      }
      setConflictMessage(err.message || "Failed to change priority.");
    },
    onSuccess: (updatedItem) => {
      queryClient.setQueryData(["item", itemId], updatedItem);
      queryClient.invalidateQueries({ queryKey: ["activity", itemId] });
    },
  });

  const isAnyMutationInFlight =
    claimMutation.isPending ||
    releaseMutation.isPending ||
    directTransitionMutation.isPending ||
    priorityMutation.isPending;

  const handleClaim = () => {
    if (isAnyMutationInFlight) return;
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
        <h2 style={{ fontSize: "20px", marginBottom: "8px", color: "#ffffff" }}>Item Not Found</h2>
        <p style={{ marginBottom: "16px", color: "#9ca3af" }}>
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

  const transitionActions = item.allowed_actions
    .filter((a) => a.startsWith("transition:"))
    .map((a) => a.replace("transition:", ""));

  // Next attention prompt text
  let nextAttentionText = "Item is active and healthy.";
  if (item.status === "awaiting_approval") {
    nextAttentionText = "Waiting for a lead's approval";
  } else if (!item.assignee) {
    nextAttentionText = "Needs an owner assigned to begin work";
  } else if (dueInfo.isOverdue && !["resolved", "closed", "cancelled"].includes(item.status)) {
    nextAttentionText = "Item is overdue — requires prompt resolution or deadline extension";
  } else if (item.priority === "urgent") {
    nextAttentionText = "Urgent priority item requires immediate triage";
  }

  return (
    <div style={{ padding: "8px 0" }}>
      {/* 1. Breadcrumb Navigation (Matching Reference Photo) */}
      <div style={{ marginBottom: "18px" }}>
        <Link
          to="/items"
          style={{
            fontSize: "13.5px",
            color: "#8e8e93",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            textDecoration: "none",
          }}
        >
          ← All items
        </Link>
      </div>

      {/* Concurrency / Conflict Banner */}
      {conflictMessage && (
        <div className="banner banner-warning" role="alert" style={{ marginBottom: "16px" }}>
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

      {/* Network Failure Banner */}
      {networkErrorMsg && (
        <div className="banner banner-danger" role="alert" style={{ marginBottom: "16px" }}>
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

      {/* 2. Item Header Area (Matching Reference Photo) */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "20px",
          gap: "16px",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "13.5px",
              color: "#8e8e93",
              fontWeight: "500",
              marginBottom: "4px",
            }}
          >
            {item.key}
          </div>
          <h1
            style={{
              fontSize: "24px",
              fontWeight: "700",
              color: "#ffffff",
              letterSpacing: "-0.01em",
              marginBottom: "8px",
            }}
          >
            {item.title}
          </h1>
          <div
            style={{
              fontSize: "13.5px",
              color: "#8e8e93",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span>{statusMeta.label}</span>
            <span>•</span>
            <span style={{ textTransform: "capitalize" }}>{priorityMeta.label}</span>
            <span>•</span>
            <span>{typeMeta.label}</span>
            <span style={{ marginLeft: "6px", color: "#71717a", fontSize: "12px", fontFamily: "var(--font-mono)" }}>
              v{item.version}
            </span>
          </div>
        </div>

        {/* Action Buttons on Top Right (Claim is Solid White Button) */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {item.allowed_actions.includes("claim") && (
            <button
              type="button"
              className="btn-primary"
              onClick={handleClaim}
              disabled={isAnyMutationInFlight}
              data-testid="claim-button"
              style={{
                backgroundColor: "#ffffff",
                color: "#111111",
                fontWeight: "600",
                borderRadius: "8px",
                padding: "8px 18px",
                fontSize: "13.5px",
              }}
            >
              {claimMutation.isPending ? "Claiming..." : "Claim"}
            </button>
          )}

          {item.allowed_actions.includes("release") && (
            <button
              type="button"
              className="btn-secondary"
              onClick={handleRelease}
              disabled={isAnyMutationInFlight}
              data-testid="release-button"
              style={{
                borderRadius: "8px",
                padding: "8px 16px",
                fontSize: "13.5px",
              }}
            >
              {releaseMutation.isPending ? "Releasing..." : "Release"}
            </button>
          )}

          {item.allowed_actions.includes("assign") && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setIsAssignOpen(true)}
              disabled={isAnyMutationInFlight}
              data-testid="assign-button"
              style={{ borderRadius: "8px", padding: "8px 14px", fontSize: "13.5px" }}
            >
              Assign
            </button>
          )}

          {item.allowed_actions.includes("edit") && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setIsEditOpen(true)}
              disabled={isAnyMutationInFlight}
              data-testid="edit-button"
              style={{ borderRadius: "8px", padding: "8px 14px", fontSize: "13.5px" }}
            >
              Edit
            </button>
          )}

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
                style={{ borderRadius: "8px", padding: "8px 14px", fontSize: "13.5px" }}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. "What needs attention next" Banner (Matching Reference Photo) */}
      <div
        style={{
          backgroundColor: "#111215",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: "8px",
          padding: "14px 18px",
          marginBottom: "24px",
          color: "#d4d4d8",
          fontSize: "13.5px",
        }}
      >
        <span style={{ color: "#9ca3af" }}>What needs attention next: </span>
        <span style={{ color: "#ffffff", fontWeight: "500" }}>{nextAttentionText}</span>
      </div>

      {/* 4. Two Columns Side-by-Side: Details on Left, Activity on Right */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1.5fr",
          gap: "20px",
          alignItems: "start",
        }}
      >
        {/* Left Column: Details Card */}
        <div
          style={{
            backgroundColor: "#111215",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "12px",
            padding: "20px 24px",
          }}
        >
          <h2 style={{ fontSize: "18px", fontWeight: "700", color: "#ffffff", marginBottom: "12px" }}>
            Details
          </h2>

          <p
            style={{
              color: "#9ca3af",
              fontSize: "13.5px",
              lineHeight: "1.5",
              marginBottom: "20px",
            }}
          >
            {item.description || "No description provided."}
          </p>

          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "12px 0",
                borderTop: "1px solid rgba(255, 255, 255, 0.06)",
                fontSize: "13.5px",
              }}
            >
              <span style={{ color: "#8e8e93" }}>Team</span>
              <span style={{ color: "#ffffff", fontWeight: "500" }}>{item.team_name}</span>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "12px 0",
                borderTop: "1px solid rgba(255, 255, 255, 0.06)",
                fontSize: "13.5px",
              }}
            >
              <span style={{ color: "#8e8e93" }}>Assignee</span>
              <span style={{ color: item.assignee ? "#ffffff" : "#8e8e93", fontWeight: "500" }}>
                {item.assignee ? item.assignee.name : "Unassigned"}
              </span>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "12px 0",
                borderTop: "1px solid rgba(255, 255, 255, 0.06)",
                fontSize: "13.5px",
              }}
            >
              <span style={{ color: "#8e8e93" }}>Created by</span>
              <span style={{ color: "#ffffff", fontWeight: "500" }}>
                {item.created_by?.name || "Maya Chen"}
              </span>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "12px 0",
                borderTop: "1px solid rgba(255, 255, 255, 0.06)",
                fontSize: "13.5px",
              }}
            >
              <span style={{ color: "#8e8e93" }}>Due</span>
              <span style={{ color: "#ffffff", fontWeight: "500" }}>
                {item.due_at ? dueInfo.text : "No due date"}
              </span>
            </div>
          </div>
        </div>

        {/* Right Column: Activity Card */}
        <div
          style={{
            backgroundColor: "#111215",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "12px",
            padding: "20px 24px",
          }}
        >
          <ActivityTimeline
            itemId={item.id}
            currentUserName={user?.name || "Me"}
            allowedActions={item.allowed_actions}
          />
        </div>
      </div>

      {/* Modals & Dialogs */}
      {transitionTarget && (
        <TransitionDialog
          isOpen={Boolean(transitionTarget)}
          targetStatus={transitionTarget}
          item={item}
          onClose={() => setTransitionTarget(null)}
          onTransitionSuccess={handleMutationSuccess}
          onConflict={handleConflictDetected}
        />
      )}

      {isAssignOpen && (
        <AssignDialog
          isOpen={isAssignOpen}
          item={item}
          onClose={() => setIsAssignOpen(false)}
          onAssignSuccess={handleMutationSuccess}
          onConflict={handleConflictDetected}
        />
      )}

      {isEditOpen && (
        <EditItemDialog
          isOpen={isEditOpen}
          item={item}
          onClose={() => setIsEditOpen(false)}
          onEditSuccess={handleMutationSuccess}
          onConflict={handleConflictDetected}
        />
      )}
    </div>
  );
};
