import type { Topic } from '@levelhead/contracts'

export const BACKEND_TOPICS: readonly Topic[] = [
  {
    id: 'backend.rest_idempotency',
    area: 'backend',
    title: 'REST API design and idempotency',
    ask: 'Ask them to design the endpoints for a simple resource and explain which operations are safe to retry.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'resources as nouns in the URL, with HTTP methods as the verbs',
        'GET, PUT and DELETE are idempotent by definition; POST is not',
        'an idempotency key lets the server recognise a retried POST and return the first result',
        'status codes that tell the client what happened, such as 201, 400, 404 and 409',
      ],
      trade_offs: [
        'storing idempotency keys costs storage and a lookup on every write',
        'PUT with the full representation against PATCH with a partial update',
        'API versioning in the URL against in a header',
      ],
      failure_modes: [
        'a client retries a POST after a timeout and creates a duplicate order',
        'a timeout leaves the client unsure whether the write happened',
        'a breaking change to the response shape breaks existing clients',
      ],
    },
    falsePremise:
      'POST is idempotent as long as the request body is the same, so retrying a payment request is always safe.',
    twist: 'the endpoint now charges a credit card and clients retry automatically on timeout',
  },
  {
    id: 'backend.sessions_tokens',
    area: 'backend',
    title: 'Authentication: sessions vs tokens',
    ask: 'Ask them to compare server-side sessions with signed tokens such as JWTs for keeping a user logged in.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'a session keeps state on the server and gives the client an opaque session id in a cookie',
        'a JWT carries signed claims the server verifies without a database lookup',
        'passwords are stored as salted, deliberately slow hashes such as bcrypt or argon2',
      ],
      trade_offs: [
        'sessions are easy to revoke but need a session store shared by every server',
        'stateless tokens avoid the lookup but are hard to revoke before they expire',
        'short-lived access tokens with refresh tokens balance revocation against lookups',
      ],
      failure_modes: [
        'a stolen token stays valid until it expires',
        'tokens kept in localStorage can be read by an XSS payload',
        'cookie-based auth without SameSite or CSRF tokens allows cross-site request forgery',
      ],
    },
    falsePremise:
      "A signed JWT is encrypted, so it is safe to put the user's password in its payload.",
    twist:
      'a user reports a stolen laptop and every one of their logins must stop working within a minute',
  },
  {
    id: 'backend.caching_layers',
    area: 'backend',
    title: 'Caching layers and HTTP caching',
    ask: 'Ask them which caches a request can hit between the browser and the database, and how the service controls each one.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'Cache-Control directives such as max-age, no-store and private tell browsers and CDNs what to cache and for how long',
        'an ETag with If-None-Match lets a client revalidate and get a 304 Not Modified with no body',
        "an in-process cache lives in one server's memory; a shared cache such as Redis is seen by every server",
        'the cache key includes everything that changes the response, such as the user or the language',
      ],
      trade_offs: [
        'an in-process cache has no network hop, but each server holds its own copy that can disagree',
        'a shared cache stays consistent across servers but adds a network call and a dependency',
        'a CDN takes the most load off the servers but is the hardest layer to invalidate quickly',
      ],
      failure_modes: [
        "a personalised response cached as public, so one user sees another user's data",
        'a cache key missing the language, so users get pages in the wrong language',
        'invalidation that clears Redis but not the CDN, leaving stale pages live',
      ],
    },
    falsePremise:
      'Cache-Control: no-cache means the browser never stores the response, so it is the header to use for sensitive data.',
    twist: 'the product page now shows a personalised price to each logged-in user',
  },
  {
    id: 'backend.concurrency_races',
    area: 'backend',
    title: 'Concurrency and race conditions',
    ask: 'Ask them how two requests handled at the same time, possibly on different servers, can corrupt shared data, and how they would prevent it.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'a race comes from check-then-act or read-modify-write steps that interleave',
        'an atomic conditional update such as UPDATE items SET stock = stock - 1 WHERE id = ? AND stock > 0 checks and writes in one step',
        'pessimistic locking with SELECT ... FOR UPDATE, or optimistic locking with a version column',
        'a unique constraint lets the database reject the duplicate when two requests create the same thing',
      ],
      trade_offs: [
        'pessimistic locks are simple but make concurrent requests wait',
        'optimistic locking never waits, but a conflicting request fails and must retry',
        'a distributed lock covers work outside the database but adds a dependency and a lease expiry to reason about',
      ],
      failure_modes: [
        'an in-memory lock that protects nothing once the service runs on several servers',
        'lost updates when two requests read the same value and both write back',
        'a lock lease that expires while its holder is still working, so two holders run at once',
      ],
    },
    falsePremise:
      'Node.js runs JavaScript on a single thread, so two concurrent requests in the same Node process can never interleave and race on shared data.',
    twist:
      'one viral post now gets thousands of likes per second, all incrementing the same counter row',
  },
  {
    id: 'backend.pagination',
    area: 'backend',
    title: 'Pagination',
    ask: 'Ask them how they would paginate an API that lists millions of records, comparing offset and cursor pagination.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'offset pagination turns a page number into LIMIT and OFFSET',
        'cursor (keyset) pagination remembers the last sort key returned and asks for the rows after it',
        'a stable sort order with a unique tie-breaker such as the id',
        'the response carries an opaque cursor for the next page',
      ],
      trade_offs: [
        'offset lets a client jump to any page but gets slower as the offset grows, because the skipped rows are still read',
        'cursor pagination stays fast at any depth but moves only to the next or previous page, not straight to page 500',
        'returning a total count is convenient but costs a count over every matching row',
      ],
      failure_modes: [
        'rows inserted or deleted between requests make offset pages skip or repeat items',
        'sorting by a non-unique column such as created_at without a tie-breaker drops or repeats rows at page boundaries',
        'a client allowed any page size asking for a million rows at once',
      ],
    },
    falsePremise:
      'With OFFSET 1000000 the database jumps straight to the millionth row, so a deep page costs the same as the first page.',
    twist: 'new items arrive every second and users scroll through an endless feed',
  },
]
