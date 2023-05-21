import BaseError from './base-error';

interface ConnectionErrorDetails {
  error: string;
}

export default class ConnectionError extends BaseError {
  constructor(opts: ConnectionErrorDetails) {
    super('A connection error occured', opts);
    this.name = 'ArconConnectionError';
  }
}
