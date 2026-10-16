import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { DashboardPage } from "../pages/DashboardPage";
import { mockUser, mockMemberships } from "./mocks/handlers";

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
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
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}

describe("Dashboard Page (Screen 3)", () => {
  it("renders attention cards with counts from /dashboard/summary", async () => {
    renderDashboard();

    // Verify 5 attention cards
    await waitFor(() => {
      expect(screen.getByTestId("card-assigned_to_me")).toHaveTextContent("4");
      expect(screen.getByTestId("card-unassigned_urgent")).toHaveTextContent("2");
      expect(screen.getByTestId("card-awaiting_my_approval")).toHaveTextContent("1");
      expect(screen.getByTestId("card-overdue")).toHaveTextContent("3");
      expect(screen.getByTestId("card-stale")).toHaveTextContent("5");
    });

    // Verify cards link to corresponding /items?view=
    expect(screen.getByTestId("card-assigned_to_me")).toHaveAttribute("href", "/items?view=assigned_to_me");
    expect(screen.getByTestId("card-unassigned_urgent")).toHaveAttribute("href", "/items?view=unassigned_urgent");
    expect(screen.getByTestId("card-overdue")).toHaveAttribute("href", "/items?view=overdue");
  });

  it("renders top-5 preview for the first non-empty view", async () => {
    renderDashboard();

    // First non-empty view is 'Assigned to Me' (count: 4)
    await waitFor(() => {
      expect(screen.getByText(/Top Priority Preview: Assigned to Me/i)).toBeInTheDocument();
      expect(screen.getByText("Database connection pool exhaustion")).toBeInTheDocument();
    });
  });
});
