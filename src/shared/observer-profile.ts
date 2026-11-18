import { isAbsolute } from 'path';
import { paths } from './paths.js';
import { SettingsDefaultsManager } from './SettingsDefaultsManager.js';
import { observerBillsSessionProfile } from './observer-profile-mode.js';

/** Longest config dir a session-init request may report; anything longer is not a path we would create. */
const MAX_REPORTED_CONFIG_DIR_LENGTH = 4096;

/**
 * The config dir a hook reported, or undefined when it reported none or
 * something that is not an absolute path. '' is kept: it is the hook's way of
 * saying the session runs on the default profile (no CLAUDE_CONFIG_DIR in its
 * environment), which differs from an exported default path (#4149).
 */
export function parseReportedClaudeConfigDir(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_REPORTED_CONFIG_DIR_LENGTH) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return '';
  return isAbsolute(trimmed) ? trimmed : undefined;
}

/**
 * The config dir whose login a session's observer must use: the one the
 * session reported ('' = the default profile) when CLAUDE_MEM_OBSERVER_PROFILE
 * is 'session', else undefined (the worker profile).
 */
export function observerConfigDirFor(
  reportedConfigDir: string | undefined,
  settings: { CLAUDE_MEM_OBSERVER_PROFILE?: string } = SettingsDefaultsManager.loadFromFile(paths.settings()),
): string | undefined {
  if (!observerBillsSessionProfile(settings)) return undefined;
  return reportedConfigDir;
}
