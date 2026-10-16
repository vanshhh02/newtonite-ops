import React from "react";
import { useParams } from "react-router-dom";

export const ItemDetailPage: React.FC = () => {
  const { id } = useParams();
  return (
    <div>
      <h1 style={{ fontSize: "20px", fontWeight: "600" }}>Item #{id}</h1>
      <p style={{ color: "var(--text-secondary)", fontSize: "13px" }}>Loading details...</p>
    </div>
  );
};
