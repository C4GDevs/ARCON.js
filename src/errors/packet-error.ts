import BaseError from './base-error';

interface PacketErrorDetails {
  error: string;
  packet: Buffer;
  parsedPacket: {
    prefix?: string;
    checksum?: string;
    type?: number;
    sequenceNumber?: number;
    data?: Buffer;
  } | null;
}

export default class PacketError extends BaseError {
  constructor(opts: PacketErrorDetails) {
    super('An error occured while parsing a packet', opts);
    this.name = 'ArconPacketError';
  }
}
