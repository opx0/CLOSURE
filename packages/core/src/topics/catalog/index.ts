import type { Topic } from '@levelhead/contracts'
import { BACKEND_TOPICS } from './backend.ts'
import { BEHAVIORAL_TOPICS } from './behavioral.ts'
import { DATA_TOPICS } from './data.ts'
import { DBMS_TOPICS } from './dbms.ts'
import { DEVOPS_TOPICS } from './devops.ts'
import { DSA_TOPICS } from './dsa.ts'
import { ML_TOPICS } from './ml.ts'
import { NETWORKS_TOPICS } from './networks.ts'
import { OOP_TOPICS } from './oop.ts'
import { OS_TOPICS } from './os.ts'
import { SYSTEM_DESIGN_TOPICS } from './system_design.ts'
import { WEB_TOPICS } from './web.ts'

export const TOPICS: readonly Topic[] = [
  ...OS_TOPICS,
  ...DBMS_TOPICS,
  ...NETWORKS_TOPICS,
  ...OOP_TOPICS,
  ...DSA_TOPICS,
  ...SYSTEM_DESIGN_TOPICS,
  ...WEB_TOPICS,
  ...BACKEND_TOPICS,
  ...ML_TOPICS,
  ...DATA_TOPICS,
  ...DEVOPS_TOPICS,
  ...BEHAVIORAL_TOPICS,
]

export function topicById(id: string): Topic | undefined {
  return TOPICS.find((topic) => topic.id === id)
}
