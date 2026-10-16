import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./context/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AppShell } from "./components/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ItemsListPage } from "./pages/ItemsListPage";
import { ItemDetailPage } from "./pages/ItemDetailPage";
import { CreateItemPage } from "./pages/CreateItemPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ApiError } from "./api/client";

// Global TanStack QueryClient with spec rules:
// - staleTime: ~10s
// - Mutations: NEVER auto-retry
// - GET queries: retry at most 2 times (and never retry 4xx errors)
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && [401, 403, 404, 409, 422].includes(error.status)) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false, // Rule: Never auto-retry mutations
    },
  },
});

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="items" element={<ItemsListPage />} />
              <Route path="items/new" element={<CreateItemPage />} />
              <Route path="items/:id" element={<ItemDetailPage />} />
            </Route>

            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
};
