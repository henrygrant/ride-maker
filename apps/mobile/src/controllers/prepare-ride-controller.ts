import type { RouteDocument } from "@ride-maker/domain";
import { prepareGpxRoute, type PreparedRouteResult, type TraceMatchingProvider } from "@ride-maker/routing";
import { buildSourceIdentityToken, type LocalRouteRecord, type SavedLocalRoute, type SourceIdentityToken } from "../storage";

export type PreparationState =
  | { status: "idle" }
  | { status: "preparing"; routeId: string; allowSparseInference: boolean }
  | { status: "choice"; routeId: string; original: RouteDocument; message: string }
  | { status: "review"; routeId: string; result: PreparedRouteResult; original: RouteDocument; sourceToken: string }
  | { status: "saving"; routeId: string }
  | { status: "error"; routeId: string; message: string; retryable: boolean };

export interface PreparationStorage {
  getOriginalRoute(id: string): Promise<SavedLocalRoute>;
  acceptPreparation(params: { routeId: string; prepared: PreparedRouteResult; expectedSourceToken: SourceIdentityToken }): Promise<SavedLocalRoute>;
}

export type PrepareRideControllerOptions = {
  storage: PreparationStorage;
  provider: TraceMatchingProvider;
  getSelectedRoute: () => { id: string; sourceKind?: string; kind?: string } | null;
  onAccepted: (route: SavedLocalRoute) => void | Promise<void>;
};

/** Owns one cancellable preparation transaction and guards every async boundary. */
export class PrepareRideController {
  private state: PreparationState = { status: "idle" };
  private listeners = new Set<(state: PreparationState) => void>();
  private generation = 0;
  private abortController: AbortController | null = null;
  private busy = false;
  private lastAllowSparseInference = false;

  constructor(private readonly options: PrepareRideControllerOptions) {}

  getState(): PreparationState { return this.state; }
  canChangeSelection(): boolean { return this.state.status !== "saving"; }

  subscribe(listener: (state: PreparationState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private setState(state: PreparationState) {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  private isCurrent(generation: number, routeId: string): boolean {
    return generation === this.generation && this.options.getSelectedRoute()?.id === routeId;
  }

  async prepare(allowSparseInference = false): Promise<void> {
    if (this.busy) return;
    const selected = this.options.getSelectedRoute();
    if (!selected || selected.kind === "remote" || selected.sourceKind !== "imported") return;
    this.busy = true;
    this.lastAllowSparseInference = allowSparseInference;
    const generation = ++this.generation;
    const abort = new AbortController();
    this.abortController = abort;
    this.setState({ status: "preparing", routeId: selected.id, allowSparseInference });
    try {
      const saved = await this.options.storage.getOriginalRoute(selected.id);
      if (!this.isCurrent(generation, selected.id) || abort.signal.aborted) return;
      const original = saved.originalDocument ?? saved.document;
      const sourceToken = buildSourceIdentityToken(saved.record as LocalRouteRecord);
      const result = await prepareGpxRoute(original, this.options.provider, {
        signal: abort.signal,
        ...(allowSparseInference ? { allowSparseRouteInference: true } : {}),
      });
      if (!this.isCurrent(generation, selected.id) || abort.signal.aborted) return;
      if (result.metadata.status === "needs-choice") {
        this.setState({ status: "choice", routeId: selected.id, original,
          message: "This GPX has sparse planning points. Choose whether to infer cycling paths through those points." });
      } else if (result.metadata.status === "failed") {
        this.setState({ status: "error", routeId: selected.id,
          message: result.metadata.warnings[0]?.message ?? "Directions could not be prepared for this GPX.", retryable: true });
      } else {
        this.setState({ status: "review", routeId: selected.id, original, result, sourceToken });
      }
    } catch (cause) {
      if (!this.isCurrent(generation, selected.id) || abort.signal.aborted) return;
      this.setState({ status: "error", routeId: selected.id,
        message: cause instanceof Error ? cause.message : "Could not prepare directions.", retryable: true });
    } finally {
      if (generation === this.generation) {
        this.abortController = null;
        this.busy = false;
      }
    }
  }

  retry(): Promise<void> { return this.prepare(this.lastAllowSparseInference); }

  async accept(acceptPartial: boolean): Promise<void> {
    if (this.busy || this.state.status !== "review") return;
    const review = this.state;
    if (review.result.metadata.status === "partial" && !acceptPartial) return;
    if (review.result.metadata.status !== "ready" && review.result.metadata.status !== "partial") return;
    if (!this.isCurrent(this.generation, review.routeId)) return;
    this.busy = true;
    const generation = this.generation;
    this.setState({ status: "saving", routeId: review.routeId });
    try {
      const saved = await this.options.storage.acceptPreparation({
        routeId: review.routeId,
        prepared: review.result,
        expectedSourceToken: review.sourceToken,
      });
      if (!this.isCurrent(generation, review.routeId)) return;
      await this.options.onAccepted(saved);
      if (this.isCurrent(generation, review.routeId)) this.setState({ status: "idle" });
    } catch (cause) {
      if (this.isCurrent(generation, review.routeId)) {
        this.setState({ status: "error", routeId: review.routeId,
          message: cause instanceof Error ? cause.message : "Could not save prepared directions.", retryable: false });
      }
    } finally {
      if (generation === this.generation) this.busy = false;
    }
  }

  cancel(): void {
    if (this.state.status === "saving") return;
    ++this.generation;
    this.abortController?.abort();
    this.abortController = null;
    this.busy = false;
    this.setState({ status: "idle" });
  }

  selectionChanged(): void {
    if (this.state.status === "saving") return;
    if (this.state.status !== "idle") this.cancel();
  }
}
