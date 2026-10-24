import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');

function envWithout(name) {
  const env = { ...process.env };
  delete env[name];
  return env;
}

function runNode(args, env) {
  return spawnSync(process.execPath, args, {
    cwd: PROJECT_DIR,
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
}

describe('requireEnv', () => {
  it('exits non-zero and names SPRAWL_API_KEY when unset', () => {
    const result = runNode(
      ['-e', "require('./lib/require-env').requireEnv('SPRAWL_API_KEY')"],
      envWithout('SPRAWL_API_KEY'),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SPRAWL_API_KEY');
  });

  it('exits non-zero and names GATEWAY_TOKEN when unset', () => {
    const result = runNode(
      ['-e', "require('./lib/require-env').requireEnv('GATEWAY_TOKEN')"],
      envWithout('GATEWAY_TOKEN'),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('GATEWAY_TOKEN');
  });

  it('curator-speedrun.js fails naming SPRAWL_API_KEY when unset', () => {
    const result = runNode(['curator-speedrun.js'], envWithout('SPRAWL_API_KEY'));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SPRAWL_API_KEY');
  });

  it('seed-dense.js fails naming GATEWAY_TOKEN when unset', () => {
    const result = runNode(['seed-dense.js'], envWithout('GATEWAY_TOKEN'));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('GATEWAY_TOKEN');
  });

  it('exits non-zero and names the variable when it is empty', () => {
    const result = runNode(
      ['-e', "require('./lib/require-env').requireEnv('GATEWAY_TOKEN')"],
      { ...process.env, GATEWAY_TOKEN: '' },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('GATEWAY_TOKEN');
  });

  it('exits non-zero and names the variable when it is whitespace-only', () => {
    const result = runNode(
      ['-e', "require('./lib/require-env').requireEnv('GATEWAY_TOKEN')"],
      { ...process.env, GATEWAY_TOKEN: '   ' },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('GATEWAY_TOKEN');
  });

  it('returns the value when the variable is set', () => {
    const result = runNode(
      ['-e', "process.stdout.write(require('./lib/require-env').requireEnv('GATEWAY_TOKEN'))"],
      { ...process.env, GATEWAY_TOKEN: 'test-ok' },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('test-ok');
  });
});

