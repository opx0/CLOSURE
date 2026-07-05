-- 001 — the interview event log (ADR-008, ADR-010, PROJECT.md §5.3).
-- Forward-only, plain SQL: nothing is generated between what a reviewer reads here and what runs
-- against their data.

CREATE TABLE events (
    session_id     text        NOT NULL,
    seq            integer     NOT NULL,
    event_id       text        NOT NULL,
    kind           text        NOT NULL,
    occurred_at    timestamptz NOT NULL,
    schema_version integer     NOT NULL,
    caused_by      text,
    payload        jsonb       NOT NULL,

    -- (session_id, seq) is the event's identity — a second row at the same seq is a rewrite of
    -- history, not a new event.
    CONSTRAINT events_session_seq_pk PRIMARY KEY (session_id, seq),
    CONSTRAINT events_event_id_key UNIQUE (event_id),
    CONSTRAINT events_seq_non_negative CHECK (seq >= 0),
    CONSTRAINT events_schema_version_positive CHECK (schema_version >= 1)
);

-- The other half of append-only: the PK above stops a rewrite arriving as INSERT; this trigger
-- stops one arriving as UPDATE or DELETE, enforced in the database so it holds for psql too, not
-- just application code. Dropping it is stop condition (c) firing (ticket 05 §8).
-- OR REPLACE: re-applying against a database whose tables were dropped but functions survived
-- should fail on the missing table, not this function.
CREATE OR REPLACE FUNCTION events_reject_mutation() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'events is append-only: % is refused', TG_OP
        USING HINT = 'correct the record by appending an event; history is never edited';
END;
$$;

CREATE TRIGGER events_no_update
    BEFORE UPDATE ON events
    FOR EACH ROW EXECUTE FUNCTION events_reject_mutation();

CREATE TRIGGER events_no_delete
    BEFORE DELETE ON events
    FOR EACH ROW EXECUTE FUNCTION events_reject_mutation();

-- Row triggers never fire for TRUNCATE, so without this one the two above leave an open gate.
CREATE TRIGGER events_no_truncate
    BEFORE TRUNCATE ON events
    FOR EACH STATEMENT EXECUTE FUNCTION events_reject_mutation();

-- ADR-008 also revokes UPDATE/DELETE from the application role; that belongs to the deployment
-- that introduces a non-owner role. Here the app connects as table owner, where REVOKE would be a
-- no-op — shipping one would read as protection that isn't there.
