import type { Topic } from '@levelhead/contracts'

export const SYSTEM_DESIGN_TOPICS: readonly Topic[] = [
  {
    id: 'system_design.url_shortener',
    area: 'system_design',
    title: 'URL shortener',
    ask: 'Ask them to design a URL shortening service like bit.ly, starting from the requirements and the expected traffic.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'generate a short unique key, for example base62 of a counter or a truncated hash',
        'store the key-to-URL mapping in a key-value store or an indexed table',
        'look up the key and answer with an HTTP 301 or 302 redirect',
      ],
      trade_offs: [
        'counter-based keys are unique but guessable; hashed keys need collision handling',
        'the workload is read-heavy, so caching popular keys pays off',
        'a 301 is cached by browsers and saves load; a 302 keeps every click visible for analytics',
      ],
      failure_modes: [
        'two servers generating the same key',
        'a viral link overloading the database on cache misses',
        'abuse through spam or phishing links',
      ],
    },
    falsePremise:
      'A 301 redirect is the right choice if you want to count every click, because the browser always comes back to the server.',
    twist: 'links must now expire after 24 hours and traffic grows to 100,000 redirects per second',
  },
  {
    id: 'system_design.rate_limiter',
    area: 'system_design',
    title: 'Rate limiter',
    ask: 'Ask them to design a rate limiter that caps how many requests each user can make to an API.',
    minLevel: 'mid',
    expected: {
      mechanism: [
        'token bucket or leaky bucket algorithms',
        'fixed-window and sliding-window counters',
        'counters in a shared store such as Redis, keyed by user and window and updated atomically',
      ],
      trade_offs: [
        'fixed windows are simple but allow a burst at the window boundary',
        'a central counter store is accurate but adds latency and a dependency; per-server limits are fast but approximate',
        'failing open keeps the API available; failing closed protects the backend',
      ],
      failure_modes: [
        'a race between reading and incrementing the counter across servers',
        'the counter store going down',
        'clock skew between servers shifting window boundaries',
      ],
    },
    falsePremise:
      'A fixed-window counter guarantees a user can never send more than the limit within any 60-second span.',
    twist: 'the limit must now hold across three regions, each with its own servers',
  },
  {
    id: 'system_design.caching',
    area: 'system_design',
    title: 'Caching strategy',
    ask: 'Ask them where they would add caching to a read-heavy web application, and how they would keep the cache consistent with the database.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'cache-aside: read from the cache, and on a miss load from the database and fill the cache',
        'write-through updates the cache on every write; write-back writes to the cache and flushes to the database later',
        'eviction such as LRU and expiry times (TTL) bound the cache size and how stale it can get',
        'caches at several layers: a CDN, an application cache such as Redis, and the database buffer pool',
      ],
      trade_offs: [
        'longer TTLs raise the hit rate but serve staler data',
        'write-back makes writes fast but loses data if the cache fails before it flushes',
        'invalidating on every write keeps data fresh but adds work and races to the write path',
      ],
      failure_modes: [
        'a cache stampede: a hot key expires and thousands of requests hit the database at once',
        'a race between an update and a cache fill that leaves stale data in the cache until it expires',
        'a cold cache after a restart overloading the database',
      ],
    },
    falsePremise:
      'A cache with a TTL can never return stale data, because the TTL keeps it in sync with the database.',
    twist: 'a celebrity post is read a million times a minute and edited every few seconds',
  },
  {
    id: 'system_design.load_balancing',
    area: 'system_design',
    title: 'Load balancing',
    ask: 'Ask them how a load balancer spreads traffic across servers, and what happens when one of those servers fails.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'algorithms such as round robin, least connections and consistent hashing',
        'health checks take failing servers out of the pool',
        'a layer 4 balancer routes by IP and port; a layer 7 balancer can route by path, header or cookie',
      ],
      trade_offs: [
        'sticky sessions keep a user on one server but unbalance the load and lose the session when that server dies',
        'layer 7 routing is flexible but costs more CPU than layer 4, especially when it terminates TLS',
        'the load balancer itself must be redundant, or it becomes the single point of failure',
      ],
      failure_modes: [
        'a health check that passes while the server returns errors for real requests',
        "a failed server's traffic overloading the rest and causing a cascade",
        'round robin sending equal traffic to servers of unequal capacity, or requests of unequal cost',
      ],
    },
    falsePremise:
      'Round robin always spreads the load evenly, because every server receives the same number of requests.',
    twist: "the service now keeps each user's WebSocket connection open for hours",
  },
  {
    id: 'system_design.sharding_replication',
    area: 'system_design',
    title: 'Sharding and replication',
    ask: 'Ask them how they would scale a database that no longer fits on one machine, covering both replication and sharding.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'replication copies the same data to several nodes; sharding splits different data across nodes',
        'leader-follower replication sends every write to the leader and can serve reads from followers',
        'a shard key decides which shard holds each row, by range or by hash',
        'consistent hashing moves only a fraction of the keys when a node is added or removed',
      ],
      trade_offs: [
        'asynchronous replication is fast but followers lag; synchronous replication is safer but slows every write',
        'read replicas scale reads but not writes; sharding scales both but complicates queries',
        'queries and transactions that span shards are slow and hard to keep consistent',
      ],
      failure_modes: [
        'a user not seeing their own write because the read went to a lagging replica',
        'a hot shard from a skewed key such as a celebrity account',
        'failover promoting a follower that had not yet received the latest writes',
      ],
    },
    falsePremise:
      'Adding read replicas also raises write throughput, because each replica accepts a share of the writes.',
    twist:
      'the application must now serve users in Europe and Asia with low latency for both reads and writes',
  },
  {
    id: 'system_design.message_queues',
    area: 'system_design',
    title: 'Message queues',
    ask: 'Ask them when they would put a message queue between two services, and what delivery guarantees it gives.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'producers write messages to the queue and consumers process them asynchronously',
        'a consumer acknowledges a message after processing it; unacknowledged messages are redelivered',
        'a queue hands each message to one consumer; publish-subscribe delivers it to every subscriber',
        'a log such as Kafka keeps messages in partitions that each consumer group reads at its own offset',
      ],
      trade_offs: [
        'a queue decouples services and absorbs bursts but adds latency and another system to run',
        'at-least-once delivery can duplicate messages; at-most-once can lose them',
        'order is kept only within a partition, so more partitions mean more parallelism and less ordering',
      ],
      failure_modes: [
        'a consumer that crashes after doing the work but before acknowledging, so the work runs twice',
        'a poison message that fails forever and blocks the queue when there is no dead-letter queue',
        'consumers falling behind until the backlog grows past what the queue retains',
      ],
    },
    falsePremise:
      'A message queue delivers every message exactly once by default, so consumers never need to handle duplicates.',
    twist:
      'each message now charges a customer, and the payment provider times out on one call in a hundred',
  },
  {
    id: 'system_design.chat_system',
    area: 'system_design',
    title: 'Chat system',
    ask: 'Ask them to design a one-to-one and group chat service like WhatsApp, starting from the requirements and the expected traffic.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'each online client holds a persistent connection, such as a WebSocket, to receive messages in real time',
        'a message is stored durably before delivery and moves through sent, delivered and read states',
        'offline users receive stored messages when they reconnect, with a push notification in between',
        'a sequence number per conversation orders its messages',
      ],
      trade_offs: [
        'WebSockets deliver instantly but hold a connection per user; polling is simpler but slower and wasteful',
        'fanning a group message out to every member on write makes reads fast but is expensive for large groups',
        'end-to-end encryption protects the content but stops the server from searching or moderating it',
      ],
      failure_modes: [
        'a message delivered twice after a client retry when there is no client-generated message id',
        'messages shown out of order after travelling through different servers',
        'a connection server crashing and all of its users reconnecting at once',
      ],
    },
    falsePremise:
      "Server timestamps are enough to order messages correctly, because every server's clock is exactly in sync.",
    twist:
      'groups can now have 100,000 members, and one of them is a celebrity who posts every minute',
  },
]
