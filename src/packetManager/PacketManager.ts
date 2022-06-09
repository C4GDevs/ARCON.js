import crc32 from 'buffer-crc32';
import { MultiPartPacket, Packet, PacketTypes } from './Packet';

export default class PacketManager {
  private _packetParts: Map<number, MultiPartPacket[]>;

  constructor() {
    this._packetParts = new Map();
  }

  public buildPacket(buf: Buffer) {
    const checksum = buf.subarray(2, 6);
    const type = buf[7];
    const data = buf.subarray(8);

    if (this._validate(checksum, Buffer.from([0xff, type, ...data])) !== 0) {
      throw new Error('Invalid packet checksum');
    }

    const sequence = data[0];

    // Packet contains multiple parts
    if (data[1] === 0x00) {
      const length = data[2];
      const index = data[3];

      const packet = new MultiPartPacket(index, length, sequence, data.subarray(4));

      if (index === 0) {
        this._packetParts.set(sequence, [packet]);
        return packet;
      }

      const parts = this._packetParts.get(sequence);

      if (!parts || !parts.length) throw new Error('Could not find MultiPartPacket index');

      parts.push(packet);

      // Construct whole packet
      if (index === length - 1) {
        const message = parts.map((p) => p.data).join('');

        this._packetParts.delete(sequence);

        return new Packet(PacketTypes.COMMAND, sequence, message);
      }

      return packet;
    }

    return new Packet(type, sequence, data);
  }

  private _validate(checksum: Buffer, data: Buffer) {
    return checksum.compare(crc32(data).reverse());
  }
}
