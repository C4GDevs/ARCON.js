import BaseError from './base-error';

interface CredentialErrorDetails {
  error: string;
}

export default class CredentialError extends BaseError {
  constructor(opts: CredentialErrorDetails) {
    super('An error occured while authenticating', opts);
    this.name = 'ArconCredentialError';
  }
}
