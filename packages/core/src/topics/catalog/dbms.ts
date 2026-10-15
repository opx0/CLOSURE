import type { Topic } from '@levelhead/contracts'

export const DBMS_TOPICS: readonly Topic[] = [
  {
    id: 'dbms.indexes',
    area: 'dbms',
    title: 'Database indexes',
    ask: 'Ask them to explain how an index speeds up a lookup and what it costs on writes.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'a B-tree index keeps keys sorted, so a lookup reads O(log n) pages instead of scanning the table',
        'each index entry holds the key and a pointer to the row',
        'a composite index is usable only through its leftmost columns',
      ],
      trade_offs: [
        'every insert, update and delete must also update each index',
        'indexes take extra disk and memory',
        'a column with few distinct values gains little from an index',
      ],
      failure_modes: [
        'a function on the indexed column or a leading-wildcard LIKE stops a plain index from being used',
        'too many indexes slow down writes',
        'stale statistics make the planner choose a full scan',
      ],
    },
    falsePremise:
      'An index makes both reads and writes faster, so the safe default is to index every column.',
    twist: 'the table now takes 50,000 writes per second and is rarely read',
  },
  {
    id: 'dbms.transactions_isolation',
    area: 'dbms',
    title: 'Transactions and isolation levels',
    ask: 'Ask them what guarantees a transaction gives and how isolation levels trade anomalies for concurrency.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'ACID: atomicity, consistency, isolation, durability',
        'the levels: read uncommitted, read committed, repeatable read, serializable',
        'isolation implemented with locking or multiversion concurrency control (MVCC)',
        'durability through a write-ahead log flushed at commit',
      ],
      trade_offs: [
        'stronger isolation prevents more anomalies but lowers concurrency',
        'serializable transactions can abort and must be retried by the application',
        'weaker levels move correctness checks into application code',
      ],
      failure_modes: [
        'dirty reads, non-repeatable reads and phantom reads',
        'lost updates from a read-modify-write under read committed',
        'deadlocks or serialization failures under contention',
      ],
    },
    falsePremise: 'READ COMMITTED already prevents phantom reads, so SERIALIZABLE is never needed.',
    twist: 'two users try to book the last seat on the same flight at the same moment',
  },
  {
    id: 'dbms.normalisation',
    area: 'dbms',
    title: 'Normalisation',
    ask: 'Ask them to normalise a small table full of repeated data into third normal form, and explain what each step fixes.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'first normal form: each column holds a single value, with no repeating groups',
        'second normal form: no non-key column depends on only part of a composite key',
        'third normal form: no non-key column depends on another non-key column (no transitive dependency)',
        'functional dependencies decide where the table is split',
      ],
      trade_offs: [
        'normalised tables store each fact once, but reads need joins',
        'denormalising a read-heavy path speeds up reads, but every copy must be kept in sync on write',
        'BCNF removes more anomalies than 3NF but can lose a dependency that no single table then enforces',
      ],
      failure_modes: [
        'update anomalies: a fact stored in many rows gets changed in only some of them',
        'insertion anomalies: a fact cannot be stored until an unrelated row exists',
        'deletion anomalies: deleting a row loses a fact nobody meant to delete',
      ],
    },
    falsePremise:
      'A fully normalised schema is always faster to query, because it stores less data and needs no joins.',
    twist:
      'the product page now shows each order with its customer and product details, a million times a minute',
  },
  {
    id: 'dbms.sql_joins',
    area: 'dbms',
    title: 'SQL joins',
    ask: 'Ask them to explain inner, left and full outer joins on two small tables and say exactly which rows each one returns.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'an inner join returns only rows that have a match on both sides',
        'a left join keeps every row of the left table and fills NULLs where the right side has no match',
        'a full outer join keeps the unmatched rows from both sides',
        'a self join joins a table to itself, such as employees to their managers',
      ],
      trade_offs: [
        'one join query against several separate queries stitched together in application code',
        'a join on indexed keys stays fast; a join on unindexed columns may scan both tables',
        'EXISTS returns each left row once, where a join repeats it for every match',
      ],
      failure_modes: [
        "a filter such as orders.status = 'paid' in WHERE instead of ON, which drops the unmatched rows and turns a left join into an inner join",
        'joining on a non-unique key multiplies rows and inflates SUM and COUNT',
        'NULL never equals NULL, so rows with a NULL join key never match',
      ],
    },
    falsePremise: 'A LEFT JOIN returns exactly as many rows as the left table has, never more.',
    twist: 'the report must now list the customers who have never placed an order',
  },
  {
    id: 'dbms.sql_nosql',
    area: 'dbms',
    title: 'SQL vs NoSQL',
    ask: 'Ask them to compare a relational database with a NoSQL store and choose one for a specific application.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'relational databases keep rows in tables with a declared schema, joins and multi-row transactions',
        'NoSQL covers document, key-value, wide-column and graph stores, each shaped around an access pattern',
        'many NoSQL stores scale out by partitioning data across nodes by key',
      ],
      trade_offs: [
        'a declared schema rejects bad data early; a flexible schema moves validation into the application',
        'SQL makes joins and ad hoc queries easy; NoSQL data is modelled around the queries known up front',
        'many distributed stores relax consistency or limit transactions to one partition in exchange for scale and availability',
      ],
      failure_modes: [
        'choosing a document store for highly relational data and rebuilding joins in application code',
        'duplicated, denormalised copies of the same data drifting out of sync',
        'eventual consistency showing a user stale data right after their own write',
      ],
    },
    falsePremise:
      'NoSQL databases cannot support transactions at all, and relational databases cannot scale beyond a single machine.',
    twist:
      'the product catalogue now holds thousands of product types, each with its own set of attributes',
  },
  {
    id: 'dbms.acid_recovery',
    area: 'dbms',
    title: 'ACID and crash recovery',
    ask: 'Ask them what each ACID property guarantees, and how a database keeps committed work and discards unfinished work after a crash.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'atomicity: a transaction applies completely or not at all',
        'consistency: constraints such as keys and checks hold before and after every transaction',
        'changes go to a write-ahead log, and a commit is durable once its log record is flushed to disk',
        'on restart, recovery replays the log so committed changes survive and uncommitted ones are rolled back',
      ],
      trade_offs: [
        'flushing the log on every commit costs latency; group commit shares one flush across many transactions',
        'asynchronous commit raises throughput but can lose the last few commits in a crash',
        'frequent checkpoints shorten recovery but add bursts of disk writes',
      ],
      failure_modes: [
        'a disk or controller that acknowledges a flush it has only cached, losing committed data on power loss',
        'a client that times out during COMMIT and cannot tell whether the transaction committed',
        'a long-running transaction holding locks and keeping old row versions from being cleaned up',
      ],
    },
    falsePremise:
      'Atomicity only covers each statement on its own, so if the database crashes between the debit and the credit of one transaction, the debit stays applied after restart.',
    twist:
      'the database server loses power a millisecond after telling the client the payment committed',
  },
  {
    id: 'dbms.query_planning',
    area: 'dbms',
    title: 'Query planning and EXPLAIN',
    ask: 'Ask them how a database turns a SQL query into an execution plan, and how they would find out why a query is slow.',
    minLevel: 'mid',
    expected: {
      mechanism: [
        'the planner considers alternative plans and picks the one with the lowest estimated cost',
        'cost estimates come from table statistics such as row counts and value distributions',
        'the plan chooses between sequential and index scans, and between nested loop, hash and merge joins',
        'EXPLAIN shows the chosen plan; EXPLAIN ANALYZE runs it and shows actual row counts and timings',
      ],
      trade_offs: [
        'an index scan wins for a few rows; a sequential scan wins when a large share of the table matches',
        'planning time grows quickly with the number of joins, so planners fall back to heuristics for many-table queries',
        'a query hint forces a plan but stops it adapting when the data changes',
      ],
      failure_modes: [
        'stale statistics make the planner misjudge row counts and pick a bad join order',
        'an underestimated row count makes a nested loop join run far longer than planned',
        'a prepared statement reusing a plan that suits one parameter value and is terrible for another',
      ],
    },
    falsePremise:
      'A query always uses an index when one exists on the filtered column, because an index scan is always cheaper than reading the whole table.',
    twist:
      'the same query is fast for most customers but takes 30 seconds for the one customer with 5 million orders',
  },
]
