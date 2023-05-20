export default abstract class BaseError extends Error {
  public details?: unknown;

  constructor(message: string, opts?: unknown) {
    super(message);
    this.name = 'ArconBaseError';
    this.details = opts;
  }
}
