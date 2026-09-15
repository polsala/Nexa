/** Transactions own undo boundaries. Pointer movement is previewed outside this history. */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private lastKey = "";
  private lastTime = 0;
  constructor(
    public value: T,
    private limit = 100,
  ) {}
  transact(change: (draft: T) => void, key = ""): T {
    const now = Date.now();
    const draft = structuredClone(this.value);
    change(draft);
    if (!key || key !== this.lastKey || now - this.lastTime > 800) {
      this.past.push(this.value);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.value = draft;
    this.future = [];
    this.lastKey = key;
    this.lastTime = now;
    return this.value;
  }
  undo(): T {
    const previous = this.past.pop();
    if (previous) {
      this.future.push(this.value);
      this.value = previous;
    }
    this.lastKey = "";
    return this.value;
  }
  redo(): T {
    const next = this.future.pop();
    if (next) {
      this.past.push(this.value);
      this.value = next;
    }
    this.lastKey = "";
    return this.value;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
