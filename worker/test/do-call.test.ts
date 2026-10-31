import { describe, expect, it } from "vitest";
import { callObject } from "../src/do-call";

const doError = (message: string, flags: { retryable?: boolean; overloaded?: boolean }) => Object.assign(new Error(message), flags);
const RESET = "Durable Object storage operation exceeded timeout which caused object to be reset.";

describe("callObject", () => {
  it("passes a successful answer straight through", async () => {
    const res = await callObject(async () => new Response("ok", { status: 200 }), () => {});
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("retries once when the object was reset, and returns the retry's answer", async () => {
    let calls = 0;
    const res = await callObject(async () => {
      if (calls++ === 0) throw doError(RESET, { retryable: true });
      return new Response("ok");
    }, () => {});
    expect(calls).toBe(2);
    expect(res.status).toBe(200);
  });

  it("answers 502 JSON, not a throw, when the retry fails too", async () => {
    let calls = 0;
    const res = await callObject(async () => {
      calls++;
      throw doError(RESET, { retryable: true });
    }, () => {});
    expect(calls).toBe(2);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: `durable object: ${RESET}`, retryable: true });
  });

  it("does not retry an overloaded object", async () => {
    let calls = 0;
    const res = await callObject(async () => {
      calls++;
      throw doError("Durable Object is overloaded.", { retryable: true, overloaded: true });
    }, () => {});
    expect(calls).toBe(1);
    expect(res.status).toBe(500);
  });

  it("does not retry an ordinary exception", async () => {
    let calls = 0;
    const res = await callObject(async () => {
      calls++;
      throw new TypeError("boom");
    }, () => {});
    expect(calls).toBe(1);
    expect(res.status).toBe(500);
  });
});
