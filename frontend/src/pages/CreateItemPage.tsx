import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { createItem, CreateItemPayload } from "../api/items";
import { generateIdempotencyKey } from "../utils/idempotency";
import { ApiError } from "../api/client";

export const CreateItemPage: React.FC = () => {
  const navigate = useNavigate();
  const { memberships } = useAuth();

  // Filter only teams where the user is 'member' or 'lead' (viewers cannot create)
  const writableTeams = memberships.filter((m) => m.role === "member" || m.role === "lead");

  const [teamId, setTeamId] = useState<number>(() => writableTeams[0]?.team_id || 0);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("incident");
  const [priority, setPriority] = useState("medium");
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [dueDate, setDueDate] = useState("");

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string>("");

  // Initialize idempotency key once per form intent
  useEffect(() => {
    setIdempotencyKey(generateIdempotencyKey());
  }, []);

  // Update default requires_approval based on type
  useEffect(() => {
    if (type === "payment" || type === "compliance") {
      setRequiresApproval(true);
    }
  }, [type]);

  if (writableTeams.length === 0) {
    return (
      <div className="empty-state" style={{ padding: "64px 16px" }}>
        <h2 style={{ fontSize: "18px", marginBottom: "8px" }}>No Permission to Create Items</h2>
        <p style={{ marginBottom: "16px" }}>
          You are currently a viewer on all assigned teams. Only team members or leads can create operational work items.
        </p>
        <Link to="/items" className="btn-secondary">
          ← Back to Items
        </Link>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFieldErrors({});
    setGeneralError(null);

    const payload: CreateItemPayload = {
      team_id: teamId || writableTeams[0].team_id,
      title: title.trim(),
      description: description.trim(),
      type,
      priority,
      requires_approval: requiresApproval,
      due_at: dueDate ? new Date(dueDate).toISOString() : null,
    };

    try {
      const newItem = await createItem(payload, idempotencyKey);
      navigate(`/items/${newItem.id}`);
    } catch (err: any) {
      if (err instanceof ApiError) {
        if (err.status === 422 && err.details?.fields) {
          const errors: Record<string, string> = {};
          err.details.fields.forEach((f: any) => {
            errors[f.field] = f.message;
          });
          setFieldErrors(errors);
          return;
        }

        if (err.code === "network_error" || err.status === 0 || err.status >= 500) {
          setGeneralError("We couldn't confirm this went through. You can safely retry without duplicating.");
          return;
        }

        setGeneralError(err.message || "Failed to create work item");
      } else {
        setGeneralError(err.message || "An unexpected error occurred");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: "680px", margin: "0 auto" }}>
      <div style={{ marginBottom: "16px" }}>
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

      <div className="card" style={{ padding: "28px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: "700", marginBottom: "8px" }}>
          Create New Operational Item
        </h1>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "24px" }}>
          Track incidents, approvals, customer escalations, compliance tasks, and payments across teams.
        </p>

        {generalError && (
          <div className="banner banner-danger" style={{ marginBottom: "20px" }}>
            <span>{generalError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Team Selector */}
          <div style={{ marginBottom: "18px" }}>
            <label
              htmlFor="create-team"
              style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}
            >
              Team *
            </label>
            <select
              id="create-team"
              className="select"
              value={teamId || writableTeams[0].team_id}
              onChange={(e) => setTeamId(Number(e.target.value))}
              disabled={isSubmitting}
              required
            >
              {writableTeams.map((m) => (
                <option key={m.team_id} value={m.team_id}>
                  {m.team_name} ({m.role})
                </option>
              ))}
            </select>
          </div>

          {/* Title */}
          <div style={{ marginBottom: "18px" }}>
            <label
              htmlFor="create-title"
              style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}
            >
              Title *
            </label>
            <input
              id="create-title"
              type="text"
              className="input"
              placeholder="e.g. Postgres pool exhaustion during billing batch"
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

          {/* Description */}
          <div style={{ marginBottom: "18px" }}>
            <label
              htmlFor="create-desc"
              style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}
            >
              Description
            </label>
            <textarea
              id="create-desc"
              className="textarea"
              rows={4}
              placeholder="Provide background, severity, affected customers, or reproduction steps..."
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

          {/* Type & Priority Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "18px" }}>
            <div>
              <label
                htmlFor="create-type"
                style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}
              >
                Item Type *
              </label>
              <select
                id="create-type"
                className="select"
                value={type}
                onChange={(e) => setType(e.target.value)}
                disabled={isSubmitting}
              >
                <option value="incident">Incident</option>
                <option value="customer_issue">Customer Issue</option>
                <option value="payment">Payment</option>
                <option value="compliance">Compliance</option>
                <option value="task">Task</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="create-priority"
                style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}
              >
                Priority *
              </label>
              <select
                id="create-priority"
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
          </div>

          {/* Due Date */}
          <div style={{ marginBottom: "18px" }}>
            <label
              htmlFor="create-due"
              style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}
            >
              Due Date (optional)
            </label>
            <input
              id="create-due"
              type="date"
              className="input"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          {/* Requires Approval Checkbox */}
          <div style={{ marginBottom: "24px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={requiresApproval}
                onChange={(e) => setRequiresApproval(e.target.checked)}
                disabled={isSubmitting}
                style={{ width: "16px", height: "16px" }}
              />
              <span style={{ fontSize: "13px", fontWeight: "500" }}>
                Requires Lead Approval before proceeding (default for payment & compliance)
              </span>
            </label>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
            <Link to="/items" className="btn-ghost">
              Cancel
            </Link>
            <button
              type="submit"
              className="btn-primary"
              disabled={isSubmitting || !title.trim()}
            >
              {isSubmitting ? "Creating Item..." : "Create Work Item"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
