export class RCONError extends Error {
  public meta?: unknown;

  constructor(message: string, meta?: unknown) {
    super(message);

    this.meta = meta;
  }
}
