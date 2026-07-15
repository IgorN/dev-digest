import { describe, it, expect } from 'vitest';
import { parseCliArgs } from '../src/domain/cli-args.js';

describe('parseCliArgs', () => {
  it('accepts `review --mode working`', () => {
    const result = parseCliArgs(['review', '--mode', 'working']);
    expect(result).toEqual({ ok: true, command: 'review', mode: 'working' });
  });

  it('rejects no arguments at all', () => {
    const result = parseCliArgs([]);
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown command', () => {
    const result = parseCliArgs(['scan']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Unknown command "scan"/);
  });

  it('rejects `review` with no --mode flag', () => {
    const result = parseCliArgs(['review']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Missing required flag --mode/);
  });

  it('rejects --mode with no value', () => {
    const result = parseCliArgs(['review', '--mode']);
    expect(result.ok).toBe(false);
  });

  it('rejects an unsupported mode, naming it in the error (staged/branch are future work)', () => {
    const result = parseCliArgs(['review', '--mode', 'staged']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/"staged" is not supported yet/);
  });
});
