import { restoreJsonl } from './backup.ts'

const [, , backup, destination] = process.argv
if (!backup || !destination) throw new Error('Usage: bun run data:restore BACKUP NEW_DIRECTORY')
const count = await restoreJsonl(backup, destination)
console.log(
  `Restored ${count} files into a new directory. Set LEVELHEAD_EVENT_DIR to its events directory and LEVELHEAD_EXPORT_DIR to its exports directory; v2/v3 restore plans and nudges beside events, and v3 restores benchmark outputs beside exports. If present, recovery-settings.json lists nonsecret original settings to review, not automatically apply. Existing application data was not changed. Database jobs and out-of-root repositories are not recovered.`,
)
