-- 005 — session hygiene (STACK §8). A pathological parse or retrieval query dies on its own rather
-- than holding a connection through an incident. Wrapped because a managed instance may not grant
-- the role the right to set its own parameters; losing the timeout is worse than failing the deploy.

DO $$
BEGIN
    EXECUTE format('ALTER ROLE %I SET statement_timeout = %L', current_user, '30s');
    EXECUTE format('ALTER ROLE %I SET idle_in_transaction_session_timeout = %L', current_user, '60s');
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'statement_timeout not set: % lacks ALTER ROLE on itself', current_user;
END;
$$;
