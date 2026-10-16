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

  // Stable query key ensures cache isolation and no refetch storms
  const queryKey = useMemo(() => ["items", filterParams], [filterParams]);

  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetching,
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

  // Flatten items across all cursor pages
  const items = useMemo(() => {
    return data?.pages.flatMap((page) => page.items) ?? [];
  }, [data]);

  return (
    <div>
      {/* Page Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "16px",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
          <h1 style={{ fontSize: "20px", fontWeight: "700", color: "var(--text-primary)" }}>
            Operations Items
          </h1>
          {isFetching && !isLoading && !isFetchingNextPage && (
            <span
              style={{
                fontSize: "12px",
                color: "var(--accent-primary)",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              ● Refreshing...
            </span>
          )}
        </div>

        <Link to="/items/new" className="btn-primary" style={{ textDecoration: "none" }}>
          + New Item
        </Link>
      </div>

      {/* Filter and View Controls (URL Source of Truth) */}
      <ItemsFilterBar />

      {/* Error State */}
      {isError && (
        <div className="banner banner-danger" role="alert">
          <div>
            <strong>Error loading items:</strong>{" "}
            {(error as any)?.message || "Failed to communicate with server."}
          </div>
          <button type="button" className="btn-secondary" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      )}

      {/* Data Table Container */}
      <div className="table-container">
        <table className="data-table" aria-label="Work items list">
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">Title</th>
              <th scope="col">Type</th>
              <th scope="col">Priority</th>
              <th scope="col">Status</th>
              <th scope="col">Assignee</th>
              <th scope="col">Due Date</th>
              <th scope="col" style={{ textAlign: "right" }}>
                Updated
              </th>
            </tr>
          </thead>
          <tbody>
            {/* Loading Skeleton */}
            {isLoading && (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", padding: "40px" }}>
                  <div style={{ color: "var(--text-secondary)" }}>Loading work items...</div>
                </td>
              </tr>
            )}

            {/* Empty State */}
            {!isLoading && items.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <div className="empty-state">
                    <h3>No items found</h3>
                    <p>There are no operational items matching your current filters and view criteria.</p>
                  </div>
                </td>
              </tr>
            )}

            {/* Render Rows */}
            {!isLoading && items.map((item) => <ItemRow key={item.id} item={item} />)}
          </tbody>
        </table>

        {/* Keyset Cursor Pagination Footer */}
        {!isLoading && items.length > 0 && (
          <div className="pagination-footer">
            <span>
              Showing <strong>{items.length}</strong> items
            </span>

            {hasNextPage ? (
              <button
                type="button"
                className="btn-secondary"
                disabled={isFetchingNextPage}
                onClick={() => fetchNextPage()}
              >
                {isFetchingNextPage ? "Loading more items..." : "Load more (50 items)"}
              </button>
            ) : (
              <span style={{ color: "var(--text-muted)" }}>All matching items loaded</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
