import React, { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { SEEDED_LOGINS } from "../constants";
import { ApiError } from "../api/client";

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnUrl = searchParams.get("returnUrl") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setError(null);
    setIsSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate(returnUrl, { replace: true });
    } catch (err: any) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to sign in. Please verify your connection.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const fillDemoAccount = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword("password123");
    setError(null);
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px",
      backgroundColor: "var(--bg-app)"
    }}>
      <div className="card" style={{ width: "100%", maxWidth: "420px", border: "1px solid var(--border-default)" }}>
        <div style={{ marginBottom: "24px", textAlign: "center" }}>
          <h1 style={{ fontSize: "22px", fontWeight: "700", letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
            Newtonite Ops
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "13px", marginTop: "4px" }}>
            Operations Under Pressure &mdash; Internal Console
          </p>
        </div>

        {error && (
          <div className="banner banner-danger" style={{ marginBottom: "16px" }}>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--text-secondary)", marginBottom: "6px" }}>
              Work Email
            </label>
            <input
              type="text"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. lead.core@newtonite.local"
              required
              autoFocus
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--text-secondary)", marginBottom: "6px" }}>
              Password
            </label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="btn-primary"
            style={{ width: "100%", padding: "10px", marginTop: "8px" }}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Signing in..." : "Sign in to Console"}
          </button>
        </form>

        <div style={{ marginTop: "24px", paddingTop: "20px", borderTop: "1px solid var(--border-subtle)" }}>
          <p style={{ fontSize: "12px", fontWeight: "500", color: "var(--text-muted)", marginBottom: "10px" }}>
            Or sign in with a demo role:
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {SEEDED_LOGINS.map((demo) => (
              <button
                key={demo.email}
                type="button"
                className="btn-secondary"
                style={{
                  justifyContent: "space-between",
                  fontSize: "12px",
                  padding: "6px 10px",
                  textAlign: "left"
                }}
                onClick={() => fillDemoAccount(demo.email)}
              >
                <span>
                  <strong style={{ color: "var(--text-primary)" }}>{demo.role}</strong> &bull; {demo.name}
                </span>
                <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>{demo.team}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
