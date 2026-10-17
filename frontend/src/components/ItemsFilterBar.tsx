import React, { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { STATUS_CONFIG, PRIORITY_CONFIG, TYPE_CONFIG } from "../constants";

interface ViewTab {
  id: string;
  label: string;
  ariaLabel: string;
}

const VIEW_TABS: ViewTab[] = [
  { id: "all", label: "All", ariaLabel: "All Items" },
  { id: "assigned_to_me", label: "Assigned", ariaLabel: "Assigned to Me" },
  { id: "unassigned_urgent", label: "Unassigned urgent", ariaLabel: "Unassigned Urgent" },
  { id: "awaiting_my_approval", label: "Awaiting approval", ariaLabel: "Awaiting My Approval" },
  { id: "overdue", label: "Overdue", ariaLabel: "Overdue" },
  { id: "stale", label: "Stale", ariaLabel: "Stale" },
];

export const ItemsFilterBar: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Read current URL state
  const currentView = searchParams.get("view") || "all";
  const currentSort = searchParams.get("sort") || "updated";
  const currentAssignee = searchParams.get("assignee") || "";
  const selectedTypes = searchParams.getAll("type");
  const selectedStatuses = searchParams.getAll("status");
  const selectedPriorities = searchParams.getAll("priority");
  const currentQ = searchParams.get("q") || "";

  // Local state for debounced search input
  const [searchInput, setSearchInput] = useState(currentQ);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setSearchInput(currentQ);
  }, [currentQ]);

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

  return (
    <div style={{ marginBottom: "20px" }}>
      {/* 1. View Tabs Row (Matching Reference Photo) */}
      <div
        role="tablist"
        aria-label="Work item views"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: "18px",
          flexWrap: "wrap",
        }}
      >
        {VIEW_TABS.map((tab) => {
          const isActive = currentView === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-label={tab.ariaLabel}
              aria-selected={isActive}
              onClick={() => handleViewChange(tab.id)}
              style={{
                backgroundColor: isActive ? "#26282e" : "transparent",
                color: isActive ? "#ffffff" : "#8e8e93",
                borderRadius: "6px",
                padding: "6px 14px",
                fontSize: "13.5px",
                fontWeight: "500",
                transition: "all 0.15s ease",
                border: "none",
                cursor: "pointer",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 2. Sleek Filter Boxes Row (Matching Reference Photo) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr 1fr",
          gap: "8px",
          marginBottom: "14px",
        }}
        className="filter-boxes-row"
      >
        {/* Box 1: Search */}
        <div
          style={{
            backgroundColor: "#111215",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: "8px",
            padding: "6px 12px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <label
            htmlFor="items-search-input"
            style={{
              fontSize: "10.5px",
              color: "#8e8e93",
              display: "block",
              lineHeight: "1.2",
              marginBottom: "2px",
            }}
          >
            Search title or key
          </label>
          <input
            id="items-search-input"
            type="search"
            placeholder="Search by title or description... (OPS-123)"
            value={searchInput}
            onChange={handleSearchChange}
            aria-label="Search items"
            style={{
              backgroundColor: "transparent",
              border: "none",
              color: "#ffffff",
              fontSize: "13px",
              outline: "none",
              width: "100%",
              padding: 0,
            }}
          />
        </div>

        {/* Box 2: Assignee */}
        <div
          style={{
            backgroundColor: "#111215",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: "8px",
            padding: "6px 12px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <label
            htmlFor="assignee-filter"
            style={{
              fontSize: "10.5px",
              color: "#8e8e93",
              display: "block",
              lineHeight: "1.2",
              marginBottom: "2px",
            }}
          >
            Assignee
          </label>
          <select
            id="assignee-filter"
            aria-label="Assignee"
            value={currentAssignee}
            onChange={handleAssigneeChange}
            style={{
              backgroundColor: "transparent",
              border: "none",
              color: "#ffffff",
              fontSize: "13px",
              outline: "none",
              cursor: "pointer",
              padding: 0,
              width: "100%",
            }}
          >
            <option value="" style={{ backgroundColor: "#111215" }}>Anyone</option>
            <option value="me" style={{ backgroundColor: "#111215" }}>Assigned to Me</option>
            <option value="unassigned" style={{ backgroundColor: "#111215" }}>Unassigned</option>
          </select>
        </div>

        {/* Box 3: Sort */}
        <div
          style={{
            backgroundColor: "#111215",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: "8px",
            padding: "6px 12px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <label
            htmlFor="sort-select"
            style={{
              fontSize: "10.5px",
              color: "#8e8e93",
              display: "block",
              lineHeight: "1.2",
              marginBottom: "2px",
            }}
          >
            Sort
          </label>
          <select
            id="sort-select"
            aria-label="Sort"
            value={currentSort}
            onChange={handleSortChange}
            style={{
              backgroundColor: "transparent",
              border: "none",
              color: "#ffffff",
              fontSize: "13px",
              outline: "none",
              cursor: "pointer",
              padding: 0,
              width: "100%",
            }}
          >
            <option value="updated" style={{ backgroundColor: "#111215" }}>Last updated</option>
            <option value="priority" style={{ backgroundColor: "#111215" }}>Priority</option>
            <option value="due" style={{ backgroundColor: "#111215" }}>Due Date</option>
          </select>
        </div>

        {/* Box 4: Type Selector */}
        <div
          style={{
            backgroundColor: "#111215",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: "8px",
            padding: "6px 12px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <label
            htmlFor="type-select"
            style={{
              fontSize: "10.5px",
              color: "#8e8e93",
              display: "block",
              lineHeight: "1.2",
              marginBottom: "2px",
            }}
          >
            Type
          </label>
          <select
            id="type-select"
            aria-label="Type"
            value={selectedTypes.length === 1 ? selectedTypes[0] : ""}
            onChange={(e) => {
              const val = e.target.value;
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete("type");
                if (val) next.append("type", val);
                return next;
              });
            }}
            style={{
              backgroundColor: "transparent",
              border: "none",
              color: "#ffffff",
              fontSize: "13px",
              outline: "none",
              cursor: "pointer",
              padding: 0,
              width: "100%",
            }}
          >
            <option value="" style={{ backgroundColor: "#111215" }}>
              {selectedTypes.length > 1 ? `${selectedTypes.length} types` : "Any"}
            </option>
            {Object.keys(TYPE_CONFIG).map((tk) => (
              <option key={tk} value={tk} style={{ backgroundColor: "#111215" }}>
                {TYPE_CONFIG[tk].label}
              </option>
            ))}
          </select>
        </div>

        {/* Box 5: Status Selector */}
        <div
          style={{
            backgroundColor: "#111215",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: "8px",
            padding: "6px 12px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <label
            htmlFor="status-select"
            style={{
              fontSize: "10.5px",
              color: "#8e8e93",
              display: "block",
              lineHeight: "1.2",
              marginBottom: "2px",
            }}
          >
            Status
          </label>
          <select
            id="status-select"
            aria-label="Status"
            value={selectedStatuses.length === 1 ? selectedStatuses[0] : ""}
            onChange={(e) => {
              const val = e.target.value;
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete("status");
                if (val) next.append("status", val);
                return next;
              });
            }}
            style={{
              backgroundColor: "transparent",
              border: "none",
              color: "#ffffff",
              fontSize: "13px",
              outline: "none",
              cursor: "pointer",
              padding: 0,
              width: "100%",
            }}
          >
            <option value="" style={{ backgroundColor: "#111215" }}>
              {selectedStatuses.length > 1 ? `${selectedStatuses.length} statuses` : "Any"}
            </option>
            {Object.keys(STATUS_CONFIG).map((sk) => (
              <option key={sk} value={sk} style={{ backgroundColor: "#111215" }}>
                {STATUS_CONFIG[sk].label}
              </option>
            ))}
          </select>
        </div>

        {/* Box 6: Priority Selector */}
        <div
          style={{
            backgroundColor: "#111215",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: "8px",
            padding: "6px 12px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <label
            htmlFor="priority-select"
            style={{
              fontSize: "10.5px",
              color: "#8e8e93",
              display: "block",
              lineHeight: "1.2",
              marginBottom: "2px",
            }}
          >
            Priority
          </label>
          <select
            id="priority-select"
            aria-label="Priority"
            value={selectedPriorities.length === 1 ? selectedPriorities[0] : ""}
            onChange={(e) => {
              const val = e.target.value;
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete("priority");
                if (val) next.append("priority", val);
                return next;
              });
            }}
            style={{
              backgroundColor: "transparent",
              border: "none",
              color: "#ffffff",
              fontSize: "13px",
              outline: "none",
              cursor: "pointer",
              padding: 0,
              width: "100%",
            }}
          >
            <option value="" style={{ backgroundColor: "#111215" }}>
              {selectedPriorities.length > 1 ? `${selectedPriorities.length} priorities` : "Any"}
            </option>
            {["urgent", "high", "medium", "low"].map((pk) => (
              <option key={pk} value={pk} style={{ backgroundColor: "#111215" }}>
                {PRIORITY_CONFIG[pk].label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Multi-Select Chips for Quick Toggle (Preserving test requirements) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          flexWrap: "wrap",
          padding: "2px 0",
        }}
      >
        <span style={{ fontSize: "11px", color: "#71717a", textTransform: "uppercase", letterSpacing: "0.05em", marginRight: "4px" }}>
          Quick filters:
        </span>
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
              style={{
                fontSize: "11.5px",
                padding: "3px 8px",
                borderRadius: "4px",
                backgroundColor: isSelected ? "#26282e" : "transparent",
                border: isSelected ? "1px solid #ffffff" : "1px solid rgba(255, 255, 255, 0.1)",
                color: isSelected ? "#ffffff" : "#8e8e93",
                cursor: "pointer",
              }}
            >
              {meta.label}
            </button>
          );
        })}

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
              style={{
                fontSize: "11.5px",
                padding: "3px 8px",
                borderRadius: "4px",
                backgroundColor: isSelected ? "#26282e" : "transparent",
                border: isSelected ? "1px solid #ffffff" : "1px solid rgba(255, 255, 255, 0.1)",
                color: isSelected ? "#ffffff" : "#8e8e93",
                cursor: "pointer",
              }}
            >
              {meta.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
