import React, { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { fetchItems, ItemsFilterParams } from "../api/items";
import { ItemsFilterBar } from "../components/ItemsFilterBar";
import { ItemRow } from "../components/ItemRow";

export const ItemsListPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { teamFilter } = useAuth();

  // Extract filter parameters from URL
  const view = searchParams.get("view") || "all";
  const types = searchParams.getAll("type");
  const statuses = searchParams.getAll("status");
  const priorities = searchParams.getAll("priority");
  const assignee = searchParams.get("assignee") || undefined;
  const q = searchParams.get("q") || undefined;
  const sort = searchParams.get("sort") || "updated";

  // Resolve team filter: URL param takes precedence, then AppShell teamFilter
  const urlTeamId = searchParams.get("team_id");
  const effectiveTeamId = urlTeamId
    ? Number(urlTeamId)
    : teamFilter !== "all"
    ? Number(teamFilter)
    : null;

  const filterParams: ItemsFilterParams = useMemo(
    () => ({
      view,
      team_id: effectiveTeamId,
      types: types.length > 0 ? types : undefined,
      statuses: statuses.length > 0 ? statuses : undefined,
      priorities: priorities.length > 0 ? priorities : undefined,
      assignee,
      q,
      sort,
      limit: 50,
    }),
    [view, effectiveTeamId, types.join(","), statuses.join(","), priorities.join(","), assignee, q, sort]
  );

  const queryKey = useMemo(() => ["items", filterParams], [filterParams]);

  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchItems(filterParams, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    staleTime: 10_000,
    retry: 2,
    refetchOnWindowFocus: true,
  });

  const items = useMemo(() => {
    return data?.pages.flatMap((page) => page.items) ?? [];
  }, [data]);

  return (
    <div style={{ padding: "8px 0" }}>
      {/* 1. Page Header (Matching Image 3) */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: "20px",
          gap: "16px",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: "24px",
              fontWeight: "700",
              color: "#ffffff",
              letterSpacing: "-0.01em",
              marginBottom: "4px",
            }}
          >
            Items
          </h1>
          <p style={{ color: "#8e8e93", fontSize: "14px" }}>
            Filter results without loading the whole operation.
          </p>
        </div>

        <Link
          to="/items/new"
          className="btn-primary"
          style={{
            backgroundColor: "#ffffff",
            color: "#111111",
            fontWeight: "600",
            borderRadius: "8px",
            padding: "8px 18px",
            fontSize: "13.5px",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          New item
        </Link>
      </div>

      {/* 2. Filter Bar (Tabs + Filter Inputs) */}
      <ItemsFilterBar />

      {/* Error State */}
      {isError && (
        <div className="banner banner-danger" role="alert" style={{ marginBottom: "16px" }}>
          <div>
            <strong>Error loading items:</strong>{" "}
            {(error as any)?.message || "Failed to communicate with server."}
          </div>
          <button type="button" className="btn-secondary" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      )}

      {/* 3. Items Data Table in Rounded Card (Matching Image 3) */}
      <div
        style={{
          backgroundColor: "#111215",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: "12px",
          overflow: "hidden",
        }}
      >
        <table
          className="data-table"
          style={{
            width: "100%",
            borderCollapse: "collapse",
            textAlign: "left",
            fontSize: "13.5px",
          }}
        >
          <thead>
            <tr
              style={{
                borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
              }}
            >
              <th style={{ padding: "14px 16px", color: "#71717a", fontWeight: "500", fontSize: "13px" }}>Key</th>
              <th style={{ padding: "14px 16px", color: "#71717a", fontWeight: "500", fontSize: "13px" }}>Title</th>
              <th style={{ padding: "14px 16px", color: "#71717a", fontWeight: "500", fontSize: "13px" }}>Type</th>
              <th style={{ padding: "14px 16px", color: "#71717a", fontWeight: "500", fontSize: "13px" }}>Status</th>
              <th style={{ padding: "14px 16px", color: "#71717a", fontWeight: "500", fontSize: "13px" }}>Priority</th>
              <th style={{ padding: "14px 16px", color: "#71717a", fontWeight: "500", fontSize: "13px" }}>Assignee</th>
              <th style={{ padding: "14px 16px", color: "#71717a", fontWeight: "500", fontSize: "13px" }}>Due</th>
              <th style={{ padding: "14px 16px", color: "#71717a", fontWeight: "500", fontSize: "13px", textAlign: "right" }}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && items.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", padding: "48px 16px", color: "#8e8e93" }}>
                  Loading operations items...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", padding: "48px 16px", color: "#8e8e93" }}>
                  No items match the active filters.
                </td>
              </tr>
            ) : (
              items.map((item) => <ItemRow key={item.id} item={item} />)
            )}
          </tbody>
        </table>

        {/* Cursor Pagination Footer */}
        {hasNextPage && (
          <div
            style={{
              padding: "16px",
              textAlign: "center",
              borderTop: "1px solid rgba(255, 255, 255, 0.06)",
            }}
          >
            <button
              type="button"
              className="btn-secondary"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              style={{
                borderRadius: "8px",
                padding: "8px 20px",
                fontSize: "13px",
                color: "#ffffff",
                backgroundColor: "#18191e",
                border: "1px solid rgba(255, 255, 255, 0.12)",
              }}
            >
              {isFetchingNextPage ? "Loading more items..." : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
