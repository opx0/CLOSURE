import type { Topic } from '@levelhead/contracts'

export const DEVOPS_TOPICS: readonly Topic[] = [
  {
    id: 'devops.containers_vms',
    area: 'devops',
    title: 'Containers vs virtual machines',
    ask: 'Ask them to explain how a container differs from a virtual machine and when they would use each.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'a VM runs a full guest OS on virtualised hardware through a hypervisor',
        'containers share the host kernel and are isolated with namespaces and cgroups',
        'a container image packages the app and its dependencies in layers',
      ],
      trade_offs: [
        'containers start in seconds and use less memory; a VM boots a whole OS',
        'VMs isolate more strongly because they do not share a kernel',
        'containers must target the host kernel, so Linux containers need a Linux kernel underneath',
      ],
      failure_modes: [
        'a kernel vulnerability can let a process escape its container',
        'running containers as root widens the blast radius of a compromise',
        'data written inside the container filesystem is lost when the container is replaced',
      ],
    },
    falsePremise:
      'Every Docker container boots its own copy of the Linux kernel, which is why containers are as isolated as virtual machines.',
    twist: 'the platform must now run untrusted code uploaded by customers',
  },
  {
    id: 'devops.ci_cd',
    area: 'devops',
    title: 'CI/CD pipelines',
    ask: 'Ask them to describe a CI/CD pipeline for a web service, from a pushed commit to production.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'every push triggers an automated build and the test suite',
        'the build artifact is produced once and promoted through environments',
        'deployment is automated with a strategy such as rolling, blue-green or canary',
      ],
      trade_offs: [
        'more test stages catch more bugs but slow down feedback',
        'continuous deployment ships faster; a manual approval gate adds control',
        'a canary limits the blast radius but needs good monitoring to judge it',
      ],
      failure_modes: [
        'flaky tests teach the team to ignore red builds',
        'a bad deploy with no quick rollback path',
        'secrets leaking into build logs',
        'a database migration the previous version of the app cannot handle',
      ],
    },
    falsePremise:
      'Rolling back is always safe, because the previous version of the app can read whatever the new version wrote to the database.',
    twist:
      'the team now deploys twenty times a day and one deploy last week took the site down for an hour',
  },
  {
    id: 'devops.kubernetes',
    area: 'devops',
    title: 'Kubernetes basics',
    ask: 'Ask them to explain what Kubernetes does for a containerised service, covering pods, deployments and services.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'a pod is one or more containers scheduled together on a node, sharing a network namespace',
        'a deployment declares the desired number of replicas, and controllers keep reconciling the actual state towards it',
        'a service gives a stable name and virtual IP that spreads traffic across the pods matching its selector',
        'readiness probes decide when a pod gets traffic; liveness probes decide when it is restarted',
      ],
      trade_offs: [
        'declarative self-healing and rolling updates against a large operational surface for a small team',
        'resource requests let the scheduler pack pods; limits protect neighbours but throttle CPU and kill a container that exceeds its memory limit',
        'a managed cluster costs money but removes the upkeep of the control plane',
      ],
      failure_modes: [
        'a container that keeps crashing or exceeding its memory limit, stuck restarting in CrashLoopBackOff',
        'a liveness probe that fails under load, so Kubernetes restarts pods that were busy rather than broken',
        'no readiness probe, so traffic reaches pods before they can serve it',
      ],
    },
    falsePremise:
      'A pod keeps its IP address forever, so other services should call it directly by that IP.',
    twist: 'traffic now spikes tenfold every day at 9 a.m. for half an hour',
  },
  {
    id: 'devops.observability',
    area: 'devops',
    title: 'Observability: logs, metrics and traces',
    ask: 'Ask them how they would find out why a production service got slow, using logs, metrics and traces.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'metrics are numeric time series such as request rate, error rate and latency percentiles',
        'logs are timestamped records of single events, best structured with fields such as a request id',
        'a distributed trace follows one request across services as a tree of timed spans sharing a propagated trace id',
        'alerts fire on symptoms users feel, such as error rate or latency against an SLO',
      ],
      trade_offs: [
        'metrics are cheap to keep but aggregated; logs and traces keep detail but cost storage',
        'sampling traces cuts cost but can miss the rare slow request',
        'high-cardinality labels such as a user id make metrics expensive or unusable',
      ],
      failure_modes: [
        'alerting on an average that hides a slow p99',
        "logs without a request id that cannot be tied to one user's request",
        'so many noisy alerts that the team starts ignoring pages',
      ],
    },
    falsePremise:
      'If the average latency looks fine, every user is getting a fast response, so percentiles are unnecessary.',
    twist: 'one request in a thousand takes ten seconds, and it passes through seven services',
  },
]
