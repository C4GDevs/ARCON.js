export default class ArconError extends Error {
  meta?: unknown;

  constructor(message: string, meta?: unknown) {
    super(message);
    this.meta = meta;
  }

  public toString() {
    return `ArconError: ${this.message}\n${this.meta ? JSON.stringify(this.meta, null, 2) : ''}\n${this.stack}`;
  }
}
