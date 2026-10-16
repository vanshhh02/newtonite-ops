import "@testing-library/jest-dom";
import { beforeAll, afterEach, afterAll, beforeEach, vi } from "vitest";
import { server } from "./mocks/server";
import { resetActiveMockItem } from "./mocks/handlers";

beforeAll(() => {
  server.listen({ onUnhandledRequest: "bypass" });
});

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  server.resetHandlers();
  resetActiveMockItem();
  localStorage.clear();
});

afterAll(() => {
  server.close();
});
