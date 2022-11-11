import crc32 from 'buffer-crc32';
import { MultiPartPacket, Packet, PacketTypes } from './Packet';

export default class PacketManager {
  private _packetParts: Map<number, MultiPartPacket[]>;
  private _sequence = -1;

  constructor() {
    this._packetParts = new Map();
  }

  public buildBuffer(type: PacketTypes, data?: string) {
    const checksumInput = [0xff, type];

    const isLoginPacket = type === PacketTypes.LOGIN;

    if (!isLoginPacket) checksumInput.push(this._getNextSequence());
    if (data) checksumInput.push(...Buffer.from(data));

    const checksum = crc32(Buffer.from(checksumInput));

    const header = [0x42, 0x45, ...checksum.reverse(), 0xff, type];
    if (!isLoginPacket) header.push(checksumInput[2]);

    const bufferHeader = Buffer.from(header);

    return data ? Buffer.concat([bufferHeader, Buffer.from(data)]) : bufferHeader;
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

      if (!this._packetParts.has(sequence)) this._packetParts.set(sequence, new Array(length));

      const parts = this._packetParts.get(sequence);

      if (!parts) throw new Error('Could not find MultiPartPacket');

      parts[index] = packet;

      // Construct whole packet
      if (index === length - 1) {
        const message = parts.map((p) => p.data).join('');

        this._packetParts.delete(sequence);

        return new Packet(PacketTypes.COMMAND, sequence, message);
      }

      return packet;
    }

    if (type === PacketTypes.LOGIN) return new Packet(type, null, data);

    return new Packet(type, sequence, data.subarray(1));
  }

  public buildResponseBuffer(sequence: number) {
    const checksumInput = [0xff, PacketTypes.SERVER_MESSAGE, sequence];

    const checksum = crc32(Buffer.from(checksumInput));

    const header = [0x42, 0x45, ...checksum.reverse(), 0xff, PacketTypes.SERVER_MESSAGE, sequence];

    return Buffer.from(header);
  }

  public reset() {
    this._sequence = -1;
    this._packetParts.clear();
  }

  private _getNextSequence() {
    return ++this._sequence % 256;
  }

  private _validate(checksum: Buffer, data: Buffer) {
    return checksum.compare(crc32(data).reverse());
  }
}
