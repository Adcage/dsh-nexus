/**
 * PID liveness semantics for the real-process acceptance assertions.
 *
 * `ESRCH` is the only proof of absence. `EPERM` means the process exists but
 * cannot be signalled from here, and any other failure is inconclusive — both
 * must never satisfy a "the process tree is gone" assertion by accident.
 *
 * @module dsh-nexus/test/support/pid-liveness.test
 */

import { describe, expect, it } from 'vitest'
import { pidAlive } from './pid-liveness.ts'

/** A probe failure carrying one Node error code. */
function failure(code: string): Error {
  const error = new Error(`probe failed with ${code}`) as Error & { code: string }
  error.code = code
  return error
}

describe('pid liveness', () => {
  it('reports a live process when the probe succeeds', () => {
    expect(pidAlive(4242, () => true)).toBe(true)
  })

  it('reports absence only for ESRCH', () => {
    expect(
      pidAlive(4242, () => {
        throw failure('ESRCH')
      }),
    ).toBe(false)
  })

  it('keeps a process it may not signal alive instead of calling it gone', () => {
    expect(
      pidAlive(4242, () => {
        throw failure('EPERM')
      }),
    ).toBe(true)
  })

  it('fails loudly for an unexpected probe error rather than reporting absence', () => {
    expect(() =>
      pidAlive(4242, () => {
        throw failure('EINVAL')
      }),
    ).toThrowError(/inconclusive[\s\S]*4242[\s\S]*EINVAL/u)
  })

  it('sees the running test process itself through the real probe', () => {
    expect(pidAlive(process.pid)).toBe(true)
  })
})
