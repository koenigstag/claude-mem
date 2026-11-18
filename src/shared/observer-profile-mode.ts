/**
 * CLAUDE_MEM_OBSERVER_PROFILE — whose Claude login a session's observer bills.
 *
 *   - 'worker' (default): one profile for every session, CLAUDE_MEM_CLAUDE_CONFIG_DIR
 *     else the worker's own CLAUDE_CONFIG_DIR / default (#3785).
 *   - 'session': the CLAUDE_CONFIG_DIR the session's own hook ran under, so a
 *     machine with one Claude Code profile per account summarizes each
 *     account's sessions on that account. A session that never reported one
 *     (another host, an older hook, a worker restart before its next prompt)
 *     uses the worker profile.
 *
 * No imports, so SettingsDefaultsManager can take its default from here.
 */
export const OBSERVER_PROFILE_MODES = ['worker', 'session'] as const;

export type ObserverProfileMode = typeof OBSERVER_PROFILE_MODES[number];

export const DEFAULT_OBSERVER_PROFILE_MODE: ObserverProfileMode = 'worker';

export function isObserverProfileMode(value: unknown): value is ObserverProfileMode {
  return (OBSERVER_PROFILE_MODES as readonly unknown[]).includes(value);
}

/** Whether each session's observer runs on, and is billed to, that session's own Claude profile. */
export function observerBillsSessionProfile(settings: { CLAUDE_MEM_OBSERVER_PROFILE?: string }): boolean {
  return settings.CLAUDE_MEM_OBSERVER_PROFILE === ('session' satisfies ObserverProfileMode);
}
