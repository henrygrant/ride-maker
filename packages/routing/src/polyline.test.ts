import { describe, expect, it } from "vitest";
import { decodePolyline6, encodePolyline6 } from "./polyline";

describe("decodePolyline6 and encodePolyline6", () => {
  it("decodes polyline6 coordinates and deltas", () => {
    const points = decodePolyline6("A??A");
    expect(points).toEqual([
      { latitude: 0.000001, longitude: 0 },
      { latitude: 0.000001, longitude: 0.000001 },
    ]);
  });

  it("encodes points and round-trips correctly", () => {
    const original = [
      { latitude: 40.785123, longitude: -73.968456 },
      { latitude: 40.786234, longitude: -73.967345 },
      { latitude: 40.787345, longitude: -73.966234 },
    ];
    const encoded = encodePolyline6(original);
    const decoded = decodePolyline6(encoded);
    expect(decoded).toEqual(original);
  });

  it("rejects truncated geometry", () => {
    expect(() => decodePolyline6("s")).toThrow("Invalid route geometry");
  });
});
