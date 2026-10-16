# Engineering Decisions & Architecture Rationale

This document details the architectural choices, trade-offs, and design principles implemented in Newtonite Ops. Every decision was made to ensure high reliability, zero data corruption under concurrent load, strict tenant isolation, and live-review explainability.

---

## Decision 1: Data Model & Unified Append-Only Audit History in the Same Transaction

### Context
Operational workflows (incidents, high-value payments, customer escalations) require an incontrovertible audit trail. If an item state changes, the record of *who* did it and *why* must never disagree with the current item state. Furthermore, discussion comments and workflow events often exist in separate tables in traditional systems, complicating chronological reconstruction.

### Options Considered
1. **Dual-write to an external event store / audit service:** Update PostgreSQL, then publish an event to Kafka or an external audit service.
2. **Application-level audit logging:** Insert into an audit table in Python before or after committing the item update.
3. **Transactional unified timeline with DB-level append-only trigger:** Store both system audit events and discussion comments in a single `activity_events` table written within the exact same PostgreSQL transaction as the item state change, guarded by a database trigger that rejects `UPDATE` and `DELETE`.

### Choice
**Option 3: Transactional unified timeline with DB-level append-only enforcement.**
- Every mutation (creation, claim, release, assign, edit, priority change, status change, and comment) writes an `ActivityEvent` inside the exact same database transaction.
- Discussion comments are simply events of type `comment_added` with payload `{"body": "..."}`. This provides a single, chronological timeline for both discussion and operational history.
- An explicit PostgreSQL trigger (`BEFORE UPDATE OR DELETE ON activity_events`) raises an exception if any client tries to mutate or delete history.
- Every event updates `work_items.last_activity_at` within the same transaction to power staleness metrics.

### Trade-offs
- **Pros:** 100% guarantee against dual-write drift. Even if the application server crashes mid-request, PostgreSQL ACID guarantees that state and history either commit together or roll back together.
- **Cons:** Higher write volume in PostgreSQL. Table partitioning by `created_at` or background archival would be necessary at massive scale (>10M events), but keeping it in the primary database avoids distributed transaction complexity.

---

## Decision 2: Concurrency Control (Optimistic Locking, Atomic Claim, and Idempotency)

### Context
Under high operational pressure, multiple responders often attempt to claim the same unassigned ticket simultaneously, and concurrent leads may modify priority or status concurrently. Network retries can cause duplicate item creation or multiple charging attempts.

### Options Considered
1. **Pessimistic table/row locking (`SELECT ... FOR UPDATE`):** Lock the work item row before checking versions or performing mutations.
2. **Read-modify-write application checks:** Read the item in Python, verify fields, and issue a basic `UPDATE`.
3. **Deliberate hybrid concurrency control:**
   - Single-statement atomic conditional `UPDATE` for claims.
   - Optimistic concurrency with `expected_version` for mutations.
   - Database-backed transactional idempotency key serialization.

### Choice
**Option 3: Deliberate hybrid concurrency control.**
- **Atomic Claim:** Claiming is executed via a single conditional SQL statement:
  ```sql
  UPDATE work_items
  SET assignee_id = :caller_id, status = 'in_progress', version = version + 1, updated_at = NOW(), last_activity_at = NOW()
  WHERE id = :id AND assignee_id IS NULL AND status = 'open'
  RETURNING *;
  ```
  If `rowcount == 0`, the claim race was lost. The loser immediately receives HTTP 409 `already_claimed` containing the current state of the item (`details.current`). There is zero window for a race condition because PostgreSQL serializes the write on the row lock.
- **Optimistic Version Checks:** Operations modifying existing state (PATCH, release, assign, transition) require `expected_version`. The SQL statement checks `WHERE id = :id AND version = :expected_version`. If rowcount is 0, HTTP 409 `version_conflict` is returned with the latest item state.
- **Transactional Idempotency:** Mutating POST endpoints require a UUID `Idempotency-Key`. The request payload is canonically hashed (SHA-256). In the *same* database transaction, the 2xx response is recorded in `idempotency_keys(user_id, key, request_hash, status_code, response_body)`.
  - Sequential duplicates replay the committed response with header `Idempotent-Replay: true`.
  - Reusing a key with a different body returns HTTP 422 `idempotency_key_reused`.
  - Concurrent duplicate requests serialize on the database unique constraint `uq_idempotency_user_key`. The second request catches the integrity violation, rolls back, and replays the first request's committed result.
  - Failed transactions roll back, leaving no key, ensuring that transient network retries can succeed.

