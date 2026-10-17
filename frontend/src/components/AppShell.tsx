import React, { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api/client";
import { UnreadCountResponse, NotificationListResponse } from "../api/types";

export const AppShell: React.FC = () => {
  const { user, memberships, selectedTeamId, setSelectedTeamId, logout } = useAuth();
  const navigate = useNavigate();
  const [showNotifications, setShowNotifications] = useState(false);

  // Poll unread count every 15 seconds
  const { data: unreadData, refetch: refetchUnread } = useQuery<UnreadCountResponse>({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => apiFetch<UnreadCountResponse>("/notifications/unread-count"),
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
    retry: 2,
  });

  // Query notifications list when dropdown is opened
  const { data: notificationsData, refetch: refetchNotifs } = useQuery<NotificationListResponse>({
    queryKey: ["notifications", "list"],
    queryFn: () => apiFetch<NotificationListResponse>("/notifications?limit=10"),
    enabled: showNotifications,
    retry: 2,
  });

  const handleMarkAllRead = async () => {
    try {
      await apiFetch("/notifications/read-all", { method: "POST" });
      refetchUnread();
      refetchNotifs();
    } catch {
      // Ignored
    }
  };

  const handleNotificationClick = async (notifId: number, itemId: number) => {
    try {
      await apiFetch(`/notifications/${notifId}/read`, { method: "POST" });
      refetchUnread();
    } catch {
      // Ignored
    }
    setShowNotifications(false);
    navigate(`/items/${itemId}`);
  };

  const userNameDisplay = user?.name || "V. Agarwal";

  return (
    <div
      style={{
        backgroundColor: "var(--bg-app)",
        minHeight: "100vh",
        padding: "20px 24px",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        className="app-card-container"
        style={{
          width: "100%",
          maxWidth: "1240px",
          backgroundColor: "var(--bg-container)",
          border: "1px solid var(--border-card)",
          borderRadius: "16px",
          padding: "24px 32px",
          display: "flex",
          flexDirection: "column",
          minHeight: "calc(100vh - 40px)",
        }}
      >
        {/* Top Navigation Bar inside container */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingBottom: "24px",
            marginBottom: "8px",
          }}
        >
          {/* Left: Brand, Nav Links, Team Selector, Bullet, User */}
          <div style={{ display: "flex", alignItems: "center", gap: "20px", flexWrap: "wrap" }}>
            <Link
              to="/"
              style={{
                fontSize: "17px",
                fontWeight: "700",
                letterSpacing: "-0.01em",
                color: "#ffffff",
                textDecoration: "none",
                display: "flex",
                alignItems: "center",
                marginRight: "4px",
              }}
            >
              Newtonite Ops
            </Link>

            <nav style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <NavLink
                to="/"
                end
                style={({ isActive }) => ({
                  padding: "6px 14px",
                  borderRadius: "6px",
                  fontSize: "13.5px",
                  fontWeight: "500",
                  color: isActive ? "#ffffff" : "#9ca3af",
                  backgroundColor: isActive ? "#26282e" : "transparent",
                  textDecoration: "none",
                  transition: "all 0.15s ease",
                })}
              >
                Dashboard
              </NavLink>
              <NavLink
                to="/items"
                style={({ isActive }) => ({
                  padding: "6px 14px",
                  borderRadius: "6px",
                  fontSize: "13.5px",
                  fontWeight: "500",
                  color: isActive ? "#ffffff" : "#9ca3af",
                  backgroundColor: isActive ? "#26282e" : "transparent",
                  textDecoration: "none",
                  transition: "all 0.15s ease",
                })}
              >
                Items
              </NavLink>
              <NavLink
                to="/items/new"
                style={({ isActive }) => ({
                  padding: "6px 14px",
                  borderRadius: "6px",
                  fontSize: "13.5px",
                  fontWeight: "500",
                  color: isActive ? "#ffffff" : "#9ca3af",
                  backgroundColor: isActive ? "#26282e" : "transparent",
                  textDecoration: "none",
                  transition: "all 0.15s ease",
                })}
              >
                New item
              </NavLink>
            </nav>

            {/* Team Dropdown */}
            <div style={{ display: "flex", alignItems: "center" }}>
              <select
                className="select"
                style={{
                  fontSize: "13.5px",
                  padding: "4px 8px",
                  height: "28px",
                  width: "auto",
                  border: "none",
                  backgroundColor: "transparent",
                  color: "#9ca3af",
                  cursor: "pointer",
                  outline: "none",
                }}
                value={selectedTeamId === null ? "all" : String(selectedTeamId)}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedTeamId(val === "all" ? null : Number(val));
                }}
              >
                <option value="all">All my teams</option>
                {memberships.map((m) => (
                  <option key={m.team_id} value={String(m.team_id)}>
                    {m.team_name} ({m.role})
                  </option>
                ))}
              </select>
            </div>

            <span style={{ color: "#52525b" }}>•</span>

            {/* User Name */}
            <span style={{ fontSize: "13.5px", color: "#9ca3af", fontWeight: "400" }}>
              {userNameDisplay}
            </span>
          </div>

          {/* Right: Notifications & Quick Sign Out */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className="btn-ghost"
                style={{
                  padding: "6px",
                  position: "relative",
                  color: "#9ca3af",
                  borderRadius: "6px",
                }}
                onClick={() => setShowNotifications((prev) => !prev)}
                aria-label="Notifications"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                  <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                </svg>
                {unreadData && unreadData.count > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: "2px",
                      right: "2px",
                      backgroundColor: "#ef4444",
                      color: "#ffffff",
                      fontSize: "10px",
                      fontWeight: "700",
                      height: "15px",
                      minWidth: "15px",
                      borderRadius: "8px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "0 3px",
                    }}
                  >
                    {unreadData.count}
                  </span>
                )}
              </button>

              {showNotifications && (
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "36px",
                    width: "320px",
                    backgroundColor: "var(--bg-surface)",
                    border: "1px solid var(--border-default)",
                    borderRadius: "var(--radius-lg)",
                    boxShadow: "0 10px 25px -5px rgba(0,0,0,0.7)",
                    zIndex: 50,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      padding: "10px 14px",
                      borderBottom: "1px solid var(--border-subtle)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span style={{ fontSize: "12px", fontWeight: "600", color: "#fff" }}>
                      Notifications
                    </span>
                    {unreadData && unreadData.count > 0 && (
                      <button
                        type="button"
                        style={{ fontSize: "11px", color: "var(--text-secondary)", padding: 0 }}
                        onClick={handleMarkAllRead}
                      >
                        Mark all read
                      </button>
                    )}
                  </div>

                  <div style={{ maxHeight: "280px", overflowY: "auto" }}>
                    {!notificationsData?.notifications || notificationsData.notifications.length === 0 ? (
                      <div
                        style={{
                          padding: "20px",
                          textAlign: "center",
                          color: "var(--text-muted)",
                          fontSize: "12px",
                        }}
                      >
                        No notifications yet
                      </div>
                    ) : (
                      notificationsData.notifications.map((n) => (
                        <div
                          key={n.id}
                          onClick={() => handleNotificationClick(n.id, n.item_id)}
                          style={{
                            padding: "10px 14px",
                            borderBottom: "1px solid var(--border-subtle)",
                            cursor: "pointer",
                            backgroundColor: n.read_at ? "transparent" : "rgba(255, 255, 255, 0.04)",
                            transition: "background-color 150ms",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginBottom: "2px",
                            }}
                          >
                            <span style={{ fontSize: "11px", fontWeight: "600", color: "#ffffff" }}>
                              {n.item_key}
                            </span>
                            <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                              {new Date(n.created_at).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                          <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.3" }}>
                            {n.message}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              className="btn-ghost"
              style={{ fontSize: "12px", padding: "4px 8px", color: "#71717a" }}
              onClick={logout}
              title="Sign out"
            >
              Sign out
            </button>
          </div>
        </header>

        {/* Main Content Area */}
        <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
};
