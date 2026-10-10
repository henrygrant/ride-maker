import { describe, expect, it } from "vitest";
import { DIAGNOSTIC_CUE_SCHEDULE, getNextDueCue } from "./cue-schedule";

describe("cue-schedule", () => {
  it("has a full 20-minute schedule covering key checkpoints", () => {
    expect(DIAGNOSTIC_CUE_SCHEDULE.length).toBeGreaterThanOrEqual(7);
    expect(DIAGNOSTIC_CUE_SCHEDULE[0]?.triggerElapsedSeconds).toBe(0);
    const lastCue = DIAGNOSTIC_CUE_SCHEDULE[DIAGNOSTIC_CUE_SCHEDULE.length - 1];
    expect(lastCue?.triggerElapsedSeconds).toBe(1200); // 20 minutes
  });

  it("selects the 0s start cue initially", () => {
    const cue = getNextDueCue(DIAGNOSTIC_CUE_SCHEDULE, 0, []);
    expect(cue).not.toBeNull();
    expect(cue?.id).toBe("diag-start");
    expect(cue?.instruction).toContain("Ride Maker diagnostic test started");
  });

  it("does not select already spoken cues", () => {
    const cue = getNextDueCue(DIAGNOSTIC_CUE_SCHEDULE, 15, ["diag-start"]);
    expect(cue).toBeNull(); // Next cue is at 30s
  });

  it("triggers 30s cue when elapsed time reaches 30s", () => {
    const cue = getNextDueCue(DIAGNOSTIC_CUE_SCHEDULE, 35, ["diag-start"]);
    expect(cue).not.toBeNull();
    expect(cue?.id).toBe("diag-30s");
  });

  it("selects the earliest pending cue if multiple are eligible", () => {
    // If phone was asleep and woke up at 70s having only spoken diag-start:
    // eligible are diag-30s (30) and diag-1m (60). It should pick diag-30s first.
    const cue = getNextDueCue(DIAGNOSTIC_CUE_SCHEDULE, 70, ["diag-start"]);
    expect(cue).not.toBeNull();
    expect(cue?.id).toBe("diag-30s");
  });

  it("returns null once all cues in the schedule have been spoken", () => {
    const allIds = DIAGNOSTIC_CUE_SCHEDULE.map((c) => c.id);
    const cue = getNextDueCue(DIAGNOSTIC_CUE_SCHEDULE, 1500, allIds);
    expect(cue).toBeNull();
  });
});
