import type { Topic } from '@levelhead/contracts'

export const DSA_TOPICS: readonly Topic[] = [
  {
    id: 'dsa.hash_maps',
    area: 'dsa',
    title: 'Hash maps',
    ask: 'Ask them to explain how a hash map stores and finds a key, and what a lookup really costs.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'a hash function maps the key to a bucket index',
        'collisions are resolved by chaining or open addressing',
        'the table grows and rehashes when the load factor passes a threshold',
      ],
      trade_offs: [
        'O(1) lookup on average but O(n) in the worst case',
        'more memory than a sorted array holding the same data',
        'no key order, unlike a balanced tree map with O(log n) operations and sorted iteration',
      ],
      failure_modes: [
        'a poor hash or adversarial keys pile into one bucket and lookups degrade to linear time',
        'mutating a key after insertion makes it unfindable',
        'a resize causes a one-off latency spike',
      ],
    },
    falsePremise:
      'A hash map lookup is O(1) even in the worst case, so collisions never affect performance.',
    twist: 'the keys now come from users on the internet, and an attacker can choose them',
  },
  {
    id: 'dsa.bfs_dfs',
    area: 'dsa',
    title: 'BFS vs DFS',
    ask: 'Ask them to explain how breadth-first and depth-first search traverse a graph, and when each is the right choice.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'BFS uses a queue and visits nodes level by level',
        'DFS uses a stack or recursion and goes as deep as possible before backtracking',
        'a visited set stops revisits when the graph has cycles',
      ],
      trade_offs: [
        'BFS finds shortest paths in an unweighted graph but may hold a whole level in memory',
        'DFS uses memory proportional to depth and suits cycle detection and topological sort',
        'both run in O(V + E) time',
      ],
      failure_modes: [
        'forgetting the visited set loops forever on a cycle',
        'recursive DFS overflows the call stack on a very deep graph',
        'plain BFS gives wrong shortest paths when edges have weights',
      ],
    },
    falsePremise:
      'DFS also finds the shortest path in an unweighted graph, and it gets there faster than BFS.',
    twist:
      'the graph is a social network with a billion users and you only need people within three hops',
  },
  {
    id: 'dsa.complexity',
    area: 'dsa',
    title: 'Time and space complexity',
    ask: 'Ask them how they work out the time and space complexity of an algorithm, using a nested loop and a recursive function as examples.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'Big O describes how cost grows with input size, dropping constants and lower-order terms',
        'nested loops over the same input multiply; steps in sequence add',
        'recursion is analysed by the number of calls times the work per call, for example with a recurrence',
        'space counts the extra memory used, including the recursion stack',
      ],
      trade_offs: [
        'trading memory for time, such as a hash set that turns an O(n²) pair check into O(n)',
        'an O(n log n) algorithm can lose to an O(n²) one on small inputs because of constant factors',
        'the amortised cost of an operation, such as appending to a dynamic array, against its worst single case',
      ],
      failure_modes: [
        'treating a hidden linear operation inside a loop, such as slicing or string concatenation, as constant time',
        'leaving the recursion stack out of the space cost',
        'quoting the average case when the input will hit the worst case',
      ],
    },
    falsePremise:
      'Two nested loops always mean O(n²), so any algorithm with a loop inside a loop is quadratic.',
    twist: 'the input grows from a thousand items to a billion, and memory is capped at 1 GB',
  },
  {
    id: 'dsa.heaps',
    area: 'dsa',
    title: 'Heaps and priority queues',
    ask: 'Ask them how a binary heap implements a priority queue, and to use one to find the k largest items in a stream.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'a binary heap is a complete tree stored in an array, where in a min-heap each parent is no larger than its children',
        'insert adds at the end and sifts up; removing the top moves the last element to the root and sifts down, both O(log n)',
        'building a heap from n items in place takes O(n)',
        'a min-heap of size k keeps the k largest items seen so far',
      ],
      trade_offs: [
        'a heap reads its top in O(1) but needs O(n) to find any other item',
        'a heap of size k takes O(n log k) time and O(k) memory, against O(n log n) for sorting everything',
        'a balanced search tree also gives the minimum and maximum plus sorted iteration, at a higher constant cost',
      ],
      failure_modes: [
        'using a max-heap for the k largest, which then has to hold every item',
        "changing an item's priority in place without sifting it back into position",
        'assuming items with equal priority come out in the order they went in',
      ],
    },
    falsePremise:
      'A binary heap keeps its elements in sorted order, so the k largest can be read straight from the first k positions of the array.',
    twist: 'the data is now spread across 50 machines and you need the global top 100',
  },
  {
    id: 'dsa.dynamic_programming',
    area: 'dsa',
    title: 'Dynamic programming',
    ask: 'Ask them how they recognise a dynamic programming problem, and to build the solution to a classic one such as coin change.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'overlapping subproblems: the same smaller problem is solved many times',
        'optimal substructure: the best answer is built from the best answers to subproblems',
        'define the state, the recurrence between states and the base cases',
        'memoisation caches a recursive solution top-down; tabulation fills a table bottom-up',
      ],
      trade_offs: [
        'memoisation computes only the states it needs but pays for recursion and stack depth',
        'tabulation avoids recursion and can often keep only the last row, cutting space',
        'dynamic programming turns exponential brute force into polynomial time at the cost of memory for the table',
      ],
      failure_modes: [
        'a state that leaves out information the recurrence depends on, giving wrong answers',
        'a greedy choice that looks right, such as always taking the largest coin, failing on some inputs',
        'deep recursion overflowing the stack on large inputs',
      ],
    },
    falsePremise:
      'Coin change can always be solved by greedily taking the largest coin that fits, so dynamic programming is never needed for it.',
    twist: 'you must now return which coins make up the answer, not just how many',
  },
  {
    id: 'dsa.binary_search_answer',
    area: 'dsa',
    title: 'Binary search on the answer',
    ask: 'Ask them to explain binary search, and how it applies when searching over possible answers instead of an array, such as the smallest ship capacity that delivers every package within D days.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'binary search halves the remaining range each step, so it takes O(log n) steps',
        'it works on any monotonic yes/no condition, not only on a sorted array',
        'bound the answer between a low and a high value, test feasibility at the midpoint and keep the half that still holds the smallest feasible value',
      ],
      trade_offs: [
        'the cost is the feasibility check times the log of the answer range, so a huge range is cheap but a slow check is not',
        'a direct formula or a single greedy pass may exist and be simpler',
        'searching an array needs random access; on a linked list binary search loses its advantage',
      ],
      failure_modes: [
        'an infinite loop when the midpoint never moves a bound',
        'integer overflow computing (low + high) / 2 in fixed-width integers',
        'applying it to a condition that is not monotonic, which silently returns a wrong answer',
      ],
    },
    falsePremise:
      'Binary search only works on a sorted array, so it cannot be used when there is no array to search.',
    twist: 'the answer is now a real number that must be accurate to six decimal places',
  },
  {
    id: 'dsa.sorting_stability',
    area: 'dsa',
    title: 'Sorting algorithms and stability',
    ask: 'Ask them to compare quicksort, mergesort and heapsort, and explain what a stable sort is and when it matters.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'quicksort partitions around a pivot and recurses; mergesort sorts each half and merges them',
        'a stable sort keeps equal elements in their original relative order',
        'any comparison sort needs Ω(n log n) comparisons in the worst case',
        'counting sort avoids comparisons and runs in O(n + k) for integer keys in a range of size k',
      ],
      trade_offs: [
        'quicksort is in place and fast in practice but O(n²) in the worst case',
        'mergesort is stable and always O(n log n) but needs O(n) extra memory for arrays',
        'heapsort is in place and O(n log n) in the worst case but not stable and cache-unfriendly',
      ],
      failure_modes: [
        'always picking the first element as pivot, which drives quicksort to O(n²) on already sorted input',
        'sorting by one key and then another with an unstable sort, which scrambles the first ordering',
        'a comparator that is not consistent, which can corrupt the result or make the sort throw',
      ],
    },
    falsePremise:
      'Quicksort is stable, because elements equal to the pivot never move past each other during partitioning.',
    twist: 'the records are 2 TB of log lines on disk and the machine has 16 GB of RAM',
  },
  {
    id: 'dsa.tries',
    area: 'dsa',
    title: 'Tries',
    ask: 'Ask them how a trie stores a set of words, and to use one for autocomplete in a search box.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'each edge is a character, so the path from the root to a node spells a prefix',
        'a flag on a node marks where a complete word ends',
        'lookup and insert take O(L) for a word of length L, however many words are stored',
        'autocomplete walks down to the prefix node and collects the words below it',
      ],
      trade_offs: [
        'prefix queries a hash set cannot answer, at the cost of many small nodes and pointers',
        'a fixed array of children per node is fast but wasteful; a map per node saves memory but is slower',
        'a compressed trie (radix tree) merges chains of single children to save memory',
      ],
      failure_modes: [
        'without an end-of-word flag, a stored prefix cannot be told apart from a stored word',
        'fixed-size child arrays blowing up memory on a large alphabet such as Unicode',
        'collecting every word under a short prefix like "a" being slow without a cap or precomputed top results',
      ],
    },
    falsePremise:
      'A trie lookup takes O(log n) time in the number of stored words, just like a balanced binary search tree.',
    twist:
      'the suggestions must now be the ten most popular completions, not the first ten alphabetically',
  },
]
