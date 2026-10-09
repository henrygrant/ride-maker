# Task 001: mobile workspace foundation

Assignee: Gemini Flash. Reviewer/integrator: Sol. Status: ready for implementation.
Read `docs/mobile-plan.md`, repository instructions, and the existing workspace
configuration before editing. Implement this task only; background navigation,
GPX matching, production deployment, and the visual redesign are later tasks.

## Outcome

An Expo development-build workspace at `apps/mobile` with two minimal screens:
an empty ride library and a native-map proof screen. Both use shared React Strict
DOM UI where appropriate. The map proof has a shared button that toggles a small
bundled fixture route overlay, demonstrating RSD/native-map interoperability.
Do not request GPS permission yet or implement a pretend navigation session.

## Scope

- Create `apps/mobile` package, TypeScript, Expo app, Babel/Metro configuration,
  Expo Router entry/screens, and MapLibre integration.
- Reuse `@ride-maker/ui`. Make the smallest native compatibility adjustment for
  shared font tokens or button behavior, using platform-specific files where
  necessary rather than changing the web app's appearance.
- Verify compatibility of Expo's React version with existing React/RSD pins.
  Use stable compatible releases and document the selected versions. Avoid two
  React runtimes within either app. If the existing pins prevent a safe setup,
  report the conflict to Sol before changing shared dependency versions.
- Update root workspace scripts/Turbo only as needed. Keep mobile native builds
  separate from the existing web/Docker build pipeline; inspect the production
  Dockerfile's workspace manifest copies before changing root dependencies.
- Document build/start commands and the need for a development build in
  `apps/mobile/README.md`. Device installation/signing is a separate field check.

Own `apps/mobile/**`, this task's completion notes, `package-lock.json`, and
minimal necessary changes to root config and `packages/ui/**`. A narrowly scoped
change to `deploy/web.Dockerfile` is allowed if needed to copy workspace manifests
or keep its build web-only; validate the image build without deploying it. Do not edit
server Compose, PocketBase migrations/auth, or routing/GPX semantics. Do not
write credentials or signing keys into tracked files. Do not touch unrelated
work; coordinate commits with Sol and follow applicable repository instructions.

## Verification

- Existing web type checks, tests, and production build still pass.
- Mobile type checks and Metro bundling pass with the selected dependencies.
- Build a native development binary if the available toolchain allows it;
  record a missing Android SDK, macOS/Xcode, signing account, or build-service
  login as a concrete blocker, not as a successful native build.
- Real-device acceptance (with owner assistance): both screens open, shared
  button responds, native map renders, and fixture overlay toggles. Do not claim
  this from a browser preview or simulator-only result.

Do not add tests that merely mirror static JSX. Keep useful validation focused
on workspace compatibility and real rendering. Use a map source permitted for
development; document that production/offline tile hosting is still pending.

## Return to Sol

Report changed files, exact versions and compatibility rationale, checks and
outcomes, any build/device blockers, and the next command the owner needs to
run. Update status to implemented-awaiting-review or blocked with evidence;
only Sol accepts the task. If stuck, hand back a focused explanation and logs
with credentials removed rather than expanding scope.
