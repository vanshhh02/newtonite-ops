import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { apiFetch, setToken, clearToken, getToken } from "../api/client";
import { MeResponse, UserBrief, TeamMembership } from "../api/types";

interface AuthContextType {
  user: UserBrief | null;
  memberships: TeamMembership[];
  selectedTeamId: number | null; // null represents "All my teams"
  setSelectedTeamId: (teamId: number | null) => void;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserBrief | null>(null);
  const [memberships, setMemberships] = useState<TeamMembership[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(() => {
    const saved = localStorage.getItem("newtonite_team_id");
    return saved ? Number(saved) : null;
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const handleSetSelectedTeamId = (teamId: number | null) => {
    setSelectedTeamId(teamId);
    if (teamId !== null) {
      localStorage.setItem("newtonite_team_id", String(teamId));
    } else {
      localStorage.removeItem("newtonite_team_id");
    }
  };

  const refreshMe = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setUser(null);
      setMemberships([]);
      setIsLoading(false);
      return;
    }

    try {
      const data = await apiFetch<MeResponse>("/me");
      setUser(data.user);
      setMemberships(data.memberships);
    } catch {
      clearToken();
      setUser(null);
      setMemberships([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const data = await apiFetch<{ access_token: string; user: UserBrief }>("/auth/login", {
        method: "POST",
        body: { email, password },
      });
      setToken(data.access_token);
      await refreshMe();
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    clearToken();
    setUser(null);
    setMemberships([]);
    localStorage.removeItem("newtonite_team_id");
    window.location.href = "/login";
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        memberships,
        selectedTeamId,
        setSelectedTeamId: handleSetSelectedTeamId,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
        refreshMe,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
