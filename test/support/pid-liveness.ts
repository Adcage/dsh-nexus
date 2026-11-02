/**
 * PID liveness for the real-process assertions in the Windows acceptance suite.
 *
 * `process.kill(pid, 0)` is the only portable "does this OS process exist"
 * probe Node offers, and its failure codes carry different meanings: `ESRCH`
 * means the process is gone, `EPERM` means it exists but this process may not
 * signal it, and anything else is an unexpected environment failure. A helper
 * that maps every throw to "gone" would let a cleanup assertion pass for the
 * wrong reason, so this one only reports absence on `ESRCH`.
 *
 * @module dsh-nexus/test/support/pid-liveness
 */

/** The liveness probe seam; production passes Node's `process.kill`. */
export type PidProbe = (pid: number) => unknown

/** Node's `process.kill(pid, 0)` bound to the real process object. */
const defaultProbe: PidProbe = (pid) => process.kill(pid, 0)

/**
 * Decide whether one OS process still exists.
 * @param pid - process id to probe.
 * @param probe - liveness probe; overridable for tests.
 * @returns true while the process exists (including when it cannot be signalled).
 * @throws Error when the probe fails for a reason other than "no such process";
 *   an inconclusive probe must never be reported as absence.
 */
export function pidAlive(pid: number, probe: PidProbe = defaultProbe): boolean {
  try {
    probe(pid)
    return true
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if (code === 'ESRCH') return false
    // A process this one may not signal still exists; access errors are not
    // evidence of absence.
    if (code === 'EPERM') return true
    throw new Error(
      `pid liveness is inconclusive for ${pid}: the probe failed with ${typeof code === 'string' ? code : String(code)} (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    )
  }
}
