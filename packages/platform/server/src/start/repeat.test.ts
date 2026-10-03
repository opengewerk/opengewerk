import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startRepeating } from './repeat.js'

/**
 * The rhythm the jobs of an instance run in: the mail, the push messages and
 * whatever an application keeps going in the background. One pass after the
 * other, never two at once, and a stop that waits for the pass that is
 * running.
 */

/** A pass that runs until the test lets it finish. */
function controlledPass() {
  let started = 0
  let finish = () => {}

  const run = () => {
    started += 1

    return new Promise<void>((resolve) => {
      finish = resolve
    })
  }

  return { run, started: () => started, finish: () => finish() }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a job that repeats', () => {
  it('runs its first pass a while after the start, not during it', async () => {
    const pass = controlledPass()
    const job = startRepeating({
      run: pass.run,
      intervalMs: 60_000,
      firstAfterMs: 5_000,
      failure: 'Die Probe ist gescheitert.',
    })

    await vi.advanceTimersByTimeAsync(4_999)
    expect(pass.started()).toBe(0)

    await vi.advanceTimersByTimeAsync(1)
    expect(pass.started()).toBe(1)

    pass.finish()
    await job.stop()
  })

  it('never runs two passes at once, and counts the pause from the end of a pass', async () => {
    const pass = controlledPass()
    const job = startRepeating({
      run: pass.run,
      intervalMs: 60_000,
      firstAfterMs: 5_000,
      failure: 'Die Probe ist gescheitert.',
    })

    await vi.advanceTimersByTimeAsync(5_000)
    // A slow mail server holds the first pass up for three intervals.
    await vi.advanceTimersByTimeAsync(180_000)
    expect(pass.started()).toBe(1)

    pass.finish()
    await vi.advanceTimersByTimeAsync(59_999)
    expect(pass.started()).toBe(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(pass.started()).toBe(2)

    pass.finish()
    await job.stop()
  })

  it('says a failed pass in its own words and plans the next one all the same', async () => {
    const complain = vi.fn()
    const failure = new Error('Der Mailserver ist weg.')
    let runs = 0
    const job = startRepeating({
      run: () => {
        runs += 1

        return Promise.reject(failure)
      },
      intervalMs: 60_000,
      firstAfterMs: 5_000,
      failure: 'Der Versand ist gescheitert.',
      complain,
    })

    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(60_000)

    expect(runs).toBe(2)
    expect(complain).toHaveBeenCalledWith('Der Versand ist gescheitert.', failure)

    await job.stop()
  })

  it('waits on stopping for the pass that is running, and runs none after it', async () => {
    const pass = controlledPass()
    const job = startRepeating({
      run: pass.run,
      intervalMs: 60_000,
      firstAfterMs: 5_000,
      failure: 'Die Probe ist gescheitert.',
    })

    await vi.advanceTimersByTimeAsync(5_000)

    let stopped = false
    const stopping = job.stop().then(() => {
      stopped = true
    })

    await vi.advanceTimersByTimeAsync(1_000)
    expect(stopped).toBe(false)

    pass.finish()
    await stopping
    expect(stopped).toBe(true)

    await vi.advanceTimersByTimeAsync(600_000)
    expect(pass.started()).toBe(1)
  })

  it('runs nothing at all when it is stopped before its first pass', async () => {
    const pass = controlledPass()
    const job = startRepeating({
      run: pass.run,
      intervalMs: 60_000,
      firstAfterMs: 5_000,
      failure: 'Die Probe ist gescheitert.',
    })

    await job.stop()
    await vi.advanceTimersByTimeAsync(600_000)

    expect(pass.started()).toBe(0)
  })
})
