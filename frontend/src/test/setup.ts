import "@testing-library/jest-dom";
import { beforeAll, afterEach, afterAll, beforeEach, vi } from "vitest";
import { server } from "./mocks/server";

beforeAll(() => {
  server.listen({ onUnhandledRequest: "bypass" });
});

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
});

afterAll(() => {
  server.close();
});
