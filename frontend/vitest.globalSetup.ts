// Runs in the main process, before any worker is forked, which is the only
// place `TZ` can be set from inside the project: assigned in `test.env` it
// never reaches a worker thread.
export default function setup(): void {
  process.env.TZ = 'UTC'
}
