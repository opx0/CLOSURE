-- Requires the real pgvector extension; missing capability must fail migration, not be skipped.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

CREATE TABLE retrieval_profiles (
    id text PRIMARY KEY,
    dimensions integer NOT NULL CHECK (dimensions > 0),
    profile jsonb NOT NULL,
    CHECK (profile->>'id' = id AND (profile->>'dimensions')::integer = dimensions)
);

CREATE FUNCTION retrieval_profile_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'retrieval encoding profiles are immutable';
END;
$$;
CREATE TRIGGER retrieval_profile_immutable BEFORE UPDATE OR DELETE ON retrieval_profiles
FOR EACH ROW EXECUTE FUNCTION retrieval_profile_immutable();

CREATE TABLE retrieval_publications (
    snapshot_id text PRIMARY KEY REFERENCES snapshots(id) ON DELETE CASCADE,
    owner_id text NOT NULL,
    profile_id text REFERENCES retrieval_profiles(id)
);

CREATE TABLE retrieval_chunks (
    owner_id text NOT NULL,
    snapshot_id text NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
    id text NOT NULL,
    artifact_id text NOT NULL REFERENCES artifact_index(artifact_id) ON DELETE CASCADE,
    start_line integer NOT NULL,
    end_line integer NOT NULL,
    content_hash text NOT NULL,
    body text NOT NULL,
    tokens text NOT NULL,
    search tsvector GENERATED ALWAYS AS (to_tsvector('english', tokens)) STORED,
    PRIMARY KEY(owner_id, snapshot_id, id),
    CHECK (start_line > 0 AND end_line >= start_line)
);
CREATE INDEX retrieval_chunks_search ON retrieval_chunks USING gin(search);

-- Unconstrained vector dimensions permit different immutable profiles, never mixed in a query.
-- These rows also form the deletable owner/snapshot-scoped content embedding cache.
CREATE TABLE retrieval_vectors (
    owner_id text NOT NULL,
    snapshot_id text NOT NULL,
    chunk_id text NOT NULL,
    profile_id text NOT NULL REFERENCES retrieval_profiles(id),
    embedding public.vector NOT NULL,
    PRIMARY KEY(owner_id, snapshot_id, chunk_id, profile_id),
    FOREIGN KEY(owner_id, snapshot_id, chunk_id)
        REFERENCES retrieval_chunks(owner_id, snapshot_id, id) ON DELETE CASCADE,
    CHECK (abs(public.vector_norm(embedding) - 1) < 0.001)
);
CREATE FUNCTION retrieval_vector_dimensions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF public.vector_dims(NEW.embedding) <> (SELECT dimensions FROM retrieval_profiles WHERE id = NEW.profile_id) THEN
        RAISE EXCEPTION 'retrieval vector dimension does not match encoding profile';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER retrieval_vector_dimensions BEFORE INSERT OR UPDATE ON retrieval_vectors
FOR EACH ROW EXECUTE FUNCTION retrieval_vector_dimensions();
