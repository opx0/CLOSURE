# Sample résumé — fixture #1 stand-in

Not anyone's real résumé. It exists so the loop can be exercised end to end without
touching the developer's own, which is private and lives under `fixtures/private/`.
Every line below is chosen to produce a specific kind of claim.

## Experience

**Backend Engineer, Ordinal Systems** — 2024–2026

- Built a durable job queue on PostgreSQL processing ~10k jobs/day, replacing a Redis
  list that lost work on restart.
- Designed the lease-based worker recovery path; jobs are reclaimed after a 30s lease expiry.
- Optimized the nightly reconciliation job from 45 minutes to 6 minutes by batching writes
  and dropping a redundant index.
- Led the migration of three services from a shared database to per-service schemas.
- Measured p99 API latency at 180ms under 400 rps in staging.

**Applied AI Intern, Northgate Labs** — 2023

- Built a retrieval pipeline over 40k internal documents using pgvector and hybrid search.
- Cut hallucinated citations by 60% by requiring every answer to quote a retrieved span.
