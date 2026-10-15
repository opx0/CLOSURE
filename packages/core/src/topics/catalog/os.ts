import type { Topic } from '@levelhead/contracts'

export const OS_TOPICS: readonly Topic[] = [
  {
    id: 'os.processes_threads',
    area: 'os',
    title: 'Processes and threads',
    ask: 'Ask them to explain the difference between a process and a thread, and when they would choose one over the other.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'a process has its own virtual address space; threads of one process share it',
        'each thread has its own stack, registers and program counter',
        'the scheduler switches threads by saving and restoring their context',
      ],
      trade_offs: [
        'threads are cheaper to create and switch, and share data directly',
        'processes isolate memory and crashes but need IPC to share data',
        'data shared between threads needs synchronisation',
      ],
      failure_modes: [
        'race conditions on shared data',
        'a crash in one thread takes down the whole process',
        'deadlock between threads holding locks',
      ],
    },
    falsePremise:
      'Threads in the same process each get their own copy of the heap, so they never need locks to share data.',
    twist: 'the work now includes running untrusted plugins that sometimes crash',
  },
  {
    id: 'os.deadlock',
    area: 'os',
    title: 'Deadlock',
    ask: 'Ask them what a deadlock is, which conditions produce one, and how a system prevents or recovers from it.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'the four conditions: mutual exclusion, hold and wait, no preemption, circular wait',
        'a cycle in the wait-for graph means the threads in it are deadlocked',
        'breaking any one of the four conditions prevents deadlock',
      ],
      trade_offs: [
        'a global lock order is simple but hard to enforce across a large codebase',
        'timeouts or detection allow recovery but throw away the aborted work',
        "avoidance such as the banker's algorithm needs each thread's maximum demand in advance",
      ],
      failure_modes: [
        'livelock, where threads keep backing off and retrying without progress',
        'starvation of a thread that keeps losing the race for a lock',
        'a deadlock that only appears under rare timing in production',
      ],
    },
    falsePremise:
      'A deadlock needs at least three threads; two threads can never deadlock each other.',
    twist:
      'the two locks are now held by two different services, so no single lock manager sees the cycle',
  },
  {
    id: 'os.cpu_scheduling',
    area: 'os',
    title: 'CPU scheduling',
    ask: 'Ask them how an operating system decides which ready process runs next, comparing a few scheduling algorithms.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'the scheduler picks from the ready queue whenever a process blocks, finishes or uses up its time slice',
        'first-come first-served, shortest job first, priority and round-robin scheduling',
        'preemptive scheduling interrupts a running process on a timer; non-preemptive waits for it to block or finish',
      ],
      trade_offs: [
        'shortest job first minimises average waiting time but needs burst lengths it can only estimate',
        'a short round-robin time slice improves response time but spends more time on context switches',
        'throughput, turnaround time and response time pull in different directions, so no algorithm wins on all three',
      ],
      failure_modes: [
        'starvation of low-priority processes, which ageing fixes',
        'the convoy effect under first-come first-served, where short jobs wait behind one long job',
        'priority inversion, where a high-priority task waits on a lock held by a low-priority one',
      ],
    },
    falsePremise:
      'Round robin with a time slice longer than every burst turns into shortest job first, so it gives the lowest average waiting time.',
    twist:
      'the machine now runs a video call next to a long compile job, and the call must never stutter',
  },
  {
    id: 'os.virtual_memory',
    area: 'os',
    title: 'Virtual memory and paging',
    ask: "Ask them to explain how virtual memory maps a process's addresses to physical memory, and what happens on a page fault.",
    minLevel: 'junior',
    expected: {
      mechanism: [
        'each process sees its own virtual address space, split into fixed-size pages',
        'the page table maps virtual pages to physical frames, and the TLB caches recent translations',
        'touching a page that is not in memory raises a page fault; the OS loads the page and resumes the instruction',
        'when memory is full, a replacement policy such as LRU or clock picks a page to evict',
      ],
      trade_offs: [
        'larger pages mean fewer TLB misses and smaller page tables but more internal fragmentation',
        'paging lets programs use more memory than is physically present, at the cost of slow disk accesses',
        'multi-level page tables save memory for sparse address spaces but add memory reads on a TLB miss',
      ],
      failure_modes: [
        'thrashing, when the working sets do not fit in memory and the system spends its time paging',
        'an access to an unmapped address ending in a segmentation fault',
        'overcommitted memory running out and the OOM killer ending a process',
      ],
    },
    falsePremise:
      'A page fault always means the program touched invalid memory, so a healthy program never has any.',
    twist: 'the machine has 8 GB of RAM and the running programs now need 12 GB between them',
  },
  {
    id: 'os.mutex_semaphore',
    area: 'os',
    title: 'Mutexes, semaphores and synchronisation',
    ask: 'Ask them to explain the difference between a mutex and a semaphore, and how they would use each to coordinate threads.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'a critical section must run in one thread at a time, and a lock gives that mutual exclusion',
        'a mutex has an owner: only the thread that locked it may unlock it',
        'a counting semaphore holds a count; wait blocks while it is zero and then decrements it, signal increments it',
        'a condition variable lets a thread sleep until another thread signals that the shared state changed',
      ],
      trade_offs: [
        'a spinlock avoids a context switch for very short waits but burns CPU while it spins',
        'one coarse lock is simple but serialises the work; fine-grained locks allow parallelism but invite deadlock',
        'a semaphore can admit up to N threads to a pool of N resources, which a mutex cannot',
      ],
      failure_modes: [
        'a lock not released on an error path, so every other thread blocks forever',
        'waiting on a condition variable with if instead of a while loop, so a spurious or stolen wake-up proceeds on a false condition',
        'a semaphore signalled one time too many, letting in more threads than there are resources',
      ],
    },
    falsePremise:
      'A binary semaphore and a mutex are the same thing, so any thread may unlock a mutex that another thread locked.',
    twist: 'a pool of five database connections is now shared by fifty worker threads',
  },
  {
    id: 'os.syscalls_context_switch',
    area: 'os',
    title: 'System calls and context switches',
    ask: 'Ask them what happens when a program makes a system call, and what the OS does to switch the CPU from one process to another.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'user mode cannot touch hardware; a system call traps into kernel mode through a fixed entry point',
        'the kernel validates the arguments, does the work and returns to user mode with a result',
        "a context switch saves the running process's registers and program counter in its process control block and restores another's",
        'switching to a different process also switches the address space',
      ],
      trade_offs: [
        'each system call costs a mode switch, so buffered I/O batches many small writes into one call',
        'switching between threads of one process is cheaper than between processes because the address space stays the same',
        'frequent context switches improve responsiveness but spend CPU time and leave the caches cold',
      ],
      failure_modes: [
        'reading a file one byte per system call and spending most of the time crossing into the kernel',
        'a blocking system call stalling its thread, and with it an event loop running on that thread',
        'a kernel that trusts a pointer from user space letting a process read or overwrite kernel memory',
      ],
    },
    falsePremise:
      'A system call is just an ordinary library function call, so it costs the same as calling any other function.',
    twist:
      'the service now handles 100,000 small network messages per second, each read with its own system call',
  },
]
