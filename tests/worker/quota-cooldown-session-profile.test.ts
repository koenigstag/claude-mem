// CLAUDE_MEM_OBSERVER_PROFILE=session runs sessions of several Claude accounts
// side by side. A breaker belongs to the account that armed it: a session of
// another account is admitted without dropping it, so the first account's own
// sessions stay held.
import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import {
  cooldownAppliesToCurrentAccount,
  getQuotaCooldown,
  isQuotaCooldownActive,
  recordQuotaExhausted,
  resetQuotaCooldownsForTesting,
  setClaudeProfileResolverForTesting,
  tryAdmitQuotaProbe,
} from '../../src/shared/quota-cooldown.js';
import { resetDependencyStatusesForTesting } from '../../src/shared/dependency-health.js';

describe('quota cooldown breaker — a session on its own Claude account', () => {
  beforeEach(() => {
    resetQuotaCooldownsForTesting();
    resetDependencyStatusesForTesting();
    setClaudeProfileResolverForTesting(() => 'worker');
  });

  afterAll(() => {
    resetQuotaCooldownsForTesting();
    setClaudeProfileResolverForTesting(null);
  });

  it("admits another account's session and keeps the breaker armed", () => {
    recordQuotaExhausted('claude', 'Weekly limit reached', 'seven_day', undefined, 'account-a');

    expect(tryAdmitQuotaProbe('claude', Date.now(), 'account-b')).toEqual({ admitted: true, claimId: null });
    expect(getQuotaCooldown('claude')?.profile).toBe('account-a');
    expect(tryAdmitQuotaProbe('claude', Date.now(), 'account-a')).toEqual({ admitted: false, claimId: null });
  });

  it("answers for the session's account, not the worker's", () => {
    recordQuotaExhausted('claude', 'Weekly limit reached', 'seven_day', undefined, 'account-a');
    const cooldown = getQuotaCooldown('claude')!;

    expect(cooldownAppliesToCurrentAccount(cooldown)).toBe(false);
    expect(cooldownAppliesToCurrentAccount(cooldown, 'account-a')).toBe(true);
    expect(isQuotaCooldownActive('claude', Date.now(), undefined, 'account-a')).toBe(true);
    expect(isQuotaCooldownActive('claude', Date.now(), undefined, 'account-b')).toBe(false);
  });

  it('still drops a breaker of another account for the worker-profile path', () => {
    recordQuotaExhausted('claude', 'Weekly limit reached', 'seven_day', undefined, 'account-a');

    expect(tryAdmitQuotaProbe('claude')).toEqual({ admitted: true, claimId: null });
    expect(getQuotaCooldown('claude')).toBeNull();
  });
});
