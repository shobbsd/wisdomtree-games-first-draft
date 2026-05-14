export class RollingWindow {
  private readonly values: number[] = [];

  private readonly maxSamples: number;

  constructor(maxSamples = 200) {
    this.maxSamples = Math.max(1, Math.floor(maxSamples));
  }

  push(value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }

    this.values.push(value);

    if (this.values.length > this.maxSamples) {
      this.values.shift();
    }
  }

  get size(): number {
    return this.values.length;
  }

  percentile(percentile: number): number {
    if (this.values.length === 0) {
      return 0;
    }

    const sorted = [...this.values].sort((left, right) => left - right);
    const normalized = Math.min(100, Math.max(0, percentile));
    const rank = Math.ceil((normalized / 100) * sorted.length);
    const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));

    return sorted[index] ?? 0;
  }
}
