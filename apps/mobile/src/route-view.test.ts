import { describe, expect, it } from "vitest";
import { createRouteDocument } from "@ride-maker/domain";
import { routeGeometry, routeIdFromLink } from "./route-view";

const id = "abc123def456ghi";

describe("routeIdFromLink", () => {
  it("accepts a route ID, web link, and app link", () => {
    expect(routeIdFromLink(id)).toBe(id);
    expect(routeIdFromLink(`https://ridemaker.thg3.net/?route=${id}`)).toBe(id);
    expect(routeIdFromLink(`ridemaker://route/${id}`)).toBe(id);
  });

  it("rejects unrelated links", () => {
    expect(routeIdFromLink(`https://example.com/?route=${id}`)).toBeNull();
  });
});

it("creates a map shape and bounds from route segments", () => {
  const document = createRouteDocument();
  document.segments = [{ id: "segment", points: [
    { longitude: -74, latitude: 40 }, { longitude: -73, latitude: 41 },
  ] }];
  expect(routeGeometry(document).bounds).toEqual([-74, 40, -73, 41]);
  expect(routeGeometry(document).shape.geometry.coordinates).toEqual([[[-74, 40], [-73, 41]]]);
});
