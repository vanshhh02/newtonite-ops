import React, { useState, useEffect } from "react";
import { Item } from "../api/types";
import { patchItem } from "../api/items";
import { ApiError } from "../api/client";

interface EditItemDialogProps {
  isOpen: boolean;
  onClose: () => void;
  item: Item;
  onEditSuccess: (updatedItem: Item) => void;
  onConflict: (latestItem: Item, message: string) => void;
}

export const EditItemDialog: React.FC<EditItemDialogProps> = ({
  isOpen,
  onClose,
  item,
  onEditSuccess,
  onConflict,
}) => {
  const [initialVersion, setInitialVersion] = useState(item.version);
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [priority, setPriority] = useState(item.priority);
  const [dueDate, setDueDate] = useState(() => (item.due_at ? item.due_at.substring(0, 10) : ""));

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // When dialog opens, initialize form state
  useEffect(() => {
    if (isOpen) {
      setInitialVersion(item.version);
      setTitle(item.title);
      setDescription(item.description);
      setPriority(item.priority);
      setDueDate(item.due_at ? item.due_at.substring(0, 10) : "");
      setFieldErrors({});
      setGeneralError(null);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Stale check: has the remote item version increased while we had the edit dialog open?
  const isStaleDraft = item.version > initialVersion;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFieldErrors({});
    setGeneralError(null);

    const payload: any = {
      expected_version: initialVersion,
      title: title.trim(),
      description: description.trim(),
      priority,
      due_at: dueDate ? new Date(dueDate).toISOString() : null,
    };

    try {
      const updated = await patchItem(item.id, payload);
      onEditSuccess(updated);
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

        if (err.status === 422 && err.details?.fields) {
          const errors: Record<string, string> = {};
          err.details.fields.forEach((f: any) => {
            errors[f.field] = f.message;
          });
          setFieldErrors(errors);
          return;
        }

        setGeneralError(err.message || "Failed to update item");
      } else {
        setGeneralError(err.message || "An unexpected error occurred");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="edit-dialog-title">
      <div className="modal-dialog" style={{ maxWidth: "560px" }}>
        <h2 id="edit-dialog-title" style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px" }}>
          Edit {item.key} Details
        </h2>

        {/* Remote Update Warning (Spec 4.h: unsaved edit and remote change detected) */}
        {isStaleDraft && (
          <div className="banner banner-warning" style={{ marginBottom: "14px" }}>
            <span>
              ⚠️ This item was updated remotely (server is now at v{item.version}). Submitting will trigger a conflict check.
            </span>
          </div>
        )}

        {generalError && (
          <div className="banner banner-danger" style={{ marginBottom: "14px" }}>
            <span>{generalError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "14px" }}>
            <label
              htmlFor="edit-title"
              style={{ display: "block", fontSize: "12px", fontWeight: "500", marginBottom: "4px" }}
            >
              Title
            </label>
            <input
              id="edit-title"
              type="text"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              disabled={isSubmitting}
            />
            {fieldErrors.title && (
              <span style={{ color: "#f87171", fontSize: "12px", marginTop: "4px", display: "block" }}>
                {fieldErrors.title}
              </span>
            )}
          </div>

          <div style={{ marginBottom: "14px" }}>
            <label
              htmlFor="edit-desc"
              style={{ display: "block", fontSize: "12px", fontWeight: "500", marginBottom: "4px" }}
            >
              Description
            </label>
            <textarea
              id="edit-desc"
              className="textarea"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isSubmitting}
            />
            {fieldErrors.description && (
              <span style={{ color: "#f87171", fontSize: "12px", marginTop: "4px", display: "block" }}>
                {fieldErrors.description}
              </span>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "18px" }}>
            <div>
              <label
                htmlFor="edit-priority"
                style={{ display: "block", fontSize: "12px", fontWeight: "500", marginBottom: "4px" }}
              >
                Priority
              </label>
              <select
                id="edit-priority"
                className="select"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                disabled={isSubmitting}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="edit-due-date"
                style={{ display: "block", fontSize: "12px", fontWeight: "500", marginBottom: "4px" }}
              >
                Due Date
              </label>
              <input
                id="edit-due-date"
                type="date"
                className="input"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={isSubmitting}
              />
              {fieldErrors.due_at && (
                <span style={{ color: "#f87171", fontSize: "12px", marginTop: "4px", display: "block" }}>
                  {fieldErrors.due_at}
                </span>
              )}
            </div>
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
              {isSubmitting ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
