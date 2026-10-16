import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { ItemsListPage } from "../pages/ItemsListPage";
import { mockUser, mockMemberships } from "./mocks/handlers";

function renderWithProviders(initialEntries: string[] = ["/items"]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
      },
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
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path="/items" element={<ItemsListPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}

describe("Items List & URL Round-trip (Test requirement 6)", () => {
  it("initializes filters, tabs, search, and sort from URL query string", async () => {
    renderWithProviders([
      "/items?view=unassigned_urgent&type=incident&priority=urgent&sort=due&q=database",
    ]);

    // 1. View Tab is active
    const urgentTab = screen.getByRole("tab", { name: "Unassigned Urgent" });
    expect(urgentTab).toHaveAttribute("aria-selected", "true");

    // 2. Type filter chip for 'Incident' is active
    const incidentChip = screen.getByRole("button", { name: "Incident" });
    expect(incidentChip).toHaveAttribute("aria-pressed", "true");

    // 3. Priority filter chip for 'Urgent' is active
    const priorityChip = screen.getByRole("button", { name: /Urgent/i });
    expect(priorityChip).toHaveAttribute("aria-pressed", "true");

    // 4. Search input has value 'database'
    const searchInput = screen.getByPlaceholderText(/Search by title or description/i);
    expect(searchInput).toHaveValue("database");

    // 5. Sort select has value 'due'
    const sortSelect = screen.getByLabelText("Sort");
    expect(sortSelect).toHaveValue("due");

    // Items load from mock
    await waitFor(() => {
      expect(screen.getByText("Database connection pool exhaustion")).toBeInTheDocument();
    });
  });

  it("updates active tab when a different view tab is clicked", async () => {
    renderWithProviders(["/items?view=all"]);

    const overdueTab = screen.getByRole("tab", { name: "Overdue" });
    expect(overdueTab).toHaveAttribute("aria-selected", "false");

    await userEvent.click(overdueTab);

    expect(overdueTab).toHaveAttribute("aria-selected", "true");
  });

  it("toggles filter chips when clicked", async () => {
    renderWithProviders(["/items"]);

    const incidentChip = screen.getByRole("button", { name: "Incident" });
    expect(incidentChip).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(incidentChip);
    expect(incidentChip).toHaveAttribute("aria-pressed", "true");

    // Click again to toggle off
    await userEvent.click(incidentChip);
    expect(incidentChip).toHaveAttribute("aria-pressed", "false");
  });

  it("appends cursor-paginated items when Load more is clicked", async () => {
    renderWithProviders(["/items"]);

    // First page items render
    await waitFor(() => {
      expect(screen.getByText("Database connection pool exhaustion")).toBeInTheDocument();
    });

    const loadMoreButton = screen.getByRole("button", { name: /Load more/i });
    expect(loadMoreButton).toBeInTheDocument();

    await userEvent.click(loadMoreButton);

    // Page 2 item appended
    await waitFor(() => {
      expect(screen.getByText("Memory leak in background worker")).toBeInTheDocument();
    });

    // Page 1 item is still present (appended, not replaced)
    expect(screen.getByText("Database connection pool exhaustion")).toBeInTheDocument();
  });
});
