import { describe, expect, it, vi } from "vitest";
import { ValhallaRoutingProvider } from "./valhalla";
import { RoutingError } from "./types";
import type { ControlPoint } from "@ride-maker/domain";

const CP1: ControlPoint = { id: "cp1", kind: "start", latitude: 40.785, longitude: -73.968 };
const CP2: ControlPoint = { id: "cp2", kind: "finish", latitude: 40.786, longitude: -73.967 };
const CP_VIA: ControlPoint = { id: "cp_via", kind: "via", latitude: 40.7855, longitude: -73.9675 };

// "A??A" decodes to: [{latitude: 0.000001, longitude: 0}, {latitude: 0.000001, longitude: 0.000001}]
const VALID_VALHALLA_RESPONSE = {
  trip: {
    summary: { length: 0.15, time: 30 },
    legs: [
      {
        shape: "A??A",
        maneuvers: [
          {
            begin_shape_index: 0,
            instruction: "Head east on Park Drive.",
            verbal_pre_transition_instruction: "Head east.",
          },
        ],
      },
    ],
  },
};

describe("ValhallaRoutingProvider", () => {
  it("routes successfully and parses legs, summary, and maneuvers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => VALID_VALHALLA_RESPONSE,
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new ValhallaRoutingProvider("http://mock-valhalla/route");
    const result = await provider.route({
      controlPoints: [CP1, CP2],
      profile: "road",
    });

    expect(result.distanceMeters).toBe(150);
    expect(result.durationSeconds).toBe(30);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toHaveLength(2);
    expect(result.maneuvers).toHaveLength(1);
    expect(result.maneuvers[0]?.instruction).toBe("Head east on Park Drive.");
    expect(result.maneuvers[0]?.shapeIndex).toBe(0);
    expect(result.maneuvers[0]?.segmentIndex).toBe(0);
  });

  it("handles multi-leg routes preserving distinct segments and maneuver indices per leg", async () => {
    const multiLegResponse = {
      trip: {
        summary: { length: 0.35, time: 70 },
        legs: [
          {
            shape: "A??A",
            maneuvers: [
              {
                begin_shape_index: 0,
                instruction: "Depart start point.",
              },
            ],
          },
          {
            shape: "A??A",
            maneuvers: [
              {
                begin_shape_index: 1,
                instruction: "Arrive at destination.",
              },
            ],
          },
        ],
      },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => multiLegResponse,
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new ValhallaRoutingProvider("http://mock-valhalla/route");
    const result = await provider.route({
      controlPoints: [CP1, CP_VIA, CP2],
      profile: "road",
    });

    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toHaveLength(2);
    expect(result.segments[1]).toHaveLength(2);
    expect(result.maneuvers).toHaveLength(2);
    expect(result.maneuvers[0]?.segmentIndex).toBe(0);
    expect(result.maneuvers[0]?.shapeIndex).toBe(0);
    expect(result.maneuvers[1]?.segmentIndex).toBe(1);
    expect(result.maneuvers[1]?.shapeIndex).toBe(1);
  });

  it("rejects fewer than 2 control points before fetch", async () => {
    const provider = new ValhallaRoutingProvider("http://mock-valhalla/route");
    await expect(
      provider.route({
        controlPoints: [CP1],
        profile: "road",
      }),
    ).rejects.toThrow(RoutingError);
  });

  it("rejects invalid/infinite coordinates", async () => {
    const provider = new ValhallaRoutingProvider("http://mock-valhalla/route");
    await expect(
      provider.route({
        controlPoints: [CP1, { id: "cp2", kind: "finish", latitude: 120, longitude: -73.967 }],
        profile: "road",
      }),
    ).rejects.toThrow(RoutingError);
  });

  it("handles cancelled AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort();

    const provider = new ValhallaRoutingProvider("http://mock-valhalla/route");
    await expect(
      provider.route({
        controlPoints: [CP1, CP2],
        profile: "road",
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelled/i);
  });

  it("rejects response with out-of-bounds begin_shape_index", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        trip: {
          summary: { length: 0.1, time: 20 },
          legs: [
            {
              shape: "A??A",
              maneuvers: [
                {
                  begin_shape_index: 99, // out of bounds (segment has length 2)
                  instruction: "Turn right.",
                },
              ],
            },
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new ValhallaRoutingProvider("http://mock-valhalla/route");
    await expect(
      provider.route({
        controlPoints: [CP1, CP2],
        profile: "road",
      }),
    ).rejects.toThrow(/out-of-bounds begin_shape_index/);
  });

  it("rejects non-200 error response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "No suitable edges near location" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new ValhallaRoutingProvider("http://mock-valhalla/route");
    await expect(
      provider.route({
        controlPoints: [CP1, CP2],
        profile: "road",
      }),
    ).rejects.toThrow("No suitable edges near location");
  });

  it("rejects malformed response with non-object trip or legs", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ trip: "not an object" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new ValhallaRoutingProvider("http://mock-valhalla/route");
    await expect(
      provider.route({
        controlPoints: [CP1, CP2],
        profile: "road",
      }),
    ).rejects.toThrow(/missing valid trip object/i);
  });

  it("rejects empty or non-string maneuver instructions", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        trip: {
          summary: { length: 0.1, time: 20 },
          legs: [
            {
              shape: "A??A",
              maneuvers: [
                {
                  begin_shape_index: 0,
                  instruction: "   ",
                },
              ],
            },
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new ValhallaRoutingProvider("http://mock-valhalla/route");
    await expect(
      provider.route({
        controlPoints: [CP1, CP2],
        profile: "road",
      }),
    ).rejects.toThrow(/empty instruction/i);
  });

  it("times out if response body parsing hangs", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("AbortError")), 200);
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new ValhallaRoutingProvider("http://mock-valhalla/route", { timeoutMs: 50 });
    await expect(
      provider.route({
        controlPoints: [CP1, CP2],
        profile: "road",
      }),
    ).rejects.toThrow(/timed out/i);
  });

  it("rejects malformed non-object response body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => null,
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new ValhallaRoutingProvider("http://mock-valhalla/route");
    await expect(
      provider.route({
        controlPoints: [CP1, CP2],
        profile: "road",
      }),
    ).rejects.toThrow(RoutingError);
  });
});
