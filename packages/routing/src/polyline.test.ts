import { describe, expect, it } from "vitest";
import { decodePolyline6 } from "./polyline";

describe("decodePolyline6", () => {
  it("decodes polyline6 coordinates and deltas", () => {
    const points = decodePolyline6("A??A");
    expect(points).toEqual([
      { latitude: 0.000001, longitude: 0 },
      { latitude: 0.000001, longitude: 0.000001 },
    ]);
  });

  it("rejects truncated geometry", () => {
    expect(() => decodePolyline6("s")).toThrow("Invalid route geometry");
  });
});
