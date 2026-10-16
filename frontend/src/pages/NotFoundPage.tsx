import React from "react";
import { Link } from "react-router-dom";

export const NotFoundPage: React.FC = () => {
  return (
    <div className="card" style={{ maxWidth: "500px", margin: "40px auto", textAlign: "center" }}>
      <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "8px" }}>Not found or no access</h2>
      <p style={{ color: "var(--text-secondary)", fontSize: "13px", marginBottom: "20px" }}>
        The item or page you requested does not exist or you do not have permission to access it.
      </p>
      <Link to="/" className="btn-primary">
        Back to Dashboard
      </Link>
    </div>
  );
};
