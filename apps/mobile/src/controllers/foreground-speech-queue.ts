/** Serializes navigation announcements and lets lifecycle changes invalidate pending work. */
export class ForegroundSpeechQueue {
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly stop: () => Promise<void>,
    private readonly speak: (text: string) => void,
  ) {}

  invalidate(): void {
    this.generation += 1;
  }

  enqueue(text: string, isEnabled: () => boolean): void {
    const generation = this.generation;
    this.queue = this.queue.catch(() => {}).then(async () => {
      if (generation !== this.generation || !isEnabled()) return;
      await this.stop();
      if (generation !== this.generation || !isEnabled()) return;
      this.speak(text);
    });
  }
}
