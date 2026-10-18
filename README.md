# Newtonite Ops — Operations Under Pressure

Newtonite Ops is an internal operational command center designed to replace chaotic spreadsheet, chat, and email coordination. It coordinates critical customer issues, payment holds, security compliance reviews, and emergency incidents across cross-functional teams with bulletproof concurrency control, four-eyes approval workflows, transactional outbox notifications, and an immutable append-only audit trail.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Option 1: Quick Start with Docker (Recommended)](#option-1-quick-start-with-docker-recommended)
- [Option 2: Running Locally from Source (Step-by-Step)](#option-2-running-locally-from-source-step-by-step)
  - [Step 1: Clone the Repository](#step-1-clone-the-repository)
  - [Step 2: Start PostgreSQL Database](#step-2-start-postgresql-database)
  - [Step 3: Backend Setup & Launch](#step-3-backend-setup--launch)
  - [Step 4: Launch Outbox Background Worker](#step-4-launch-outbox-background-worker)
  - [Step 5: Frontend Setup & Launch](#step-5-frontend-setup--launch)
- [Demo Credentials](#demo-credentials)
- [Interactive Demo Walkthrough](#interactive-demo-walkthrough)
- [Running the Automated Test Suites](#running-the-automated-test-suites)
  - [Backend Pytest Suite (21 Tests)](#backend-pytest-suite-21-tests)
  - [Frontend Vitest Suite (16 Tests)](#frontend-vitest-suite-16-tests)
  - [Production Build Validation](#production-build-validation)
- [Architecture & Design Details](#architecture--design-details)
- [API Contract Overview](#api-contract-overview)
- [Database Query Execution Plans (EXPLAIN ANALYZE)](#database-query-execution-plans-explain-analyze)
- [Troubleshooting & FAQ](#troubleshooting--faq)
- [Known Limitations & Next Steps](#known-limitations)

---

## Prerequisites

| Tool | Recommended Version | Purpose |
| :--- | :--- | :--- |
| **Docker & Docker Compose** | Docker 24+, Compose v2 | Single-command launch of all services |
| **Python** *(if running locally without Docker)* | Python 3.12+ | FastAPI backend & background worker |
| **Node.js** *(if running locally without Docker)* | Node.js 18+ (Node 20+ recommended) | React + Vite frontend |
| **PostgreSQL** *(if running locally without Docker)* | PostgreSQL 16+ | Primary database |

---

## Option 1: Quick Start with Docker (Recommended)

The entire production stack (PostgreSQL 16, FastAPI backend, outbox notification worker, and dark-themed React frontend served via Nginx) starts with a single command.

### 1. Launch the Stack

From the root directory of the repository:

```bash
docker compose up --build
```

### 2. What Happens Automatically on Startup

1. **PostgreSQL Container (`newtonite-db`)**: Initializes on port `5432` and passes built-in health checks (`pg_isready`).
2. **Backend Container (`newtonite-api`)**:
   * Waits for PostgreSQL healthcheck to turn healthy.
   * Runs database migrations via Alembic (`alembic upgrade head`).
   * Automatically executes the idempotent seed script (`python -m app.seed`).
   * Populates 4 teams, 12 users across all roles, and ~5,000 realistic operational work items with audit histories.
   * Starts FastAPI on port `8000`.
3. **Worker Container (`newtonite-worker`)**: Starts the background outbox daemon (`python -m app.worker`) polling for pending notifications every 2 seconds.
4. **Frontend Container (`newtonite-web`)**: Compiles the React + TypeScript SPA and serves it through Nginx on port `5173`.

### 3. Access the Applications

* **Frontend Web App**: [http://localhost:5173](http://localhost:5173)
* **Backend Swagger API Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)
* **Backend ReDoc Docs**: [http://localhost:8000/redoc](http://localhost:8000/redoc)
* **API Health Check**: [http://localhost:8000/health](http://localhost:8000/health)

### 4. Stopping the Stack

To stop containers while preserving database state:
```bash
docker compose down
```

To stop containers and wipe the database volume for a fresh start:
```bash
docker compose down -v
```

---

## Option 2: Running Locally from Source (Step-by-Step)

If you prefer to run the backend, worker, and frontend natively for development:

### Step 1: Clone the Repository

```bash
git clone https://github.com/vanshhh02/newtonite-ops.git
cd newtonite-ops
```

---

### Step 2: Start PostgreSQL Database

You need a running PostgreSQL 16 instance. The fastest method is running a standalone Docker container:

```bash
docker run -d \
  --name newtonite-postgres \
  -p 5432:5432 \
  -e POSTGRES_DB=newtonite \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  postgres:16-alpine
```

*(If using an existing PostgreSQL service, adjust the `DATABASE_URL` in your configuration to point to your instance.)*

---

### Step 3: Backend Setup & Launch

Open a terminal window:

```bash
# 1. Navigate to backend directory
cd backend

# 2. Create and activate a Python 3.12 virtual environment
python3 -m venv .venv
source .venv/bin/activate

# 3. Install backend dependencies
pip install -r requirements.txt

# 4. Copy environment configuration
cp ../.env.example .env

# 5. Run database migrations to create all tables, indexes, and triggers
alembic upgrade head

# 6. Seed the database with demo teams, users, and 5,000 work items
python -m app.seed

# 7. Start the FastAPI development server with hot reload
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

The backend server is now running at **[http://127.0.0.1:8000](http://127.0.0.1:8000)** (API docs at `/docs`).

---

### Step 4: Launch Outbox Background Worker

The transactional outbox worker polls database events using `SELECT ... FOR UPDATE SKIP LOCKED` and delivers notifications without duplicate side effects.

Open a **second terminal window**:

```bash
cd backend
source .venv/bin/activate

# Start the background worker daemon
python -m app.worker
```

You should see:
```text
[worker] Starting outbox background worker (poll interval: 2.0s)...
```

---

### Step 5: Frontend Setup & Launch

Open a **third terminal window**:

```bash
# 1. Navigate to frontend directory
cd frontend

# 2. Install Node dependencies
npm install

# 3. Start the Vite development server
npm run dev
```

Open your browser and navigate to:
👉 **[http://localhost:5173](http://localhost:5173)**

---

## Demo Credentials

All seeded user accounts share the demo password: **`password123`**

| Role | Email | Name | Primary Team | Permissions & Scope |
| :--- | :--- | :--- | :--- | :--- |
| **Lead** | `lead.core@newtonite.local` | Maya Chen | Core Platform | Lead in Core Platform; **Viewer** in Payments & Risk (cross-team RBAC demo) |
| **Member** | `member.core@newtonite.local` | Jordan Patel | Core Platform | Can create items, claim unassigned items, comment, and resolve |
| **Viewer** | `viewer.core@newtonite.local` | Alex Taylor | Core Platform | Read-only access to Core Platform items; cannot mutate |
| **Lead** | `lead.payments@newtonite.local` | Rehan Ahmed | Payments & Risk | Can approve high-value transactions and reassign tickets |
| **Member** | `member.payments@newtonite.local` | Elena Rostova | Payments & Risk | Operates payment investigation workflow |
| **Lead** | `lead.compliance@newtonite.local`| Priya Sharma | Compliance & Security | Enforces regulatory compliance and four-eyes review |

---

## Interactive Demo Walkthrough

Try these scenarios in the browser at [http://localhost:5173](http://localhost:5173) to see the core technical requirements in action:

### Scenario 1: Cross-Team Role-Based Access Control (RBAC)
1. Sign in as **Maya Chen** (`lead.core@newtonite.local` / `password123`).
2. Go to **Items** (`/items`).
3. Click on a **Core Platform** item (e.g. `OPS-4767`):
   * Maya is a **Lead** here. You will see action buttons (`Release`, `Assign`, `Edit`, `Transition`) and the **Add a comment** input box.
4. Now select a **Payments & Risk** item (e.g. `OPS-4942`):
   * Maya is only a **Viewer** on Payments & Risk.
   * Notice that the UI displays no mutation buttons or comment box (`allowed_actions: []`). Maya has read-only access.

### Scenario 2: Concurrency Conflict Detection (409 Conflict Banner)
1. Open an item (e.g. `/items/101`) in **two side-by-side browser tabs** (or one normal tab and one private tab).
2. In Tab A: Click an action (e.g. Transition or Release). The version advances from `v1` to `v2`.
3. In Tab B: Attempt an action while still looking at the old version.
4. **Result**: Tab B instantly displays the amber **Conflict detected** banner, rolls back optimistic state, and automatically renders the latest server version without data loss.

### Scenario 3: Four-Eyes Approval Workflow
1. Items with status `awaiting_approval` cannot be approved by their assignee.
2. A separate team Lead must review the item and execute the approval transition.
3. Attempting to approve your own item triggers a `403 Forbidden` (`cannot_approve_own_item`).

### Scenario 4: Fast Cursor Pagination & Server-Side Filtering
1. On the **Items** page (`/items`), test filtering by View tab (`Unassigned urgent`, `Overdue`, `Stale`), status chips, priority, and free-text search.
2. Filter state stays synchronized with the URL query parameters (e.g. `?view=unassigned_urgent&type=incident`).
3. Scroll to the bottom and click **Load more** to fetch the next 50 items using keyset cursor pagination (`WHERE (updated_at, id) < (:cursor_updated_at, :cursor_id)`).

---

## Running the Automated Test Suites

### Backend Pytest Suite (21 Tests)

The backend test suite validates all concurrency rules, claim races, idempotency checks, and triggers against a **real PostgreSQL instance**:

```bash
# Using Makefile from root directory:
make test

# Or directly with pytest inside backend:
cd backend
source .venv/bin/activate
pytest -v
```

#### What the 21 Tests Cover:
1. **`test_claim_race.py`**: 20 concurrent threads compete to claim one open item on separate database connections. Proves exactly one 200 winner, nineteen 409 `already_claimed` conflicts, one assignee, and one `claimed` activity event.
2. **`test_stale_writes.py`**: Competing concurrent PATCH operations with matching `expected_version`. Proves one 200 success, one 409 `version_conflict`, and zero lost updates.
3. **`test_idempotency.py`**: Sequential and concurrent duplicate creates produce exactly one item and one event; same key with different payload returns 422 `idempotency_key_reused`; rolled-back transactions do not burn the idempotency key.
4. **`test_workflow.py`**: Invalid state transitions rejected; non-lead approval rejected; assignee self-approval rejected (four-eyes rule); approval requirements enforced; reason requirements strictly enforced on rejections, cancels, and re-opens.
5. **`test_auth_policy.py`**: Role x action matrix; cross-team access returns 404 (does not leak existence); viewers cannot mutate items.
6. **`test_atomicity.py`**: If activity event or outbox insertion fails, item state mutations roll back completely.
7. **`test_worker.py`**: Two concurrent worker threads process outbox records with `SKIP LOCKED` without collisions; duplicate event delivery produces exactly one notification (`ON CONFLICT DO NOTHING`); exponential backoff retry transitions to `dead` after 5 attempts.
8. **`test_pagination.py`**: Keyset cursor pagination produces zero duplicates and zero skipped items even when new rows are inserted between page queries.
9. **`test_activity_events_trigger.py`**: PostgreSQL trigger explicitly rejects any `UPDATE` or `DELETE` on the `activity_events` audit table.
10. **`test_dashboard.py`**: Dashboard metrics aggregate active, overdue, and stale items using partial database indexes.

---

### Frontend Vitest Suite (16 Tests)

The frontend test suite uses Vitest, React Testing Library, and Mock Service Worker (MSW) to verify all interactive and concurrent UI flows:

```bash
cd frontend
npm test -- --run
```

#### What the 16 Tests Cover:
* **Double-click protection**: Rapid clicking of Claim disables the button and sends exactly one request.
* **Optimistic rollback**: 409 `already_claimed` rolls back optimistic assignee and displays who claimed it.
* **Idempotent network retries**: Retrying after network drops reuses the exact same `Idempotency-Key`.
* **Version conflict banners**: `version_conflict` on an action displays the conflict alert banner and refreshes the item to the latest state.
* **Sequential action version tracking**: Action sequence on one item uses the version increment returned by the previous request.
* **Allowed action gating**: Buttons render strictly according to `allowed_actions`.
* **URL query round-trip**: Tabs, search query, sort order, and filter chips initialize and update URL params bidirectionally.
* **Keyset pagination**: "Load more" appends items without clearing previously loaded items.

---

### Production Build Validation

To verify TypeScript type-checking and asset bundling:

```bash
cd frontend
npm run build
```
*(Compiles cleanly with 0 type errors in under 1 second.)*

---

## Architecture & Design Details

```mermaid
graph TD
    Client["Web Client / SPA (:5173)<br/>(JWT Bearer, Dark Theme)"]
    
    subgraph AppServer ["FastAPI Application Server (:8000)"]
        Router["API Routers<br/>/auth, /items, /dashboard, /notifications"]
        Policy["Policy Engine (policy.py)<br/>Centralized RBAC Matrix"]
        Workflow["Workflow Engine (workflow.py)<br/>Declarative Transitions Table"]
        Idem["Idempotency Subsystem<br/>UUID Validation & SHA-256 Hashing"]
    end
    
    subgraph Postgres ["PostgreSQL 16 Database (:5432)"]
        Items["work_items<br/>(Versioned, Generated TSVector)"]
        Activity["activity_events<br/>(Append-Only DB Trigger)"]
        Outbox["outbox<br/>(Pending Queue, Status Index)"]
        Notifs["notifications<br/>(Unique event_id, user_id)"]
        IdemKeys["idempotency_keys<br/>(Unique user_id, key)"]
    end
    
    subgraph WorkerService ["Background Worker Process"]
        Worker["Outbox Worker (worker.py)<br/>SELECT ... FOR UPDATE SKIP LOCKED<br/>Exponential Backoff & Retries"]
    end

    Client -->|HTTP REST + Bearer JWT| Router
    Router --> Policy
    Router --> Workflow
    Router --> Idem
    
    Router -->|Single ACID Transaction| Items
    Router -->|Single ACID Transaction| Activity
    Router -->|Single ACID Transaction| Outbox
    Router -->|Single ACID Transaction| IdemKeys

    Worker -->|Poll Batches| Outbox
    Worker -->|Idempotent ON CONFLICT DO NOTHING| Notifs
    Client -->|Poll Unread Notifications| Notifs
```

### Key Technical Patterns
1. **Atomic Claim**: Single conditional SQL statement (`UPDATE work_items SET assignee_id = :uid, version = version + 1 WHERE id = :id AND assignee_id IS NULL`) guarantees no race conditions.
2. **Optimistic Concurrency Control**: Every write checks `WHERE version = :expected_version` and increments `version = version + 1`. Stale requests fail with `409 version_conflict`.
3. **Transactional Outbox**: Notifications and audit events are committed in the *same* ACID transaction as the state change. The worker delivers notifications via `SELECT ... FOR UPDATE SKIP LOCKED`.
4. **Append-Only Audit Trail**: An explicit PostgreSQL trigger prevents any `UPDATE` or `DELETE` on `activity_events`, guaranteeing immutability.
5. **Keyset Cursor Pagination**: Avoids `OFFSET` performance degradation on large tables; pages items by `(updated_at, id) < (:cursor_updated_at, :cursor_id)`.

---

## API Contract Overview

| Method | Endpoint | Auth | Idempotent | Description |
| :--- | :--- | :---: | :---: | :--- |
| `POST` | `/auth/login` | No | No | Authenticate user credentials; returns JWT bearer token |
| `GET` | `/me` | Yes | No | Get current authenticated user details and team memberships |
| `GET` | `/teams/{team_id}/members` | Yes | No | Get member roster for a team (404 if caller not in team) |
| `POST` | `/items` | Yes | **Yes** | Create new work item (requires `Idempotency-Key` header) |
| `GET` | `/items` | Yes | No | Keyset paginated items list with filters (`view`, `q`, `sort`, `cursor`, `limit`) |
| `GET` | `/items/{id}` | Yes | No | Get item details with computed `allowed_actions` |
| `PATCH` | `/items/{id}` | Yes | No | Optimistic concurrency update (`expected_version` required) |
| `POST` | `/items/{id}/claim` | Yes | **Yes** | Atomic claim via single conditional SQL `UPDATE` |
| `POST` | `/items/{id}/release` | Yes | **Yes** | Release item back to unassigned `open` state |
| `POST` | `/items/{id}/assign` | Yes | **Yes** | Assign/reassign item to team member (lead only) |
| `POST` | `/items/{id}/transition`| Yes | **Yes** | Transition workflow status with rule validation & reason checks |
| `POST` | `/items/{id}/comments` | Yes | **Yes** | Append comment event to item history |
| `GET` | `/items/{id}/activity` | Yes | No | Keyset paginated item activity timeline and discussion |
| `GET` | `/dashboard/summary` | Yes | No | Dashboard metrics (`assigned_to_me`, `unassigned_urgent`, `awaiting_my_approval`, `overdue`, `stale`) |
| `GET` | `/notifications` | Yes | No | Keyset paginated notification feed (`unread_only`, `cursor`, `limit`) |
| `GET` | `/notifications/unread-count` | Yes | No | Fast count of unread notifications |
| `POST` | `/notifications/{id}/read` | Yes | No | Mark single notification as read (returns 204) |
| `POST` | `/notifications/read-all` | Yes | No | Mark all notifications for caller as read (returns 204) |

---

## Database Query Execution Plans (EXPLAIN ANALYZE)

The following execution plans were generated directly on PostgreSQL 16 with the seeded database:

### 1. Active Work Items Query (Filtered by Team & Active Status, Keyset Ordered)
```text
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, team_id, title, type, status, priority, assignee_id, created_by, requires_approval, due_at, version, created_at, updated_at, last_activity_at
FROM work_items
WHERE team_id = 1
  AND status IN ('open', 'in_progress', 'awaiting_approval')
ORDER BY updated_at DESC, id DESC
LIMIT 50;

                                                                  QUERY PLAN                                                                   
-----------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=513.07..513.19 rows=50 width=151) (actual time=1.437..1.444 rows=50 loops=1)
   Buffers: shared hit=394
   ->  Sort  (cost=513.07..515.51 rows=975 width=151) (actual time=1.436..1.438 rows=50 loops=1)
         Sort Key: updated_at DESC, id DESC
         Sort Method: top-N heapsort  Memory: 47kB
         Buffers: shared hit=394
         ->  Bitmap Heap Scan on work_items  (cost=47.84..480.68 rows=975 width=151) (actual time=0.694..1.121 rows=973 loops=1)
               Recheck Cond: ((team_id = 1) AND ((status)::text = ANY ('{open,in_progress,awaiting_approval}'::text[])))
               Heap Blocks: exact=381
               Buffers: shared hit=394
               ->  Bitmap Index Scan on idx_work_items_active  (cost=0.00..47.59 rows=975 width=0) (actual time=0.655..0.655 rows=973 loops=1)
                     Index Cond: (team_id = 1)
                     Buffers: shared hit=13
 Planning Time: 0.250 ms
 Execution Time: 1.465 ms
```

### 2. Unassigned Urgent Query (Using Partial Index `idx_work_items_unassigned_urgent`)
```text
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, team_id, title, type, status, priority, assignee_id, created_by, requires_approval, due_at, version, created_at, updated_at, last_activity_at
FROM work_items
WHERE team_id = 1
  AND assignee_id IS NULL
  AND status = 'open'
  AND priority = 4
LIMIT 50;

                                                                   QUERY PLAN                                                                    
-------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=4.27..43.10 rows=11 width=151) (actual time=0.066..0.377 rows=34 loops=1)
   Buffers: shared hit=40
   ->  Bitmap Heap Scan on work_items  (cost=4.27..43.10 rows=11 width=151) (actual time=0.064..0.367 rows=34 loops=1)
         Recheck Cond: ((team_id = 1) AND (priority = 4) AND (assignee_id IS NULL) AND ((status)::text = 'open'::text))
         Heap Blocks: exact=33
         Buffers: shared hit=40
         ->  Bitmap Index Scan on idx_work_items_unassigned_urgent  (cost=0.00..4.26 rows=11 width=0) (actual time=0.046..0.047 rows=34 loops=1)
               Index Cond: ((team_id = 1) AND (priority = 4))
               Buffers: shared hit=7
 Planning Time: 1.980 ms
 Execution Time: 0.425 ms
```

### 3. Full-Text Search Query (Using GIN Index `idx_work_items_search_vector`)
```text
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, team_id, title, type, status, priority, assignee_id, created_by, requires_approval, due_at, version, created_at, updated_at, last_activity_at
FROM work_items
WHERE team_id IN (1, 2, 3, 4)
  AND search_vector @@ websearch_to_tsquery('english', 'latency spike')
ORDER BY updated_at DESC, id DESC
LIMIT 50;

                                                                     QUERY PLAN                                                                      
-----------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=76.79..76.83 rows=16 width=151) (actual time=1.563..1.575 rows=50 loops=1)
   Buffers: shared hit=217
   ->  Sort  (cost=76.79..76.83 rows=16 width=151) (actual time=1.562..1.565 rows=50 loops=1)
         Sort Key: updated_at DESC, id DESC
         Sort Method: top-N heapsort  Memory: 46kB
         Buffers: shared hit=217
         ->  Bitmap Heap Scan on work_items  (cost=21.59..76.47 rows=16 width=151) (actual time=0.112..1.366 rows=279 loops=1)
               Recheck Cond: (search_vector @@ '''latenc'' & ''spike'''::tsquery)
               Filter: (team_id = ANY ('{1,2,3,4}'::bigint[]))
               Heap Blocks: exact=206
               Buffers: shared hit=211
               ->  Bitmap Index Scan on idx_work_items_search_vector  (cost=0.00..21.59 rows=16 width=0) (actual time=0.080..0.080 rows=279 loops=1)
                     Index Cond: (search_vector @@ '''latenc'' & ''spike'''::tsquery)
                     Buffers: shared hit=5
 Planning Time: 11.858 ms
 Execution Time: 1.641 ms
```

---

## Troubleshooting & FAQ

#### Q: Port 5432 is already in use
* If your local PostgreSQL is already running on port 5432, you can either stop local Postgres (`brew services stop postgresql` or `systemctl stop postgresql`) or change the mapped port in `docker-compose.yml` to `"5433:5432"`, updating `DATABASE_URL` accordingly.

#### Q: How do I reset the database to a clean seed?
* **With Docker**: `docker compose down -v && docker compose up --build`
* **Locally**: `python -m app.seed --reset` will truncate all item and activity data and regenerate a fresh seed.

#### Q: How do I inspect the PostgreSQL database directly?
```bash
docker exec -it newtonite-db psql -U postgres -d newtonite
```

---

## Known Limitations

1. **Short-polling vs WebSockets:** Real-time frontend updates rely on polling `/notifications/unread-count` and `/items` rather than persistent WebSocket connections or Server-Sent Events (SSE).
2. **Single-token Auth (No Refresh Token Rotation):** Authentication uses a single 24-hour signed JWT access token without refresh token rotation or server-side revocation lists.
3. **Basic Full-Text Search:** Search uses PostgreSQL standard English stemming dictionaries without trigram typo tolerance (`pg_trgm`) or fuzzy matching.
4. **No Rate Limiting:** While idempotency prevents duplicate side-effects, there is currently no IP or user-based token bucket rate limiter on the public API endpoints.
5. **No Long-Term Audit Archival:** The `activity_events` table is append-only and retains all historical events in the primary database indefinitely.

---

## Next Week I Would...

1. **Database Partitioning for Audit History:** Implement monthly declarative table partitioning on `activity_events` using `RANGE (created_at)` to keep index sizes bounded as the history grows into millions of records.
2. **Server-Sent Events (SSE) for Notifications:** Add a lightweight SSE endpoint `GET /notifications/stream` leveraging PostgreSQL `LISTEN / NOTIFY` to eliminate client polling overhead.
3. **Fuzzy Search with `pg_trgm`:** Add trigram indexing to support search queries with spelling errors and partial key lookups (e.g. typing "OPS-14" finding "OPS-142").
4. **Sliding-Window Rate Limiting:** Add token-bucket rate limiting via ASGI middleware for mutating endpoints to protect against DDoS and runaway client loops.
5. **OpenTelemetry Distributed Tracing:** Instrument FastAPI endpoints and database transactions with trace spans to monitor query latency distributions in real time.
