import { clearMailbox } from './support/mailpit.ts'

// Once per run, before the first spec: an empty mailbox. Never between specs —
// each one looks only for letters to its own fresh address, and clearing
// mid-run would race the worker still sending someone's letter.
export default async function globalSetup(): Promise<void> {
  await clearMailbox()
}
