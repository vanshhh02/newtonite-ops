# Newtonite Operations Frontend

A high-performance, concurrency-aware operations management web application built for operational coordination under pressure. Designed to handle large data volumes with server-side keyset cursor pagination, URL-synchronized filtering, and robust optimistic concurrency controls.

---

## Tech Stack

* **Framework:** React 18 + TypeScript + Vite
* **Routing:** React Router v6
* **Server State & Cache:** TanStack Query v5
* **Styling:** Vanilla CSS design tokens (`tokens.css`, `index.css`) — zero heavy UI kit dependencies
* **Testing:** Vitest + React Testing Library + Mock Service Worker (MSW v2)
* **Production Serving:** Nginx on Alpine Linux

---

## Environment Variables

Copy `frontend/.env.example` to `frontend/.env`:

```bash
cp frontend/.env.example frontend/.env
```

| Variable | Default | Description |
| :--- | :--- | :--- |
| `VITE_API_URL` | `http://localhost:8000` | Base URL for backend FastAPI API requests |
| `VITE_MOCK` | `0` | Set to `1` to run in-memory MSW mocking if backend is offline |

---

## Development Setup

### 1. Install Dependencies
```bash
cd frontend
npm install
```

### 2. Start Local Development Server
```bash
npm run dev
```
The application will be available at [http://localhost:5173](http://localhost:5173).

---

## Running Tests

Run the full non-interactive test suite:

```bash
npm test -- --run
```

All 16 test cases cover:
1. **Double-click prevention:** Claim button disables immediately on click; exactly one request dispatched.
2. **409 `already_claimed` handling:** Rolls back optimistic claim and displays who claimed it.
3. **Idempotency key reuse:** Network error retry resends with the identical `Idempotency-Key` header.
4. **409 `version_conflict` resolution:** Displays conflict banner and updates UI with latest item from `details.current`.
5. **Sequential version tracking:** Second action uses the updated `version` returned by the first action.
6. **URL filter round-trip:** Multi-select types, statuses, priorities, search, and sort sync bi-directionally with URL query string.
7. **401 handling:** Clears expired token and redirects to `/login` preserving `returnUrl`.
8. **Permission-driven action buttons:** Action bar buttons render strictly for entries in `item.allowed_actions`.

---

## Production Build & Verification

Type-check with `tsc` and produce the optimized bundle:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

---

## Docker & Container Deployment

Build the multi-stage Docker image and run with Nginx:

```bash
# Build the container with custom or default API URL
docker build --build-arg VITE_API_URL=http://localhost:8000 -t newtonite-ops-frontend ./frontend

# Run container mapping port 3000 to port 80
docker run -p 3000:80 newtonite-ops-frontend
```

Now open [http://localhost:3000](http://localhost:3000).
