/** A job that runs pass after pass until it is stopped. */
export interface RepeatingJob {
  /**
   * Stops the job. Waits for a pass that is running, so that shutting down
   * does not cut it off between doing something and writing down that it did.
   */
  readonly stop: () => Promise<void>
}

/** What runs, how often, and what is said when a pass fails. */
export interface Repetition {
  /** One pass. */
  readonly run: () => Promise<unknown>
  /** The pause between the end of one pass and the start of the next. */
  readonly intervalMs: number
  /** How long after the start the first pass comes, so that it does not run during the start. */
  readonly firstAfterMs: number
  /** The sentence said when a pass fails, before the next one is planned. */
  readonly failure: string
  /** Where it is said; the log, unless a test listens. */
  readonly complain?: (line: string, error: unknown) => void
}

/**
 * Runs a job again and again, one pass after the other and never two at once.
 *
 * A pass that takes longer than the interval, because a mail server takes its
 * time, simply delays the next one: the pause is counted from the end of a
 * pass. A pass that fails is said in the log and changes nothing else; the
 * next one comes as planned, because whatever the job does is still there to
 * be done.
 *
 * The timer does not keep the process alive. An instance stops when it is
 * told to, and `stop` is how the job is asked to finish first.
 */
export function startRepeating(repetition: Repetition): RepeatingJob {
  const complain = repetition.complain ?? console.error
  let stopped = false
  let running: Promise<void> | null = null
  let timer: NodeJS.Timeout | null = null

  const schedule = (delay: number) => {
    timer = setTimeout(tick, delay)
    timer.unref()
  }

  function tick() {
    running = Promise.resolve()
      .then(() => repetition.run())
      .then(() => undefined)
      .catch((error: unknown) => {
        complain(repetition.failure, error)
      })
      .finally(() => {
        running = null

        if (!stopped) {
          schedule(repetition.intervalMs)
        }
      })
  }

  schedule(repetition.firstAfterMs)

  return {
    stop: async () => {
      stopped = true

      if (timer) {
        clearTimeout(timer)
      }

      await running
    },
  }
}
