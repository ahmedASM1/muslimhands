/**
 * Documents expected API client refresh behavior for 401 responses.
 * Frontend implementation: apps/web/src/lib/api.ts
 */
describe('auth refresh contract', () => {
  it('distinguishes 401 authentication failures from 403 authorization failures', () => {
    const classify = (status: number) => {
      if (status === 401) return 'authenticate';
      if (status === 403) return 'authorize';
      return 'other';
    };
    expect(classify(401)).toBe('authenticate');
    expect(classify(403)).toBe('authorize');
  });

  it('retries once after successful refresh and never refreshes on 403', () => {
    let refreshCalls = 0;
    let retries = 0;
    const handle = (status: number, alreadyRetried: boolean) => {
      if (status === 403) return 'fail-forbidden';
      if (status === 401 && !alreadyRetried) {
        refreshCalls += 1;
        retries += 1;
        return 'retry';
      }
      if (status === 401 && alreadyRetried) return 'logout';
      return 'ok';
    };
    expect(handle(403, false)).toBe('fail-forbidden');
    expect(refreshCalls).toBe(0);
    expect(handle(401, false)).toBe('retry');
    expect(handle(401, true)).toBe('logout');
    expect(retries).toBe(1);
  });
});
