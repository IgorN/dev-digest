/**
 * Domain core — pure CLI argument parsing (zero I/O). Only `review --mode
 * working` exists today; `--mode` leaves room for `staged`/`branch` later
 * without changing this shape.
 */

export type ReviewMode = 'working';

export type ParsedCliArgs =
  | { ok: true; command: 'review'; mode: ReviewMode }
  | { ok: false; error: string };

const SUPPORTED_MODES: ReviewMode[] = ['working'];

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const [command, ...rest] = argv;

  if (command === undefined) {
    return { ok: false, error: 'Usage: devdigest review --mode working' };
  }
  if (command !== 'review') {
    return { ok: false, error: `Unknown command "${command}". Usage: devdigest review --mode working` };
  }

  const modeIndex = rest.indexOf('--mode');
  if (modeIndex === -1) {
    return { ok: false, error: 'Missing required flag --mode. Usage: devdigest review --mode working' };
  }
  const mode = rest[modeIndex + 1];
  if (mode === undefined) {
    return { ok: false, error: '--mode requires a value. Usage: devdigest review --mode working' };
  }
  if (!SUPPORTED_MODES.includes(mode as ReviewMode)) {
    return {
      ok: false,
      error: `--mode "${mode}" is not supported yet (only "working" today — staged/branch modes are planned).`,
    };
  }

  return { ok: true, command: 'review', mode: mode as ReviewMode };
}
