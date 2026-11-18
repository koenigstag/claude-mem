import type { NormalizedHookInput } from '../types.js';

/**
 * Is this transcript under Qwen Code's default home, `~/.qwen/`?
 *
 * Matched as a whole path segment so a project directory like `~/.qwen-notes/`
 * is not mistaken for the host.
 */
export const isQwenTranscriptPath = (transcriptPath: string | undefined): boolean => {
  if (!transcriptPath) return false;
  return transcriptPath.replace(/\\/g, '/').includes('/.qwen/');
};

/**
 * Is this hook event from Qwen Code?
 *
 * Qwen runs the same `hook claude-code session-init` command as Claude Code, so
 * `platform` cannot tell the two hosts apart. Qwen sets QWEN_PROJECT_DIR in the
 * environment of every command hook, wherever its transcripts live: they move
 * with QWEN_RUNTIME_DIR, `advanced.runtimeOutputDir` or QWEN_HOME. A transcript
 * under `~/.qwen/` is the fallback signal.
 *
 * Only a host hook's stdin carries `transcript_path`, so an event without one
 * is never Qwen's. That keeps the transcript watcher out: it records prompts
 * without a transcript path, from a worker that may have inherited
 * QWEN_PROJECT_DIR from the Qwen hook that spawned it.
 */
export const isQwenCodeHookEvent = (
  transcriptPath: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): boolean => {
  if (!transcriptPath) return false;
  if (environment.QWEN_PROJECT_DIR) return true;
  return isQwenTranscriptPath(transcriptPath);
};

/**
 * The CLAUDE_CONFIG_DIR this Claude Code hook runs under ('' = the default
 * profile), for CLAUDE_MEM_OBSERVER_PROFILE=session. Only a Claude Code host
 * hook reports it: the transcript watcher records prompts from inside the
 * worker, whose own environment says nothing about the session (the reason
 * isQwenCodeHookEvent requires a transcript path), and Qwen or other hosts
 * have no Claude Code login to bill.
 */
export function hookClaudeConfigDir(
  input: NormalizedHookInput,
  platformSource: string,
  fromTranscriptWatcher: boolean,
  environment: NodeJS.ProcessEnv,
): { claudeConfigDir?: string } {
  if (fromTranscriptWatcher || platformSource !== 'claude' || !input.transcriptPath) return {};
  if (isQwenCodeHookEvent(input.transcriptPath, environment)) return {};
  return { claudeConfigDir: environment.CLAUDE_CONFIG_DIR?.trim() ?? '' };
}
