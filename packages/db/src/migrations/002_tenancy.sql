-- 002 — the ownership boundary (ADR-023, PROJECT.md §7: one user's artifacts are never exposed to
-- another). Auth is still deferred; its column is not, because retrofitting tenancy is the single
-- most expensive refactor available.

ALTER TABLE events
    ADD COLUMN owner_id text NOT NULL DEFAULT 'local';

ALTER TABLE events
    ADD CONSTRAINT events_owner_id_shape CHECK (owner_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$');

-- A session belongs to exactly one owner already: (session_id, seq) is the primary key across the
-- whole table, so a second owner appending to a colliding session id is refused as a rewrite rather
-- than interleaved into someone else's log. What is missing is the read path, and this is it —
-- every owner-scoped read is an index scan rather than a filter over everyone's events.
CREATE INDEX events_owner_session_seq ON events (owner_id, session_id, seq);
