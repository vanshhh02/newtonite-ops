import React, { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { STATUS_CONFIG, PRIORITY_CONFIG, TYPE_CONFIG } from "../constants";

interface ViewTab {
  id: string;
  label: string;
}

const VIEW_TABS: ViewTab[] = [
  { id: "all", label: "All Items" },
  { id: "assigned_to_me", label: "Assigned to Me" },
  { id: "unassigned_urgent", label: "Unassigned Urgent" },
  { id: "awaiting_my_approval", label: "Awaiting My Approval" },
  { id: "overdue", label: "Overdue" },
  { id: "stale", label: "Stale" },
];

export const ItemsFilterBar: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { memberships } = useAuth();

  // Read current URL state
  const currentView = searchParams.get("view") || "all";
  const currentSort = searchParams.get("sort") || "updated";
  const currentAssignee = searchParams.get("assignee") || "";
  const currentTeam = searchParams.get("team_id") || "";
  const selectedTypes = searchParams.getAll("type");
  const selectedStatuses = searchParams.getAll("status");
  const selectedPriorities = searchParams.getAll("priority");
  const currentQ = searchParams.get("q") || "";

  // Local state for debounced search input
  const [searchInput, setSearchInput] = useState(currentQ);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync local search input if URL changes externally (e.g. browser back/forward)
  useEffect(() => {
    setSearchInput(currentQ);
  }, [currentQ]);

  // Handle search input with 300ms debounce
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchInput(val);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (val.trim()) {
          next.set("q", val.trim());
        } else {
          next.delete("q");
        }
        return next;
      });
    }, 300);
  };

  const clearSearch = () => {
    setSearchInput("");
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("q");
      return next;
    });
  };

  // Helper to switch view tab
  const handleViewChange = (viewId: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (viewId === "all") {
        next.delete("view");
      } else {
        next.set("view", viewId);
      }
      return next;
    });
  };

  // Helper to toggle a multi-value filter
  const toggleMultiFilter = (key: "type" | "status" | "priority", value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const existing = next.getAll(key);
      next.delete(key);

      if (existing.includes(value)) {
        existing.filter((v) => v !== value).forEach((v) => next.append(key, v));
      } else {
        [...existing, value].forEach((v) => next.append(key, v));
      }
      return next;
    });
  };

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const sortVal = e.target.value;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (sortVal === "updated") {
        next.delete("sort");
      } else {
        next.set("sort", sortVal);
      }
      return next;
    });
  };

  const handleAssigneeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!val) {
        next.delete("assignee");
      } else {
        next.set("assignee", val);
      }
      return next;
    });
  };

  const handleTeamChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!val) {
        next.delete("team_id");
      } else {
        next.set("team_id", val);
      }
      return next;
    });
  };

  const clearAllFilters = () => {
    setSearchInput("");
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    setSearchParams(new URLSearchParams());
  };

  const hasActiveFilters =
    currentView !== "all" ||
    Boolean(currentTeam) ||
    selectedTypes.length > 0 ||
    selectedStatuses.length > 0 ||
    selectedPriorities.length > 0 ||
    Boolean(currentAssignee) ||
    Boolean(currentQ) ||
    currentSort !== "updated";

  return (
    <div style={{ marginBottom: "20px" }}>
      {/* 1. View Tabs */}
      <div className="view-tabs-nav" role="tablist" aria-label="Work item views">
        {VIEW_TABS.map((tab) => {
          const isActive = currentView === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              className={`view-tab-btn ${isActive ? "active" : ""}`}
              onClick={() => handleViewChange(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 2. Filter Bar */}
      <div className="filter-bar-container">
        <div className="filter-bar-main">
          {/* Search box */}
          <div className="search-input-wrapper">
            <input
              type="search"
              className="input"
              placeholder="Search by title or description... (OPS-123)"
              value={searchInput}
              onChange={handleSearchChange}
              aria-label="Search items"
            />
            {searchInput && (
              <button
                type="button"
                className="btn-ghost"
                onClick={clearSearch}
                aria-label="Clear search"
                style={{
                  position: "absolute",
                  right: "6px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  padding: "4px 8px",
                  fontSize: "12px",
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Optional Team Filter if user belongs to multiple teams */}
          {memberships.length > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <label htmlFor="team-filter" className="filter-label">
                Team
              </label>
              <select
                id="team-filter"
                className="select"
                style={{ width: "auto", minWidth: "140px", padding: "6px 10px" }}
                value={currentTeam}
                onChange={handleTeamChange}
              >
                <option value="">All Teams</option>
                {memberships.map((m) => (
                  <option key={m.team_id} value={m.team_id}>
                    {m.team_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Assignee Filter */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <label htmlFor="assignee-filter" className="filter-label">
              Assignee
            </label>
            <select
              id="assignee-filter"
              className="select"
              style={{ width: "auto", minWidth: "130px", padding: "6px 10px" }}
              value={currentAssignee}
              onChange={handleAssigneeChange}
            >
              <option value="">Anyone</option>
              <option value="me">Assigned to Me</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </div>

          {/* Sort Selector */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <label htmlFor="sort-select" className="filter-label">
              Sort
            </label>
            <select
              id="sort-select"
              className="select"
              style={{ width: "auto", minWidth: "140px", padding: "6px 10px" }}
              value={currentSort}
              onChange={handleSortChange}
            >
              <option value="updated">Last Updated</option>
              <option value="priority">Priority</option>
              <option value="due">Due Date</option>
            </select>
          </div>

          {/* Reset Filters Button */}
          {hasActiveFilters && (
            <button
              type="button"
              className="btn-ghost"
              onClick={clearAllFilters}
              style={{ fontSize: "12px", color: "var(--accent-primary)" }}
            >
              Reset filters
            </button>
          )}
        </div>

        {/* 3. Multi-Select Filter Chips: Type, Priority, Status */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", paddingTop: "4px" }}>
          {/* Types */}
          <div className="filter-chip-group">
            <span className="filter-label">Type:</span>
            {Object.keys(TYPE_CONFIG).map((typeKey) => {
              const meta = TYPE_CONFIG[typeKey];
              const isSelected = selectedTypes.includes(typeKey);
              return (
                <button
                  key={typeKey}
                  type="button"
                  className={`filter-chip ${isSelected ? "active" : ""}`}
                  onClick={() => toggleMultiFilter("type", typeKey)}
                  aria-pressed={isSelected}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>

          {/* Priorities */}
          <div className="filter-chip-group">
            <span className="filter-label">Priority:</span>
            {["urgent", "high", "medium", "low"].map((pKey) => {
              const meta = PRIORITY_CONFIG[pKey];
              const isSelected = selectedPriorities.includes(pKey);
              return (
                <button
                  key={pKey}
                  type="button"
                  className={`filter-chip ${isSelected ? "active" : ""}`}
                  onClick={() => toggleMultiFilter("priority", pKey)}
                  aria-pressed={isSelected}
                >
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      backgroundColor: meta.color,
                      display: "inline-block",
                      marginRight: "4px",
                    }}
                  />
                  {meta.label}
                </button>
              );
            })}
          </div>

          {/* Statuses */}
          <div className="filter-chip-group">
            <span className="filter-label">Status:</span>
            {Object.keys(STATUS_CONFIG).map((sKey) => {
              const meta = STATUS_CONFIG[sKey];
              const isSelected = selectedStatuses.includes(sKey);
              return (
                <button
                  key={sKey}
                  type="button"
                  className={`filter-chip ${isSelected ? "active" : ""}`}
                  onClick={() => toggleMultiFilter("status", sKey)}
                  aria-pressed={isSelected}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
