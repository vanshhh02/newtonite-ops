# Frontend Engineering Decisions & Architecture

## 1. State Management Architecture

* **Server State vs. Client State Separation:**
  Server state is entirely owned and synchronized via **TanStack Query v5**. Every operational item and list query uses stable cache keys (`['items', filterParams]`, `['item', id]`, `['activity', id]`) with a `staleTime` of 10s. Mutations never directly mutate global state; they update the cache or invalidate queries.
* **URL as the Single Source of Truth for Filters:**
  All items list filter parameters (`view`, `type`, `status`, `priority`, `assignee`, `team_id`, `q`, `sort`) are strictly bound to the browser's URL query string via React Router's `useSearchParams`. The UI state always round-trips through the URL. This guarantees deep-linking, bookmarkability, and seamless browser back/forward navigation. Keyset cursor pagination represents transient scroll position, remaining decoupled from filter criteria.
* **Local Component State for Transient UI:**
  `useState` and controlled dialog states are used strictly for local, transient component interactions (dialog visibility, unsaved comment draft, debounced search buffer). Redux was deliberately omitted to eliminate synchronization overhead and unnecessary boilerplate.

---

## 2. Concurrency-Aware Optimistic Updates & Reconciliation Strategy

Concurrency correctness is the primary operational requirement of this system:

* **Intent-Scoped Idempotency Keys:**
  Every user intent (clicking "Claim", opening an edit modal, or typing a comment) generates a UUID v4 idempotency key exactly once. If a request times out or encounters a network error (outcome unknown), the user is presented with a *"We couldn't confirm this went through"* banner with a **Retry** button that resends with the **exact same idempotency key**. A new intent (such as submitting a different comment) generates a fresh key.
* **In-Flight Action Locking:**
  All mutating action buttons on an item are disabled the instant an action begins. This completely prevents double-click duplicates and avoids sending stale-version payloads while a request is in flight.
* **Sequential Version Tracking (`expected_version`):**
  Mutating endpoints send the current `item.version` as `expected_version`. Upon every mutation success, the returned `Item` (with incremented `version`) is immediately written into TanStack Query's cache (`queryClient.setQueryData`), ensuring that subsequent actions immediately execute against the latest server version without requiring a separate network roundtrip.
* **Optimistic Updates & Snapshot Rollbacks:**
  Actions such as **Claim**, **Release**, and **Transition** update the local cache immediately in `onMutate` with an automatic snapshot taken for rollback. If the server responds with an error:
  * **409 `already_claimed`:** The optimistic state is rolled back, the cache is updated with `details.current`, and an alert banner shows `"<name> just claimed this item"`.
  * **409 `version_conflict` / `invalid_transition`:** The optimistic update is rolled back, `details.current` is written into the query cache, and the UI displays `"This item changed on the server - showing the latest version"`.
  * **422 `validation_error`:** Server validation errors (`details.fields`) are mapped directly to input field error labels.
  * **Network Error / 5xx:** Rollback occurs and the idempotent retry option is presented.

---

## 3. Polling vs. Push

* **Visibility-Aware Polling:**
  The frontend uses TanStack Query's `refetchInterval` with `refetchIntervalInBackground: false`:
  * Dashboard summary and unread notifications poll every **30 seconds**.
  * Active item detail and activity timeline poll every **15 seconds** while the tab is active.
* **Rationale:**
  Polling over HTTP/1.1 or HTTP/2 is robust, stateless, and firewall-friendly. It avoids the operational complexity of managing persistent WebSocket connections, heartbeat timeouts, reconnection storms, and stateful socket gateways across scaled backend instances.
* **Stale Edit Warning:**
  If background polling fetches an updated `item.version` while the user is actively typing in the Edit modal, a warning banner alerts the user (`"This item was updated remotely - submitting will trigger a conflict check"`) without overwriting their in-progress form inputs.

---

## 4. What Was Intentionally Not Built (Scope Discipline)

* **Drag-and-Drop Board / Kanban:**
  Not suitable for operational datasets with tens of thousands of items where keyset pagination and server-side filtering are mandatory. A fast, filterable, keyboard-operable table provides higher operational velocity under pressure.
* **Complex 3-Way Merge Draft Reconciliation:**
  Per the project's cut line, draft preservation with three-way diff merging was omitted in favor of the clean, deterministic MUST behavior: a clear conflict banner displaying the freshest server data from `details.current`.
* **Out of Scope:**
  Dark mode toggles (a single cohesive dark theme is used), WebSockets/SSE, i18n localization, and chart visualizations.

---

## 5. Known Limitations

1. **Polling Latency:** Real-time freshness is bounded by the 15s/30s polling window rather than instantaneous sub-second push notifications.
2. **Token in `localStorage`:** The JWT access token is stored in `localStorage` for rapid client-side inspection and simple header attachment. In an enterprise bank environment, `httpOnly`, `SameSite=Strict` cookies with CSRF tokens would be preferred.
3. **No DOM Virtualization:** List rows are heavily memoized using `React.memo` and keyset pagination bounds loaded items to chunks of 50. For views loading over 1,000 continuous items in a single DOM viewport, virtualization via `@tanstack/react-virtual` would be added.
