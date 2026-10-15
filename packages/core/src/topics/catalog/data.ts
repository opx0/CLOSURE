import type { Topic } from '@levelhead/contracts'

export const DATA_TOPICS: readonly Topic[] = [
  {
    id: 'data.batch_streaming',
    area: 'data',
    title: 'Batch vs streaming',
    ask: 'Ask them to compare batch and stream processing and say which they would use for a specific pipeline.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'batch processes a bounded dataset on a schedule',
        'streaming processes an unbounded flow of events continuously as they arrive',
        'streams group events into windows using event time and watermarks',
      ],
      trade_offs: [
        'batch is simpler and cheap to rerun, but its results are hours old',
        'streaming gives low latency but has to manage state, ordering and late data',
        'exactly-once results in streaming cost checkpointing and idempotent sinks',
      ],
      failure_modes: [
        'late or out-of-order events land in the wrong window or are dropped',
        'rerunning a failed batch writes duplicate rows',
        'a consumer that falls behind builds an ever-growing backlog',
      ],
    },
    falsePremise:
      'Streaming always gives more accurate results than batch, because it sees every event the moment it happens.',
    twist: 'the business now needs fraud flagged within two seconds of a transaction',
  },
  {
    id: 'data.partitioning',
    area: 'data',
    title: 'Data partitioning',
    ask: 'Ask them how they would split a large table or dataset into partitions and how they would choose the partition key.',
    minLevel: 'mid',
    expected: {
      mechanism: [
        'range partitioning by key ranges such as date',
        'hash partitioning spreads keys evenly across partitions',
        'queries that filter on the partition key read only the matching partitions (partition pruning)',
      ],
      trade_offs: [
        'range partitions suit range scans but concentrate writes on the newest partition',
        'hash partitions balance load but make a range query touch every partition',
        'too many small partitions add metadata and small-file overhead',
      ],
      failure_modes: [
        'a skewed key sends most of the data to one partition',
        'queries that do not filter on the partition key scan everything',
        'repartitioning a live dataset forces a large data movement',
      ],
    },
    falsePremise:
      'Hash partitioning keeps keys in sorted order across partitions, so a range query only has to read one partition.',
    twist: 'one celebrity account now produces half of all the events',
  },
  {
    id: 'data.etl_elt',
    area: 'data',
    title: 'ETL vs ELT',
    ask: 'Ask them to compare ETL and ELT and choose one for loading application data into a warehouse.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'ETL transforms data in a separate processing step before loading it into the warehouse',
        'ELT loads the raw data into the warehouse first and transforms it there, usually with SQL',
        'incremental loads pick up only new or changed rows, using a timestamp or change data capture',
      ],
      trade_offs: [
        'ELT keeps the raw data, so transformations can be changed and rerun later, at the cost of warehouse compute and storage',
        'ETL can drop or mask sensitive fields before they ever reach the warehouse',
        'full reloads are simple and self-correcting but slow as data grows; incremental loads are fast but can miss changes',
      ],
      failure_modes: [
        'rerunning a load that is not idempotent and duplicating rows',
        'an upstream schema change silently breaking columns or filling them with NULLs',
        'an incremental load keyed on an updated_at column that some writes do not update',
      ],
    },
    falsePremise:
      'ELT means the data is never transformed, so analysts always query the raw source tables directly.',
    twist: "the source tables now include customers' personal data that analysts must never see",
  },
  {
    id: 'data.dimensional_modelling',
    area: 'data',
    title: 'Dimensional modelling',
    ask: "Ask them to design a star schema for an online store's sales, and explain what belongs in the fact table and what belongs in the dimensions.",
    minLevel: 'junior',
    expected: {
      mechanism: [
        'a fact table holds measurable events such as sales, at one declared grain',
        'dimension tables hold the descriptive context such as product, customer and date',
        'facts reference dimensions through surrogate keys',
        'slowly changing dimensions track attribute changes; type 2 adds a new row with validity dates',
      ],
      trade_offs: [
        'a star schema denormalises dimensions for simple, fast analytical queries at the cost of duplicated attributes',
        'a snowflake schema normalises the dimensions to save space but needs more joins',
        'type 2 dimensions keep history but grow the table and make queries pick the right version',
      ],
      failure_modes: [
        'mixing grains in one fact table, which double counts in sums',
        "overwriting a customer's region, so their past sales move to the new region in every report",
        'facts arriving before their dimension row exists (late-arriving dimensions)',
      ],
    },
    falsePremise:
      'A star schema is fully normalised to third normal form, which is why analytical queries on it need so many joins.',
    twist:
      'customers can now move between regions, and finance wants each past sale reported under the region at the time of sale',
  },
]
