import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoutingError } from "../types";
import { createSyntheticValhallaResponse } from "./fixtures";
import { ValhallaTraceMatchingProvider } from "./valhalla-trace-adapter";

describe("ValhallaTraceMatchingProvider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("POSTs trace to /trace_route with bicycle map_snap and decodes clean response", async () => {
    const inputPoints = [
      { latitude: 45.501, longitude: -73.567, time: "2026-10-14T20:00:00Z" },
      { latitude: 45.502, longitude: -73.567 },
      { latitude: 45.503, longitude: -73.567 },
    ];

    const mockResponse = createSyntheticValhallaResponse(inputPoints, {
      distanceKm: 0.25,
      durationSec: 60,
      maneuvers: [
        { begin_shape_index: 0, instruction: "Head north on Rue Peel", verbal: "Head north on Peel Street" },
      ],
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock;

    const provider = new ValhallaTraceMatchingProvider("https://test.valhalla/trace_route");
    const result = await provider.matchTrace({
      points: inputPoints,
      profile: "road",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [callUrl, callOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(callUrl).toBe("https://test.valhalla/trace_route");
    expect(callOptions.method).toBe("POST");

    const parsedBody = JSON.parse(callOptions.body as string);
    expect(parsedBody.shape_match).toBe("map_snap");
    expect(parsedBody.costing).toBe("bicycle");
    expect(parsedBody.costing_options.bicycle.bicycle_type).toBe("road");
    expect(parsedBody.shape).toHaveLength(3);
    expect(parsedBody.shape[0].time).toBe(Math.round(new Date("2026-10-14T20:00:00Z").getTime() / 1000));

    expect(result.matchedSegments).toHaveLength(1);
    expect(result.matchedSegments[0]!.points).toHaveLength(3);
    expect(result.matchedSegments[0]!.distanceMeters).toBe(250);
    expect(result.matchedSegments[0]!.durationSeconds).toBe(60);
    expect(result.matchedSegments[0]!.maneuvers).toHaveLength(1);
    expect(result.matchedSegments[0]!.maneuvers[0]!.instruction).toBe("Head north on Rue Peel");
    expect(result.matchedSegments[0]!.maneuvers[0]!.verbalInstruction).toBe("Head north on Peel Street");
    expect(result.matchedSegments[0]!.maneuvers[0]!.id).toBe("maneuver-0-0");
    expect(result.discontinuities).toHaveLength(0);
  });

  it("handles Valhalla alternates returned on trace discontinuities", async () => {
    const part1 = [
      { latitude: 45.501, longitude: -73.567 },
      { latitude: 45.502, longitude: -73.567 },
    ];
    const part2 = [
      { latitude: 45.506, longitude: -73.565 },
      { latitude: 45.507, longitude: -73.565 },
    ];

    const mockResponse = createSyntheticValhallaResponse(part1, {
      distanceKm: 0.12,
      durationSec: 30,
      alternates: [
        {
          points: part2,
          distanceKm: 0.15,
          durationSec: 35,
          maneuvers: [{ begin_shape_index: 0, instruction: "Continue on Rue Sherbrooke" }],
        },
      ],
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const provider = new ValhallaTraceMatchingProvider();
    const result = await provider.matchTrace({
      points: [...part1, ...part2],
      profile: "gravel",
    });

    expect(result.matchedSegments).toHaveLength(2);
    expect(result.matchedSegments[0]!.points).toHaveLength(2);
    expect(result.matchedSegments[1]!.points).toHaveLength(2);
    expect(result.discontinuities).toHaveLength(1);
    expect(result.discontinuities[0]!.fromMatchedIndex).toBe(0);
    expect(result.discontinuities[0]!.toMatchedIndex).toBe(1);
    expect(result.discontinuities[0]!.reason).toContain("alternate");
  });

  it("accurately calculates discontinuity segment offsets when trips have multiple legs", async () => {
    const leg1 = [{ latitude: 45.501, longitude: -73.567 }, { latitude: 45.502, longitude: -73.567 }];
    const leg2 = [{ latitude: 45.502, longitude: -73.567 }, { latitude: 45.503, longitude: -73.567 }];
    const leg3 = [{ latitude: 45.510, longitude: -73.560 }, { latitude: 45.511, longitude: -73.560 }];

    const { encodePolyline6 } = await import("../polyline");
    const mockMultiLegResponse = {
      trip: {
        status: 0,
        summary: { length: 0.25, time: 60 },
        legs: [
          { shape: encodePolyline6(leg1), summary: { length: 0.12, time: 30 }, maneuvers: [] },
          { shape: encodePolyline6(leg2), summary: { length: 0.13, time: 30 }, maneuvers: [] },
        ],
      },
      alternates: [
        {
          trip: {
            status: 0,
            summary: { length: 0.15, time: 35 },
            legs: [
              { shape: encodePolyline6(leg3), summary: { length: 0.15, time: 35 }, maneuvers: [] },
            ],
          },
        },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockMultiLegResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const provider = new ValhallaTraceMatchingProvider();
    const result = await provider.matchTrace({
      points: [...leg1, ...leg2, ...leg3],
      profile: "road",
    });

    expect(result.matchedSegments).toHaveLength(3);
    // Discontinuity must point from segment offset 1 (last leg of trip 0) to segment offset 2
    expect(result.discontinuities[0]!.fromMatchedIndex).toBe(1);
    expect(result.discontinuities[0]!.toMatchedIndex).toBe(2);
  });

  it("throws RoutingError when input coordinates are invalid or out of bounds", async () => {
    const provider = new ValhallaTraceMatchingProvider();

    await expect(
      provider.matchTrace({
        points: [{ latitude: 120, longitude: -73.567 }, { latitude: 45.502, longitude: -73.567 }],
        profile: "road",
      }),
    ).rejects.toThrow(RoutingError);

    await expect(
      provider.matchTrace({
        points: [{ latitude: 45.501, longitude: -73.567 }],
        profile: "road",
      }),
    ).rejects.toThrow(RoutingError);
  });

  it("throws RoutingError on network failure or HTTP 500 error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Valhalla internal error", error_code: 500 }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const provider = new ValhallaTraceMatchingProvider();
    await expect(
      provider.matchTrace({
        points: [{ latitude: 45.501, longitude: -73.567 }, { latitude: 45.502, longitude: -73.567 }],
        profile: "road",
      }),
    ).rejects.toThrow(RoutingError);
  });

  it("throws RoutingError on malformed JSON response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("<html>502 Bad Gateway</html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const provider = new ValhallaTraceMatchingProvider();
    await expect(
      provider.matchTrace({
        points: [{ latitude: 45.501, longitude: -73.567 }, { latitude: 45.502, longitude: -73.567 }],
        profile: "road",
      }),
    ).rejects.toThrow(RoutingError);
  });

  it("throws RoutingError on request cancellation via AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort();

    const provider = new ValhallaTraceMatchingProvider();
    await expect(
      provider.matchTrace({
        points: [{ latitude: 45.501, longitude: -73.567 }, { latitude: 45.502, longitude: -73.567 }],
        profile: "road",
        signal: controller.signal,
      }),
    ).rejects.toThrow("Trace matching request was cancelled.");
  });

  it("throws RoutingError when maneuver index is out of bounds", async () => {
    const pts = [{ latitude: 45.501, longitude: -73.567 }, { latitude: 45.502, longitude: -73.567 }];
    const badManeuverResponse = createSyntheticValhallaResponse(pts, {
      maneuvers: [{ begin_shape_index: 99, instruction: "Impossible turn" }],
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(badManeuverResponse), { status: 200 }),
    );

    const provider = new ValhallaTraceMatchingProvider();
    await expect(
      provider.matchTrace({ points: pts, profile: "road" }),
    ).rejects.toThrow("invalid begin_shape_index");
  });

  it("throws RoutingError when summary has missing or negative length/time", async () => {
    const pts = [{ latitude: 45.501, longitude: -73.567 }, { latitude: 45.502, longitude: -73.567 }];
    const badSummaryResponse = {
      trip: {
        status: 0,
        summary: { length: -5, time: 20 },
        legs: [
          {
            shape: "_p~iF~ps|U_ulLnnqC",
            summary: { length: 0.1, time: 10 },
            maneuvers: [],
          },
        ],
      },
    };

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(badSummaryResponse), { status: 200 }),
    );

    const provider = new ValhallaTraceMatchingProvider();
    await expect(
      provider.matchTrace({ points: pts, profile: "road" }),
    ).rejects.toThrow(RoutingError);
  });
});