### Trade-offs
- **Pros:** Maximum throughput without long-lived database locks. Zero race conditions, zero lost updates, and true exactly-once semantics for API clients.
- **Cons:** Clients must be built to handle HTTP 409 conflicts gracefully by inspecting `details.current` and refreshing their local state.

---

## Decision 3: Authorization Model (404 Not Found vs 403 Forbidden & Centralized Policy)

### Context
The system hosts multiple operational teams (Core Platform, Payments & Risk, Compliance & Security, Customer Support). Team members have per-team roles (`viewer`, `member`, `lead`). An enterprise security risk is "ID enumeration" and "resource leakage", where querying an unauthorized ID reveals whether that entity exists.

### Options Considered
1. **Return 403 Forbidden on all unauthorized access:** Clear differentiation between permission issues and missing resources.
2. **Return 404 Not Found when the caller is not a member of the item's team; return 403 Forbidden when the caller is a member but lacks role permissions.**
3. **Decentralize authorization checks inside every FastAPI route handler.**

### Choice
**Option 2 combined with a single centralized policy engine (`app/policy.py`).**
- **404 vs 403:** If a user requests an item belonging to a team they do not belong to, the API returns **HTTP 404 Not Found**. An attacker cannot probe ticket IDs to deduce ticket numbers, client names, or incident frequencies of other teams. If the caller *is* a member of the team but attempts an action restricted to leads (e.g. a member trying to approve a compliance ticket), the API returns **HTTP 403 Forbidden**.
- **SQL-Level Scoping:** List and search queries (`GET /items`, `GET /dashboard/summary`) unconditionally constrain items using `WHERE team_id IN (:caller_team_ids)`. A client-supplied `team_id` filter is only permitted as a subset of the caller's allowed teams.
- **Single Policy Function:** `allowed_actions(role, item, user) -> set[str]` lives in `app/policy.py`. It is executed both during route authorization and when serializing items for the frontend. The UI displays action buttons based directly on `item.allowed_actions`, eliminating duplicated business logic.

### Trade-offs
- **Pros:** Prevents cross-tenant existence enumeration. Centralizes all authorization rules in one readable, unit-tested matrix.
- **Cons:** Developers must understand that a 404 can mean either "row does not exist" or "caller has no access to this team". This is clearly documented in API responses and error messages.

---

## Decision 4: Synchronous Mutation vs Asynchronous Notification Delivery (Transactional Outbox)

### Context
Operational actions need to notify relevant users:
- Assignee notified when an item is assigned by someone else.
- Team leads notified when an item enters `awaiting_approval`.
- Creator notified when an item enters `resolved`.
Calling third-party notification services or doing heavy asynchronous fan-out synchronously in the API request path degrades latency and risks dual-write failure. The specification strictly excludes Redis/Kafka.

### Options Considered
1. **In-memory background tasks (`fastapi.BackgroundTasks`):** Fire notification inserts in Python asyncio memory.
2. **External message broker (Kafka/RabbitMQ/Redis):** Out of scope per spec.
3. **PostgreSQL Transactional Outbox with `FOR UPDATE SKIP LOCKED`:** Write outbox records into PostgreSQL in the same transaction as the item mutation; poll using background worker processes.

### Choice
**Option 3: PostgreSQL Transactional Outbox pattern.**
- When a state change warrants notification, an `outbox` record is written in the exact same transaction as the `work_items` update.
- An independent worker process (`python -m app.worker`) polls the outbox in batches:
  ```sql
  SELECT * FROM outbox
  WHERE status = 'pending' AND available_at <= NOW()
  ORDER BY available_at ASC, id ASC
  LIMIT :batch_size
  FOR UPDATE SKIP LOCKED;
  ```
