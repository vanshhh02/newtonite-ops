import React, { useState, useEffect } from "react";
import { Item } from "../api/types";
import { transitionItem } from "../api/items";
import { generateIdempotencyKey } from "../utils/idempotency";
import { getStatusMeta } from "../constants";
import { ApiError } from "../api/client";

interface TransitionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  item: Item;
  targetStatus: string;
  onTransitionSuccess: (updatedItem: Item) => void;
  onConflict: (latestItem: Item, message: string) => void;
}

export const TransitionDialog: React.FC<TransitionDialogProps> = ({
  isOpen,
  onClose,
  item,
  targetStatus,
  onTransitionSuccess,
  onConflict,
}) => {
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string>("");

  const targetMeta = getStatusMeta(targetStatus);
  const isReasonRequired = targetStatus === "cancelled";

  // Generate idempotency key once per dialog intent
  useEffect(() => {
    if (isOpen) {
      setIdempotencyKey(generateIdempotencyKey());
      setReason("");
      setErrorMsg(null);
      setCanRetry(false);
      setIsSubmitting(false);
    }
  }, [isOpen, targetStatus]);

  if (!isOpen) return null;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isReasonRequired && !reason.trim()) {
      setErrorMsg("A reason is required to cancel this item.");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const updated = await transitionItem(
        item.id,
        targetStatus,
        item.version,
        reason.trim() || undefined,
        idempotencyKey
      );
      onTransitionSuccess(updated);
      onClose();
    } catch (err: any) {
      if (err instanceof ApiError) {
        if (err.code === "version_conflict" || err.code === "invalid_transition") {
          const current = err.details?.current;
          onClose();
          if (current) {
            onConflict(current, `This item was modified by another user. Latest version loaded.`);
          } else {
            onConflict(item, err.message);
          }
          return;
        }

        if (err.code === "network_error" || err.status === 0 || err.status >= 500) {
          setErrorMsg("We couldn't confirm this went through.");
          setCanRetry(true);
          return;
        }

        setErrorMsg(err.message || "Failed to transition status");
      } else {
        setErrorMsg(err.message || "An unexpected error occurred");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="transition-title">
      <div className="modal-dialog">
        <h2 id="transition-title" style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px" }}>
          Transition to {targetMeta.label}
        </h2>

        <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "16px" }}>
          Current version: <strong>v{item.version}</strong>. You are transitioning <strong>{item.key}</strong> from{" "}
          <span style={{ color: getStatusMeta(item.status).color }}>{getStatusMeta(item.status).label}</span> to{" "}
          <span style={{ color: targetMeta.color }}>{targetMeta.label}</span>.
        </p>

        {errorMsg && (
          <div className="banner banner-danger" style={{ marginBottom: "14px" }}>
            <span>{errorMsg}</span>
            {canRetry && (
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: "12px", padding: "4px 8px" }}
                onClick={() => handleSubmit()}
                disabled={isSubmitting}
              >
                Retry
              </button>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "16px" }}>
            <label
              htmlFor="transition-reason"
              style={{ display: "block", fontSize: "12px", fontWeight: "500", marginBottom: "6px" }}
            >
              {isReasonRequired ? "Reason (required)" : "Reason / Notes (optional)"}
            </label>
            <textarea
              id="transition-reason"
              className="textarea"
              rows={3}
              placeholder={isReasonRequired ? "Explain why this item is being cancelled..." : "Optional context for this transition..."}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
            <button
              type="button"
              className="btn-ghost"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Transitioning..." : `Confirm → ${targetMeta.label}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
