/**
 * The tracker has no accounts of its own. A request is allowed when it
 * carries a session token that the Actual server itself accepts, so anyone
 * who can't log in to Actual can't see or change the mortgage data either.
 */

export type TokenValidator = (token: string) => Promise<boolean>;

const CACHE_MS = 5 * 60_000;

export function actualTokenValidator(serverURL: string, fetchImpl: typeof fetch = fetch): TokenValidator {
  const cache = new Map<string, number>();
  return async (token) => {
    const now = Date.now();
    const until = cache.get(token);
    if (until && until > now) return true;
    try {
      const res = await fetchImpl(`${serverURL}/account/validate`, {
        headers: { 'x-actual-token': token },
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json().catch(() => null)) as { status?: string; data?: { validated?: boolean } } | null;
      const ok = res.ok && body?.status === 'ok' && body.data?.validated !== false;
      if (ok) cache.set(token, now + CACHE_MS);
      else cache.delete(token);
      return ok;
    } catch (err) {
      console.warn('[auth] could not reach Actual to validate a session:', (err as Error).message);
      return false;
    }
  };
}
