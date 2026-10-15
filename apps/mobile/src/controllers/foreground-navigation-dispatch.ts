import { reduceNavigation, type NavigationConfig, type NavigationInput, type NavigationState, type PreparedNavigationRide } from "@ride-maker/navigation";

/** Preserves the engine's safe state on bounded-search failures and only clears recovery UI on a real fix. */
export function dispatchForegroundNavigation(
  ride: PreparedNavigationRide,
  state: NavigationState,
  input: NavigationInput,
  currentError: string | null,
  config?: NavigationConfig,
) {
  const result = reduceNavigation(ride, state, input, config);
  if (result.error?.code === "SEARCH_LIMIT") {
    return {
      state: result.state,
      error: "GPS matching is temporarily unavailable in this dense section. Guidance is paused while it recovers.",
      events: result.events,
      shouldAnnounce: false,
    };
  }
  if (result.error) {
    return { state, error: result.error.message, events: [], shouldAnnounce: false };
  }
  const locationRecovered = input.type === "location_fix";
  return {
    state: result.state,
    error: locationRecovered ? null : currentError,
    events: result.events,
    shouldAnnounce: currentError === null || locationRecovered,
  };
}
