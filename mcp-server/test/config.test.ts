import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/infra/config.js';

describe('loadConfig', () => {
  it('defaults every field when no env vars are set', () => {
    const config = loadConfig({});
    expect(config).toEqual({
      apiBaseUrl: 'http://localhost:3001',
      defaultWaitSeconds: 6,
      maxWaitSeconds: 20,
      logLevel: 'info',
    });
  });

  it('accepts valid overrides', () => {
    const config = loadConfig({
      DEVDIGEST_API_URL: 'http://example.test:4000',
      MCP_RUN_WAIT_SECONDS_DEFAULT: '10',
      MCP_LOG_LEVEL: 'debug',
    });
    expect(config.apiBaseUrl).toBe('http://example.test:4000');
    expect(config.defaultWaitSeconds).toBe(10);
    expect(config.logLevel).toBe('debug');
  });

  it('clamps a valid but too-large wait window to the hard max, no error', () => {
    const config = loadConfig({ MCP_RUN_WAIT_SECONDS_DEFAULT: '999' });
    expect(config.defaultWaitSeconds).toBe(20);
  });

  it('throws instead of silently defaulting when the wait window is non-numeric', () => {
    expect(() => loadConfig({ MCP_RUN_WAIT_SECONDS_DEFAULT: 'not-a-number' })).toThrow(
      /MCP_RUN_WAIT_SECONDS_DEFAULT/,
    );
  });

  it('throws when the wait window is zero or negative', () => {
    expect(() => loadConfig({ MCP_RUN_WAIT_SECONDS_DEFAULT: '0' })).toThrow(/positive/);
    expect(() => loadConfig({ MCP_RUN_WAIT_SECONDS_DEFAULT: '-5' })).toThrow(/positive/);
  });

  it('throws instead of silently defaulting when the API URL is malformed', () => {
    expect(() => loadConfig({ DEVDIGEST_API_URL: 'not a url' })).toThrow(/DEVDIGEST_API_URL/);
  });
});
