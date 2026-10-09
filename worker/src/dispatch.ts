// Starts the GitHub "Poll positions" workflow through GitHub's API, from the Durable Object's alarm
// every 5 minutes (sky-state.ts).
//
// Why: OpenSky refuses Cloudflare's network (and AWS's, so Netlify too), but accepts GitHub's
// runners. GitHub's own `schedule:` trigger is best-effort and ran a */5 workflow only every
// 3.5-7 hours, whereas runs started through the API (workflow_dispatch) begin within seconds.
// The token is a fine-grained GitHub token limited to this repository, with Actions: read & write,
// stored as the Worker secret GITHUB_DISPATCH_TOKEN. Without it, this does nothing.

export const POLL_WORKFLOW = "poll.yml";

export interface DispatchEnv {
  GITHUB_DISPATCH_TOKEN?: string;
  /** owner/repo (wrangler.jsonc vars). */
  GITHUB_REPO?: string;
}

export type DispatchResult = "dispatched" | "not configured" | `failed: ${string}`;

export async function dispatchPoll(env: DispatchEnv, fetchFn: typeof fetch = (i, init) => fetch(i, init)): Promise<DispatchResult> {
  const token = env.GITHUB_DISPATCH_TOKEN?.trim();
  const repo = env.GITHUB_REPO?.trim();
  if (!token || !repo) return "not configured";
  try {
    const res = await fetchFn(`https://api.github.com/repos/${repo}/actions/workflows/${POLL_WORKFLOW}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "flightflux-api",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    });
    if (res.status === 204 || res.ok) return "dispatched";
    return `failed: ${res.status} ${(await res.text()).slice(0, 160)}`;
  } catch (e) {
    return `failed: ${(e as Error).message}`;
  }
}

