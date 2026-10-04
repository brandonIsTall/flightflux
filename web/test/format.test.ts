import { describe, expect, it } from "vitest";
import { formatAltitude, formatDelta, formatDuration, formatLocalTime, formatSpeed, formatTemp } from "../src/lib/format";

describe("format", () => {
  it("temperatures follow the unit toggle", () => {
    expect(formatTemp(20, "C")).toBe("20°");
    expect(formatTemp(20, "F")).toBe("68°");
    expect(formatTemp(20.26, "C", 1)).toBe("20.3°");
  });

  it("deltas carry a real minus sign and a zero case", () => {
    expect(formatDelta(12, "C")).toBe("+12°");
    expect(formatDelta(-3, "C")).toBe("−3°");
    expect(formatDelta(0.2, "C")).toBe("±0°");
    expect(formatDelta(10, "F")).toBe("+18°"); // a change scales by 9/5 with no offset
  });

  it("altitude and speed pair metric with C and imperial with F", () => {
    expect(formatAltitude(10668, "C")).toBe("10,668 m");
    expect(formatAltitude(10668, "F")).toBe("35,000 ft");
    expect(formatSpeed(250, "C")).toBe("900 km/h");
    expect(formatSpeed(250, "F")).toBe("559 mph");
  });

  it("local time uses the zone when given and the UTC offset otherwise", () => {
    const t = Date.UTC(2026, 9, 4, 12, 30) / 1000;
    expect(formatLocalTime(t, "Asia/Tokyo")).toBe("21:30");
    expect(formatLocalTime(t, undefined, -5 * 3600)).toBe("07:30");
    expect(formatLocalTime(t, "Not/AZone", 3600)).toBe("13:30");
  });

  it("durations", () => {
    expect(formatDuration(45 * 60)).toBe("45 min");
    expect(formatDuration(3 * 3600 + 5 * 60)).toBe("3 h 05 min");
  });
});
