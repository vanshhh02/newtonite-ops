import { describe, it, expect } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "./mocks/server";
import { AuthContext } from "../context/AuthContext";
import { ItemDetailPage } from "../pages/ItemDetailPage";
import { mockUser, mockMemberships, mockItem, setActiveMockItem } from "./mocks/handlers";
import { Item } from "../api/types";

function renderDetailPage(itemId = 101) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  const authValue = {
    user: mockUser,
    memberships: mockMemberships,
    selectedTeamId: null,
    setSelectedTeamId: () => {},
    teamFilter: "all",
    setTeamFilter: () => {},
    isAuthenticated: true,
    isLoading: false,
    login: async () => {},
    logout: () => {},
    refreshMe: async () => {},
  };

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={authValue}>
        <MemoryRouter initialEntries={[`/items/${itemId}`]}>
          <Routes>
            <Route path="/items/:id" element={<ItemDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}

describe("Concurrency-Aware Actions (Tests 1, 2, 3, 4, 5, 8)", () => {
  it("Test 1: Double-clicking Claim sends exactly one request due to in-flight button disable", async () => {
    let claimCount = 0;
    server.use(
      http.post("http://localhost:8000/items/:id/claim", async () => {
        claimCount++;
        // Small delay to simulate network latency
        await new Promise((res) => setTimeout(res, 50));
        return HttpResponse.json({
          ...mockItem,
          assignee: { id: mockUser.id, name: mockUser.name },
          version: 2,
          allowed_actions: ["release"],
        });
      })
    );

    renderDetailPage(101);

    const claimBtn = await screen.findByTestId("claim-button");
    expect(claimBtn).toBeInTheDocument();

    // Trigger rapid double-click: first click initiates mutation and disables button
    fireEvent.click(claimBtn);
    fireEvent.click(claimBtn);

    await waitFor(() => {
      expect(screen.getByTestId("release-button")).toBeInTheDocument();
    });

    expect(claimCount).toBe(1);
  });

  it("Test 2: Claim -> 409 already_claimed rolls back optimistic state and shows who claimed it", async () => {
    const claimedByOther: Item = {
      ...mockItem,
      assignee: { id: 99, name: "Siddharth Rao" },
      version: 2,
      allowed_actions: [],
    };

    server.use(
      http.post("http://localhost:8000/items/:id/claim", () => {
        setActiveMockItem(claimedByOther);
        return HttpResponse.json(
          {
            error: {
              code: "already_claimed",
              message: "Work item is already claimed by another user",
              details: { current: claimedByOther },
            },
          },
          { status: 409 }
        );
      })
    );

    renderDetailPage(101);

    const claimBtn = await screen.findByTestId("claim-button");
    fireEvent.click(claimBtn);

    // Conflict banner displays claimant name
    await waitFor(() => {
      expect(screen.getByText(/Siddharth Rao just claimed this item/i)).toBeInTheDocument();
    });

    // Assignee in details panel shows the latest claimant, not the local user
    expect(screen.getAllByText("Siddharth Rao").length).toBeGreaterThan(0);
  });

  it("Test 3: Retry after a network error reuses the same Idempotency-Key", async () => {
    const receivedKeys: string[] = [];
    let attempts = 0;

    server.use(
      http.post("http://localhost:8000/items/:id/claim", ({ request }) => {
        attempts++;
        const key = request.headers.get("Idempotency-Key") || "";
        receivedKeys.push(key);

        if (attempts === 1) {
          // Simulate 500 / network error on first attempt
          return HttpResponse.json(
            { error: { code: "internal_error", message: "Timeout" } },
            { status: 500 }
          );
        }

        // Second attempt succeeds
        return HttpResponse.json({
          ...mockItem,
          assignee: { id: mockUser.id, name: mockUser.name },
          version: 2,
          allowed_actions: ["release"],
        });
      })
    );

    renderDetailPage(101);

    const claimBtn = await screen.findByTestId("claim-button");
    fireEvent.click(claimBtn);

    // Banner indicates unknown network outcome with Retry
    const retryBtn = await screen.findByRole("button", { name: /Retry \(same intent\)/i });
    expect(retryBtn).toBeInTheDocument();

    // Click retry
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByTestId("release-button")).toBeInTheDocument();
    });

    // Exactly 2 attempts, and both used the IDENTICAL idempotency key!
    expect(receivedKeys.length).toBe(2);
    expect(receivedKeys[0]).toBeTruthy();
    expect(receivedKeys[0]).toBe(receivedKeys[1]);
  });

  it("Test 4: version_conflict on an action shows the conflict banner and renders latest item from details.current", async () => {
    const serverUpdatedItem: Item = {
      ...mockItem,
      title: "Title updated concurrently by teammate",
      version: 4,
      status: "in_progress",
      allowed_actions: ["release"],
    };

    server.use(
      http.post("http://localhost:8000/items/:id/transition", () => {
        setActiveMockItem(serverUpdatedItem);
        return HttpResponse.json(
          {
            error: {
              code: "version_conflict",
              message: "Version conflict: item has been modified",
              details: { current: serverUpdatedItem },
            },
          },
          { status: 409 }
        );
      })
    );

    renderDetailPage(101);

    // Click transition button
    const transitionBtn = await screen.findByTestId("transition-in_progress");
    fireEvent.click(transitionBtn);

    // Conflict banner appears
    await waitFor(() => {
      expect(screen.getByText(/This item changed on the server - showing the latest version/i)).toBeInTheDocument();
    });

    // Content renders from details.current
    expect(screen.getByText("Title updated concurrently by teammate")).toBeInTheDocument();
    expect(screen.getByText("v4")).toBeInTheDocument();
  });

  it("Test 5: Two actions in sequence on one item: the second request uses the version returned by the first", async () => {
    let capturedReleaseVersion: number | null = null;

    server.use(
      // 1. First action: transition returns version: 2
      http.post("http://localhost:8000/items/:id/transition", () => {
        const v2Item = {
          ...mockItem,
          version: 2,
          status: "in_progress",
          allowed_actions: ["release", "comment"],
        };
        setActiveMockItem(v2Item);
        return HttpResponse.json(v2Item);
      }),
      // 2. Second action: release receives expected_version
      http.post("http://localhost:8000/items/:id/release", async ({ request }) => {
        const body: any = await request.json();
        capturedReleaseVersion = body.expected_version;
        const v3Item = {
          ...mockItem,
          version: 3,
          status: "open",
          assignee: null,
          allowed_actions: ["claim"],
        };
        setActiveMockItem(v3Item);
        return HttpResponse.json(v3Item);
      })
    );

    renderDetailPage(101);

    // Action 1: transition
    const transBtn = await screen.findByTestId("transition-in_progress");
    fireEvent.click(transBtn);

    // Wait for version 2 to reflect in the UI
    await waitFor(() => {
      expect(screen.getByText("v2")).toBeInTheDocument();
    });

    // Action 2: release
    const releaseBtn = await screen.findByTestId("release-button");
    fireEvent.click(releaseBtn);

    await waitFor(() => {
      expect(screen.getByText("v3")).toBeInTheDocument();
    });

    // Assert the second request used version 2 returned by the first request!
    expect(capturedReleaseVersion).toBe(2);
  });

  it("Test 8: Action buttons render only for what allowed_actions contains", async () => {
    // Only claim & edit allowed
    server.use(
      http.get("http://localhost:8000/items/101", () => {
        return HttpResponse.json({
          ...mockItem,
          allowed_actions: ["claim", "edit"],
        });
      })
    );

    renderDetailPage(101);

    await waitFor(() => {
      expect(screen.getByTestId("claim-button")).toBeInTheDocument();
      expect(screen.getByTestId("edit-button")).toBeInTheDocument();
    });

    // Disallowed actions must not render
    expect(screen.queryByTestId("release-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("assign-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("transition-in_progress")).not.toBeInTheDocument();
  });
});
