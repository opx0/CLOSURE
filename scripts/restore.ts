import { restoreJsonl } from './backup.ts'

const [, , backup, destination] = process.argv
if (!backup || !destination) throw new Error('Usage: bun run data:restore BACKUP NEW_DIRECTORY')
const count = await restoreJsonl(backup, destination)
console.log(
  `Restored ${count} files into a new directory. Set LEVELHEAD_EVENT_DIR to its events directory and LEVELHEAD_EXPORT_DIR to its exports directory; v2 backups also restore plans and nudges beside events. Existing application data was not changed. Database jobs and out-of-root repositories are not recovered.`,
)
