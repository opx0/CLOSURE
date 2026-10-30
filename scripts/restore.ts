import { restoreJsonl } from './backup.ts'

const [, , backup, destination] = process.argv
if (!backup || !destination) throw new Error('Usage: bun run data:restore BACKUP NEW_DIRECTORY')
const count = await restoreJsonl(backup, destination)
console.log(
  `Restored ${count} files into a new directory. Set LEVELHEAD_EVENT_DIR and LEVELHEAD_EXPORT_DIR to its events and exports directories. If sources were included, set LEVELHEAD_RESTORE_SOURCE_FROM to the original LEVELHEAD_SOURCE_DIR from recovery-settings.json and LEVELHEAD_RESTORE_SOURCE_TO to the restored sources directory (both absolute). In this mode the server refuses to read snapshots outside that source root. Database jobs and repositories outside the configured source root are not recovered.`,
)