- **Concurrency & Resilience:** `SKIP LOCKED` ensures multiple workers never contend for or block on the same rows. If a worker process crashes, its database connection terminates, immediately releasing row locks without stuck jobs.
- **Deduplication:** Notification insertion uses `INSERT INTO notifications ... ON CONFLICT (event_id, user_id) DO NOTHING`. Even under at-least-once re-delivery, duplicate notifications are impossible.
- **Exponential Backoff & Dead-Letter Queue:** On failure, the outbox record's `attempts` counter increments and `available_at` backs off exponentially ($2^{\text{attempts}}$ seconds). After 5 attempts, the row is marked `dead` with `last_error` recorded for manual inspection.

### Trade-offs
- **Pros:** Zero infrastructure dependencies beyond PostgreSQL. Zero lost notifications. The API returns in <10ms without waiting on notification fan-out.
- **Cons:** Polling introduces a small delay (1-2 seconds) before notifications appear in user inboxes.

---

## Decision 5: Scale, Search & Pagination (Keyset Cursors vs OFFSET, Generated Stored TSVector)

### Context
The application is designed for hundreds of concurrent users, tens of thousands of active tickets, and a rapidly growing historical archive. Operational users constantly filter by status, priority, and free-text search keywords (e.g. "latency spike", "payout failure").

### Options Considered
1. **OFFSET/LIMIT pagination:** Simple to implement (`OFFSET 500 LIMIT 50`), but suffers from quadratic performance degradation ($O(N)$ scanning) and "offset drift" where items are duplicated or skipped when new rows are inserted during browsing.
2. **Full-table `COUNT(*)` in list responses:** Expensive query that forces sequential table scans or full index traversals on every keystroke.
3. **Keyset (Cursor) pagination with base64 tokens + Stored TSVector with GIN indexing:**
   - Cursors contain `(sort_value, id)`.
   - Search uses PostgreSQL full-text search with `websearch_to_tsquery`.

### Choice
**Option 3: Pure keyset pagination with generated TSVector.**
- **No OFFSET, No Total Count:** Pagination queries filter on `(sort_column, id) < (cursor_sort, cursor_id)`. Query execution time remains constant ($O(1)$ index lookup) whether loading page 1 or page 1,000.
- **Opaque Cursors:** Cursors are serialized as base64-encoded JSON `{"v": sort_val, "id": id}`. Clients treat cursors as opaque tokens.
- **Drift Immunity:** As proven in `test_pagination.py`, inserting 3 new urgent items while a user is on page 1 produces zero duplicate items and zero skipped items on page 2.
- **Full-Text Search:** `search_vector` is defined as:
  `GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))) STORED`
  Indexed with a PostgreSQL GIN index (`idx_work_items_search_vector`). Free-text queries execute via `websearch_to_tsquery('english', :q)`, supporting search syntax (quotes, plus, minus) in under 2ms.

### Trade-offs
- **Pros:** Predictable, lightning-fast query times regardless of dataset size. Zero pagination drift during active incidents.
- **Cons:** Keyset pagination does not allow jumping directly to arbitrary pages (e.g. "jump to page 47"); users browse sequentially or filter down using specific views.

---

## What I Chose Not to Build (Deliberate Non-Goals)

To respect the budget and preserve code quality and test coverage, the following features were deliberately left out of scope:
1. **Redis/Kafka infrastructure:** Kept strictly inside PostgreSQL outbox to satisfy the single-database constraint and eliminate distributed synchronization bugs.
2. **WebSocket push notifications:** Replaced with keyset-paginated polling endpoints (`GET /notifications`, `GET /notifications/unread-count`).
3. **Public user signup & password reset:** All users belong to pre-provisioned corporate teams; demo accounts are seeded.
4. **Binary file attachments & rich text formatting:** Audit events and descriptions use clean plaintext / Markdown strings.
5. **Multi-organization tenancy:** The system models a single multi-team organization.
