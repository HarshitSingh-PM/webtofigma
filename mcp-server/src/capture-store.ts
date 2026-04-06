/**
 * CaptureStore — In-memory store for recent captures.
 * Keeps the last N captures available for quick re-import.
 */

import type { CaptureResult } from './capture-service.js';

const MAX_CAPTURES = 50;

export class CaptureStore {
  private captures = new Map<string, CaptureResult>();
  private order: string[] = [];

  add(capture: CaptureResult): void {
    this.captures.set(capture.id, capture);
    this.order.push(capture.id);

    // Evict oldest captures
    while (this.order.length > MAX_CAPTURES) {
      const oldId = this.order.shift()!;
      this.captures.delete(oldId);
    }
  }

  get(id: string): CaptureResult | undefined {
    return this.captures.get(id);
  }

  list(): CaptureResult[] {
    return this.order
      .map((id) => this.captures.get(id)!)
      .filter(Boolean)
      .reverse(); // Most recent first
  }

  clear(): void {
    this.captures.clear();
    this.order = [];
  }
}
