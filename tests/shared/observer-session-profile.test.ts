/**
 * CLAUDE_MEM_OBSERVER_PROFILE=session — a session's observer runs on, and is
 * billed to, the Claude Code profile the session's own hook ran under, instead
 * of the one profile the worker uses for everyone (#3785 / plan-19 #3607).
 *
 * Pinned here:
 *   1. what a session-init request may report, and when the mode uses it,
 *   2. the hook reports its CLAUDE_CONFIG_DIR only from a Claude Code host hook,
 *   3. the SDK child env carries the session's profile (explicit or default),
 *   4. the token comes from that profile's login only: never the worker's
 *      CLAUDE_CODE_OAUTH_TOKEN or the OS store's bare entry, which may belong
 *      to another account.
 */
import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import * as fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildIsolatedEnv, buildIsolatedEnvWithFreshOAuth, credentialProfileKey, resolveConfigDirProfileKey } from '../../src/shared/EnvManager.js';
import { readClaudeOAuthToken, resolveClaudeCredentialProfile, resolveEffectiveClaudeConfigDir } from '../../src/shared/oauth-token.js';
import { observerConfigDirFor, parseReportedClaudeConfigDir } from '../../src/shared/observer-profile.js';
import { hookClaudeConfigDir } from '../../src/cli/handlers/hook-host.js';
import type { NormalizedHookInput } from '../../src/cli/types.js';
import { paths, DEFAULT_CLAUDE_CONFIG_DIR } from '../../src/shared/paths.js';

const ORIGINAL_PLATFORM = process.platform;
const ORIGINAL_ENV = {
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
  ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
  CLAUDE_MEM_ENV_FILE: process.env.CLAUDE_MEM_ENV_FILE,
};

function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

function setEnvVar(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

let tempDir: string;
let settingsPath: string;
let sessionDir: string;
let workerDir: string;
let settingsSpy: ReturnType<typeof spyOn> | undefined;
let dataDirSpy: ReturnType<typeof spyOn> | undefined;

function stubSettings(settings: Record<string, string>): void {
  fs.writeFileSync(settingsPath, JSON.stringify(settings));
}

function writeLogin(configDir: string, accessToken: string): void {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(join(configDir, '.credentials.json'), JSON.stringify({
    claudeAiOauth: { accessToken, expiresAt: Date.now() + 60 * 60 * 1000 },
  }));
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'claude-mem-session-profile-'));
  settingsPath = join(tempDir, 'settings.json');
  sessionDir = join(tempDir, 'profiles', 'account-a');
  workerDir = join(tempDir, 'worker-profile');
  stubSettings({});
  settingsSpy = spyOn(paths, 'settings').mockImplementation(() => settingsPath);
  dataDirSpy = spyOn(paths, 'dataDir').mockImplementation(() => tempDir);
  process.env.CLAUDE_MEM_ENV_FILE = join(tempDir, 'nonexistent.env');
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  delete process.env.CLAUDE_CONFIG_DIR;
});

afterEach(() => {
  settingsSpy?.mockRestore();
  dataDirSpy?.mockRestore();
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true });
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) setEnvVar(key, value);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('what a session reports, and when it is used', () => {
  it("keeps an empty report as '', the default profile", () => {
    expect(parseReportedClaudeConfigDir('')).toBe('');
    expect(parseReportedClaudeConfigDir('   ')).toBe('');
  });

  it('keeps an absolute dir and ignores anything that is not one', () => {
    expect(parseReportedClaudeConfigDir(` ${sessionDir} `)).toBe(sessionDir);
    expect(parseReportedClaudeConfigDir('relative/profile')).toBeUndefined();
    expect(parseReportedClaudeConfigDir(42)).toBeUndefined();
    expect(parseReportedClaudeConfigDir(undefined)).toBeUndefined();
    expect(parseReportedClaudeConfigDir(`/${'x'.repeat(5000)}`)).toBeUndefined();
  });

  it('uses the reported dir only in session mode', () => {
    expect(observerConfigDirFor(sessionDir, { CLAUDE_MEM_OBSERVER_PROFILE: 'worker' })).toBeUndefined();
    expect(observerConfigDirFor(sessionDir, { CLAUDE_MEM_OBSERVER_PROFILE: 'session' })).toBe(sessionDir);
    expect(observerConfigDirFor('', { CLAUDE_MEM_OBSERVER_PROFILE: 'session' })).toBe('');
    expect(observerConfigDirFor(undefined, { CLAUDE_MEM_OBSERVER_PROFILE: 'session' })).toBeUndefined();
  });

  it('reads the mode from the settings file by default', () => {
    expect(observerConfigDirFor(sessionDir)).toBeUndefined();
    stubSettings({ CLAUDE_MEM_OBSERVER_PROFILE: 'session' });
    expect(observerConfigDirFor(sessionDir)).toBe(sessionDir);
  });
});

