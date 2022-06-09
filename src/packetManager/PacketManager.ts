import crc32 from 'buffer-crc32';
import { MultiPartPacket } from './Packet';

export default class PacketManager {
  private packetParts: Map<number, MultiPartPacket[]>;

  constructor() {
    this.packetParts = new Map();
  }

  public buildPacket(buf: Buffer) {
    const checksum = buf.subarray(2, 6);
    const type = buf[7];
    const data = buf.subarray(8);

    if (!this._validate(checksum, Buffer.from([type, ...data]))) {
      return;
    }

    return;
  }

  private _validate(checksum: Buffer, data: Buffer) {
    return checksum.compare(crc32(data.reverse()));
  }
}
