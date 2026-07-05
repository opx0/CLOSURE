-- 003 — the durable job table (ADR-009). One table, leased with FOR UPDATE SKIP LOCKED. Work that
-- must survive a crash lives here; nothing about an interview turn does.

CREATE TABLE jobs (
    id               text        PRIMARY KEY,
    owner_id         text        NOT NULL,
    kind             text        NOT NULL,
    idempotency_key  text        NOT NULL,
    payload          jsonb       NOT NULL,
    state            text        NOT NULL DEFAULT 'queued',
    attempts         integer     NOT NULL DEFAULT 0,
    max_attempts     integer     NOT NULL DEFAULT 5,
    run_after        timestamptz NOT NULL DEFAULT now(),
    lease_owner      text,
    lease_expires_at timestamptz,
    last_error       text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),

    -- Enqueueing the same work twice is a no-op rather than two runs; this is what makes a retried
    -- HTTP request safe.
    CONSTRAINT jobs_idempotency_uniq UNIQUE (owner_id, kind, idempotency_key),
    CONSTRAINT jobs_state_known CHECK (state IN ('queued', 'leased', 'succeeded', 'failed', 'dead')),
    CONSTRAINT jobs_attempts_bounded CHECK (attempts >= 0 AND attempts <= max_attempts),
    CONSTRAINT jobs_owner_id_shape CHECK (owner_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'),
    -- A leased row without a lease is a row no worker owns and no worker will pick up.
    CONSTRAINT jobs_lease_paired CHECK (
        (state <> 'leased') OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    )
);

-- Partial: the claim query only ever reads runnable rows, and a finished job should not widen the
-- index a worker scans.
CREATE INDEX jobs_runnable ON jobs (run_after ASC, created_at ASC)
    WHERE state IN ('queued', 'leased');

CREATE INDEX jobs_owner_recent ON jobs (owner_id, created_at DESC);
