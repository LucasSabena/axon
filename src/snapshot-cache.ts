/** Read-through single flight. An invalidated flight never republishes old data. */
export class SnapshotCache<T> {
  private values = new Map<string, { at: number; value: T }>();
  private flights = new Map<string, Promise<T>>();
  private generation = 0;
  constructor(private ttlMs: number, private maxEntries = 64, private now = Date.now) {}
  clear() { this.generation++; this.values.clear(); this.flights.clear(); }
  get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.values.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return Promise.resolve(hit.value);
    const pending = this.flights.get(key);
    if (pending) return pending;
    const generation = this.generation;
    const flight = Promise.resolve().then(load).then(value => {
      if (this.generation === generation) {
        if (this.values.size >= this.maxEntries) this.values.delete(this.values.keys().next().value!);
        this.values.set(key, { at: this.now(), value });
      }
      return value;
    }).finally(() => { if (this.flights.get(key) === flight) this.flights.delete(key); });
    this.flights.set(key, flight);
    return flight;
  }
}
