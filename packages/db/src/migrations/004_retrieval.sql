-- 004 — lexical retrieval over pinned repository content (ADR-015: full-text first, embeddings only
-- if held-out evidence-linking precision earns them).

CREATE TABLE snapshots (
    id           text        PRIMARY KEY,
    owner_id     text        NOT NULL,
    repo_path    text        NOT NULL,
    commit_sha   text        NOT NULL,
    file_count   integer     NOT NULL,
    content_hash text        NOT NULL,
    pinned_at    timestamptz NOT NULL,
    deleted_at   timestamptz,
    deleted_reason text,

    CONSTRAINT snapshots_owner_id_shape CHECK (owner_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$')
);

CREATE INDEX snapshots_owner_live ON snapshots (owner_id, pinned_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE artifact_index (
    artifact_id  text        PRIMARY KEY,
    snapshot_id  text        NOT NULL REFERENCES snapshots (id) ON DELETE CASCADE,
    owner_id     text        NOT NULL,
    kind         text        NOT NULL,
    path         text        NOT NULL,
    symbol       text,
    start_line   integer,
    end_line     integer,
    body         text        NOT NULL,
    -- Source code is not English prose: `claimJob`, `queue.ts` and `MAX_ATTEMPTS` are each one
    -- token to the text-search parser, so a search for "claim job" matches none of them. The
    -- writer supplies an identifier-split rendering of the same text here, and the vector below
    -- indexes both — `body` still exists because `ts_headline` needs the real thing to excerpt.
    tokens       text        NOT NULL DEFAULT '',
    -- Generated, not trigger-maintained: the tsvector cannot drift from the body it indexes.
    search       tsvector    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(symbol, '')), 'A') ||
        setweight(to_tsvector('english', path), 'B') ||
        setweight(to_tsvector('english', tokens), 'B') ||
        setweight(to_tsvector('english', body), 'C')
    ) STORED
);

CREATE INDEX artifact_index_search ON artifact_index USING gin (search);
CREATE INDEX artifact_index_scope ON artifact_index (owner_id, snapshot_id);
