export class ServerMessageError extends Error {
  public readonly data: string;
  public readonly method: string;

  constructor(message: string, method: string, data: string) {
    super(message);
    this.name = 'ServerMessageError';
    this.data = data;
    this.method = method;
  }
}
