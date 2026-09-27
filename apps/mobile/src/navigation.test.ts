import { describe, expect, it } from "vitest";
import { createRouteDocument } from "@ride-maker/domain";
import { buildNavigationTrack, navigationFix } from "./navigation";

const document = createRouteDocument();
document.segments = [{ id: "leg", points: [
  { latitude: 40, longitude: -74 },
  { latitude: 40, longitude: -73.999 },
  { latitude: 40.001, longitude: -73.999 },
] }];
document.maneuvers = [
  { id: "start", segmentIndex: 0, shapeIndex: 0, latitude: 40, longitude: -74, instruction: "Head east" },
  { id: "turn", segmentIndex: 0, shapeIndex: 1, latitude: 40, longitude: -73.999, instruction: "Turn left" },
  { id: "end", segmentIndex: 0, shapeIndex: 2, latitude: 40.001, longitude: -73.999, instruction: "Arrive" },
];

describe("navigation progression", () => {
  const track = buildNavigationTrack(document);
  if (!track) throw new Error("Test route has no track");

  it("finds the next turn and distance along the route", () => {
    const fix = navigationFix(track, { latitude: 40, longitude: -73.9995 });
    expect(fix.offRouteMeters).toBeLessThan(1);
    expect(fix.next?.maneuver.id).toBe("turn");
    expect(fix.distanceToNextMeters).toBeGreaterThan(40);
  });

  it("advances after passing the turn", () => {
    const fix = navigationFix(track, { latitude: 40.0002, longitude: -73.999 }, 90);
    expect(fix.next?.maneuver.id).toBe("end");
  });

  it("keeps the current turn visible until the rider passes it", () => {
    const fix = navigationFix(track, { latitude: 40, longitude: -73.99905 }, 70);
    expect(fix.next?.maneuver.id).toBe("turn");
  });

  it("detects an off-route fix", () => {
    expect(navigationFix(track, { latitude: 40.01, longitude: -74 }).offRouteMeters).toBeGreaterThan(500);
  });

  it("recognizes arrival", () => {
    expect(navigationFix(track, { latitude: 40.001, longitude: -73.999 }, track.lengthMeters - 30).arrived).toBe(true);
  });
});
