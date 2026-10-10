import { DiagnosticCue } from "./types";

export const DIAGNOSTIC_CUE_SCHEDULE: DiagnosticCue[] = [
  {
    id: "diag-start",
    triggerElapsedSeconds: 0,
    instruction: "Ride Maker diagnostic test started. Location tracking active.",
  },
  {
    id: "diag-30s",
    triggerElapsedSeconds: 30,
    instruction: "Diagnostic cue: thirty seconds elapsed. Screen lock check.",
  },
  {
    id: "diag-1m",
    triggerElapsedSeconds: 60,
    instruction: "Diagnostic cue: one minute elapsed. Tracking in progress.",
  },
  {
    id: "diag-2m",
    triggerElapsedSeconds: 120,
    instruction: "Diagnostic cue: two minutes elapsed.",
  },
  {
    id: "diag-5m",
    triggerElapsedSeconds: 300,
    instruction: "Diagnostic cue: five minutes elapsed.",
  },
  {
    id: "diag-10m",
    triggerElapsedSeconds: 600,
    instruction: "Diagnostic cue: ten minutes elapsed. Halfway mark.",
  },
  {
    id: "diag-15m",
    triggerElapsedSeconds: 900,
    instruction: "Diagnostic cue: fifteen minutes elapsed.",
  },
  {
    id: "diag-20m",
    triggerElapsedSeconds: 1200,
    instruction: "Diagnostic cue: twenty minutes elapsed. Test period complete.",
  },
];

/**
 * Returns the earliest scheduled cue that has not yet been spoken and whose
 * trigger elapsed time has been reached or passed.
 */
export function getNextDueCue(
  schedule: DiagnosticCue[],
  elapsedSeconds: number,
  spokenCueIds: string[]
): DiagnosticCue | null {
  const spokenSet = new Set(spokenCueIds);
  const eligible = schedule
    .filter((cue) => !spokenSet.has(cue.id) && cue.triggerElapsedSeconds <= elapsedSeconds)
    .sort((a, b) => a.triggerElapsedSeconds - b.triggerElapsedSeconds);

  return eligible[0] ?? null;
}
