import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GpxParseError, parseGpx, serializeGpx } from "./index";

const loadFixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("parseGpx", () => {
  it("imports tracks, segments, metadata, elevation, times, and waypoints", () => {
    const document = parseGpx(loadFixture("multi-segment.gpx"), {
      filename: "fallback-name.gpx",
    });

    expect(document.name).toBe("River loop");
    expect(document.description).toBe("A short test ride");
    expect(document.source).toMatchObject({
      kind: "gpx",
      filename: "fallback-name.gpx",
      creator: "Fixture Creator",
    });
    expect(document.segments).toHaveLength(2);
    expect(document.segments[0]?.points[0]).toMatchObject({
      latitude: 40.7,
      longitude: -74.01,
      elevationMeters: 4.5,
      time: "2026-09-27T12:00:00Z",
    });
    expect(document.controlPoints.map((point) => point.kind)).toEqual([
      "start",
      "finish",
    ]);
    expect(document.waypoints[0]).toMatchObject({
      name: "Coffee",
      description: "Regroup here",
      elevationMeters: 8.2,
    });
  });

  it("imports a GPX route when no track is present", () => {
    const document = parseGpx(loadFixture("route-only.gpx"));

    expect(document.name).toBe("Three stops");
    expect(document.segments).toHaveLength(1);
    expect(document.segments[0]?.points).toHaveLength(3);
    expect(document.controlPoints.map((point) => point.kind)).toEqual([
      "start",
      "via",
      "finish",
    ]);
    expect(document.controlPoints[1]?.name).toBe("Bakery");
  });

  it("rejects malformed and empty GPX files", () => {
    expect(() => parseGpx("<gpx><trk>")) .toThrow(GpxParseError);
    expect(() => parseGpx("<gpx version=\"1.1\"></gpx>")) .toThrow(
      "does not contain a track or route",
    );
  });
});

describe("serializeGpx", () => {
  it("round-trips the standard route data through GPX", () => {
    const original = parseGpx(loadFixture("multi-segment.gpx"));
    const xml = serializeGpx(original);
    const roundTripped = parseGpx(xml);

    expect(xml).toContain('version="1.1"');
    expect(xml).toContain('creator="Ride Maker"');
    expect(roundTripped.name).toBe(original.name);
    expect(roundTripped.description).toBe(original.description);
    expect(roundTripped.segments.map((segment) => segment.points)).toEqual(
      original.segments.map((segment) => segment.points),
    );
    expect(roundTripped.waypoints).toMatchObject(
      original.waypoints.map(({ id: _, ...waypoint }) => waypoint),
    );
  });
});
