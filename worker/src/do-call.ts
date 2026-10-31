// Calling the SkyState Durable Object from the Worker entry, surviving a reset.
//
// Cloudflare occasionally resets a Durable Object mid-request, e.g. "Durable Object storage
// operation exceeded timeout which caused object to be reset" (seen once in ~2,000 poller runs,
// 2026-10-31 20:26 UTC). The stub then throws, and an uncaught throw in the Worker becomes
// Cloudflare's own HTML 500 page, which the poller treats as fatal. Cloudflare marks such errors
// `retryable`; the documented remedy is a fresh stub and one more try.

/** What a Durable Object stub throws: Cloudflare adds these flags to the Error. */
type DurableObjectError = Error & { retryable?: boolean; overloaded?: boolean };

/**
 * Run `call` (which must get a fresh stub each time), retrying once if the object was reset.
 * An object that is overloaded is not retried: more requests only make that worse. A failure that
 * remains is answered as JSON, never thrown: 502 when Cloudflare says a retry may succeed (the
 * poller retries gateway errors, and both poller calls are safe to repeat), 500 otherwise.
 */
export async function callObject(call: () => Promise<Response>, log: (line: string) => void = console.error): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (e) {
      const err = e as DurableObjectError;
      const retryable = err.retryable === true && err.overloaded !== true;
      if (retryable && attempt === 0) {
        log(`durable object failed, retrying: ${err.message}`);
        continue;
      }
      log(`durable object failed: ${err.message}`);
      return new Response(JSON.stringify({ error: `durable object: ${err.message}`, retryable }), {
        status: retryable ? 502 : 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
  }
}