describe('the hook reports its CLAUDE_CONFIG_DIR', () => {
  const hookInput = { sessionId: 's', transcriptPath: '/p/projects/x/s.jsonl' } as NormalizedHookInput;

  it("reports a Claude Code hook's profile, '' for the default one", () => {
    expect(hookClaudeConfigDir(hookInput, 'claude', false, { CLAUDE_CONFIG_DIR: sessionDir })).toEqual({ claudeConfigDir: sessionDir });
    expect(hookClaudeConfigDir(hookInput, 'claude', false, {})).toEqual({ claudeConfigDir: '' });
  });

  it("does not report the worker's environment from the transcript watcher", () => {
    expect(hookClaudeConfigDir(hookInput, 'claude', true, { CLAUDE_CONFIG_DIR: sessionDir })).toEqual({});
    expect(hookClaudeConfigDir({ sessionId: 's' } as NormalizedHookInput, 'claude', false, { CLAUDE_CONFIG_DIR: sessionDir })).toEqual({});
  });

  it('does not report for other hosts, Qwen included', () => {
    expect(hookClaudeConfigDir(hookInput, 'codex', false, { CLAUDE_CONFIG_DIR: sessionDir })).toEqual({});
    expect(hookClaudeConfigDir(hookInput, 'claude', false, { CLAUDE_CONFIG_DIR: sessionDir, QWEN_PROJECT_DIR: '/q' })).toEqual({});
  });
});

describe("the SDK child runs on the session's profile", () => {
  it("stamps the session's dir even when the worker profile names another", () => {
    stubSettings({ CLAUDE_MEM_CLAUDE_CONFIG_DIR: workerDir });
    expect(buildIsolatedEnv(true).CLAUDE_CONFIG_DIR).toBe(workerDir);
    expect(buildIsolatedEnv(true, sessionDir).CLAUDE_CONFIG_DIR).toBe(sessionDir);
  });

  it('leaves CLAUDE_CONFIG_DIR unset for a session on the default profile', () => {
    stubSettings({ CLAUDE_MEM_CLAUDE_CONFIG_DIR: workerDir });
    expect(buildIsolatedEnv(true, '').CLAUDE_CONFIG_DIR).toBeUndefined();
  });

  it('treats an exported default dir as an explicit profile, as the CLI does', () => {
    stubSettings({ CLAUDE_MEM_CLAUDE_CONFIG_DIR: workerDir });
    expect(buildIsolatedEnv(true, DEFAULT_CLAUDE_CONFIG_DIR).CLAUDE_CONFIG_DIR)
      .toBe(resolveEffectiveClaudeConfigDir(DEFAULT_CLAUDE_CONFIG_DIR));
    expect(resolveConfigDirProfileKey(DEFAULT_CLAUDE_CONFIG_DIR)).not.toBe('default');
  });

  it("keys quota by the session's account", () => {
    stubSettings({ CLAUDE_MEM_CLAUDE_CONFIG_DIR: workerDir });
    expect(resolveConfigDirProfileKey(sessionDir)).toBe(credentialProfileKey(resolveClaudeCredentialProfile(sessionDir)));
    expect(resolveConfigDirProfileKey(sessionDir)).not.toBe(resolveConfigDirProfileKey());
    expect(resolveConfigDirProfileKey('')).toBe('default');
  });

  it("injects the session profile's token, not the worker profile's", async () => {
    setPlatform('aix');
    writeLogin(sessionDir, 'sk-ant-oat01-session');
    writeLogin(workerDir, 'sk-ant-oat01-worker');
    stubSettings({ CLAUDE_MEM_CLAUDE_CONFIG_DIR: workerDir });

    const env = await buildIsolatedEnvWithFreshOAuth(true, { sessionConfigDir: sessionDir });

    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-session');
    expect(env.CLAUDE_CONFIG_DIR).toBe(sessionDir);
  });
});

describe("the token comes from the session profile's own login", () => {
  it('reads the profile credentials file', async () => {
    setPlatform('linux');
    writeLogin(sessionDir, 'sk-ant-oat01-session');
    const execImpl = mock(() => Promise.reject(new Error('no OS store under test')));

    const result = await readClaudeOAuthToken(execImpl, sessionDir);

    expect(result.kind).toBe('present');
    if (result.kind === 'present') {
      expect(result.token).toBe('sk-ant-oat01-session');
      expect(result.source).toBe('credentials-file');
    }
  });

  it("falls back to neither the worker's env token nor the OS store's bare entry", async () => {
    setPlatform('linux');
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-other-account';
    const execImpl = mock(() => Promise.resolve({ stdout: 'sk-ant-oat01-os-store', stderr: '' }));

    const result = await readClaudeOAuthToken(execImpl as any, sessionDir);

    expect(result.kind).toBe('absent');
    expect(execImpl).not.toHaveBeenCalled();
  });
});
