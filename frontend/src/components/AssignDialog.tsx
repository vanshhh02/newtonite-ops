import React, { useState, useEffect } from "react";
import { Item, TeamMember } from "../api/types";
import { assignItem, fetchTeamMembers } from "../api/items";
import { generateIdempotencyKey } from "../utils/idempotency";
import { ApiError } from "../api/client";

interface AssignDialogProps {
  isOpen: boolean;
  onClose: () => void;
  item: Item;
  onAssignSuccess: (updatedItem: Item) => void;
  onConflict: (latestItem: Item, message: string) => void;
}

export const AssignDialog: React.FC<AssignDialogProps> = ({
  isOpen,
  onClose,
  item,
  onAssignSuccess,
  onConflict,
}) => {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");

  useEffect(() => {
    if (isOpen) {
      setIdempotencyKey(generateIdempotencyKey());
      setSelectedUserId(item.assignee ? String(item.assignee.id) : "");
      setErrorMsg(null);
      setCanRetry(false);
      setIsSubmitting(false);

      setIsLoadingMembers(true);
      fetchTeamMembers(item.team_id)
        .then((data) => setMembers(data))
        .catch((err) => setErrorMsg(err.message || "Failed to load team members"))
        .finally(() => setIsLoadingMembers(false));
    }
  }, [isOpen, item.team_id, item.assignee]);

  if (!isOpen) return null;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);

    const targetAssigneeId = selectedUserId ? Number(selectedUserId) : null;

    try {
      const updated = await assignItem(item.id, targetAssigneeId, item.version, idempotencyKey);
      onAssignSuccess(updated);
      onClose();
    } catch (err: any) {
      if (err instanceof ApiError) {
        if (err.code === "version_conflict") {
          const current = err.details?.current;
          onClose();
          if (current) {
            onConflict(current, "This item changed on the server - showing the latest version.");
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

        setErrorMsg(err.message || "Failed to assign item");
      } else {
        setErrorMsg(err.message || "An unexpected error occurred");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="assign-title">
      <div className="modal-dialog">
        <h2 id="assign-title" style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px" }}>
          Assign {item.key}
        </h2>

        <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "16px" }}>
          Select a member of <strong>{item.team_name}</strong> to assign this work item.
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
          <div style={{ marginBottom: "20px" }}>
            <label
              htmlFor="member-select"
              style={{ display: "block", fontSize: "12px", fontWeight: "500", marginBottom: "6px" }}
            >
              Assignee
            </label>
            {isLoadingMembers ? (
              <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Loading members...</div>
            ) : (
              <select
                id="member-select"
                className="select"
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                disabled={isSubmitting}
              >
                <option value="">(Unassigned)</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name} ({m.role})
                  </option>
                ))}
              </select>
            )}
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
              disabled={isSubmitting || isLoadingMembers}
            >
              {isSubmitting ? "Assigning..." : "Save Assignment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
