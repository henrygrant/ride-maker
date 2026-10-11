# Task 002: mobile E2E testing foundation

Status: ready for implementation; not installed or accepted.
Implementer: Gemini. Reviewer/integrator: Sol.

Read [the testing strategy](../mobile-testing.md), [the mobile plan](../mobile-plan.md),
repository instructions, and existing mobile code before editing.

## Outcome and scope

Provide a repeatable local Mac command that builds/installs Ride Maker on a
dedicated Android emulator, runs a Maestro startup smoke flow, and saves
reviewable evidence. Enable Gemini to inspect and interact with the test app.
Preserve the existing Samsung dev installation and production deployment.

Own `apps/mobile/e2e/**`, `scripts/mobile-e2e/**`, the corresponding documentation,
a narrow artifact ignore rule, and minimal mobile selectors/build configuration.
Do not implement GPX import, change navigation algorithms/schemas, replace the
Expo workspace, or require a paid build/test service. Introduce package scripts
only when they invoke implemented commands.

## Deliverables

- Install and verify Maestro on the Mac; record its exact version. Create an
  Android AVD using a compatible installed/available image; record API, ABI,
  device profile and reproducible provisioning commands.
- Verify Maestro MCP tool discovery in the actual Gemini provider. Demonstrate
  hierarchy inspection, screenshot, tap and state assertion. If unavailable,
  document the exact blocker and provide the Mac SSH/CLI path; report MCP access
  as pending, not complete. Do not assume Gemini CLI config affects Antigravity.
- Add stable IDs to startup controls/status. Commit one smoke flow asserting
  the main screen and opening/closing Diagnostics without starting GPS tracking.
  Avoid live production route/backend availability in this flow.
- Provide a runner that accepts an explicit emulator serial, checks toolchain
  and exclusive device access, builds/installs, executes the flow, captures
  evidence, cleans up owned resources, and exits nonzero on failure. Refuse
  destructive reset operations on an unspecified or personal physical device.
- Verify the flow against a standalone APK with bundled JS and Metro stopped.
  Record the exact local command/build variant; a development APK requiring
  Metro is not a standalone result. Test controls must not activate in the
  consumer production variant.
- Save commit/build/fixture/device manifest, Maestro output, screenshots and
  app-scoped logs under ignored `.artifacts/mobile-e2e/<run-id>/`. No private GPS,
  tokens, production account writes, or generated reports in Git.
- Document setup, normal execution, clean emulator reset, artifact locations,
  device selection, Metro/build troubleshooting and remaining limitations.

## Acceptance and return

Run the smoke flow three times from defined fresh emulator states. Assert actual
UI outcomes; retain evidence for each run. Deliberately break one assertion and
prove the runner fails with useful artifacts, then restore the correct assertion.
A repeatable flow must run from CLI without interactive agent decisions.

Run the relevant existing mobile typecheck/tests when code changes. Report exact
files/versions/commands, each run's outcome and artifacts, the standalone result,
Gemini inspection result, and unresolved blockers. Sol checks selectors,
assertions, isolation, runner failures and evidence before accepting the task.
GPX, replay, offline-map and field gates remain separate future work.
