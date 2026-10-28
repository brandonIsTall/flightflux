import { describe, expect, it } from "vitest";
import type { Flight } from "../../shared/types";
import { bySwing, rankBySwing } from "../src/lib/rank";

const flight = (id: string, depTempC: number, arrTempC: number) => ({ id, depTempC, arrTempC }) as Flight;

describe("rank", () => {
  it("sorts by the size of the change, warming or cooling", () => {
    const sorted = bySwing([flight("a", 10, 15), flight("b", 30, 2), flight("c", -5, 15)]);
    expect(sorted.map((f) => f.id)).toEqual(["b", "c", "a"]);
  });

  it("numbers only ranked flights, skipping searched ones", () => {
    const sorted = bySwing([flight("a", 0, 30), flight("s", 0, 25), flight("b", 0, 20)]);
    const ranks = rankBySwing(sorted, new Set(["a", "b"]));
    expect([...ranks]).toEqual([["a", 1], ["b", 2]]);
    expect(ranks.has("s")).toBe(false);
  });
});
