import crc32 from 'buffer-crc32';
import PacketPart from './PacketPart';

export enum MessageTypes {
  LOGIN = 0x00,
  COMMAND = 0x01,
  SERVER_MESSAGE = 0x02
}

class Packet {
  private readonly _type: MessageTypes;
  private readonly _sequence: number | null;
  private readonly _payload: Buffer | null;

  constructor(type: MessageTypes, sequence: number | null = null, payload: string | Buffer | null = null) {
    this._type = type;
    this._sequence = sequence;

    this._payload = payload ? Buffer.from(payload) : null;
  }

  public static from(data: Buffer): Packet | PacketPart {
    const checksum = data.subarray(2, 6);
    const type = data[7];
    const payload = data.subarray(8);

    if (checksum.compare(crc32(data.subarray(6)).reverse()) !== 0)
      throw new Error('Packet payload does not match checksum.');

    if (type === MessageTypes.LOGIN) return new Packet(type, null, payload);

    const sequence = payload[0];

    if (payload[1] === 0x00) {
      const parts = payload[2];
      const index = payload[3];

      return new PacketPart(type, sequence, payload.subarray(4), parts, index);
    }

    return new Packet(type, sequence, payload.subarray(1));
  }

  public get payload(): Buffer | null {
    return this._payload;
  }

  public get sequence(): number | null {
    return this._sequence;
  }

  public get type(): MessageTypes {
    return this._type;
  }

  public toBuffer(): Buffer {
    const prefixSize = this._sequence !== null ? 3 : 2;

    let checksumInput = Buffer.alloc(prefixSize);

    checksumInput.writeUInt8(0xff);
    checksumInput.writeUInt8(this._type, 1);

    if (this._sequence !== null) checksumInput.writeUInt8(this._sequence, 2);
    checksumInput = this._payload ? Buffer.concat([checksumInput, this._payload]) : checksumInput;

    const checksum = crc32(checksumInput);

    const headerParts = [0x42, 0x45, ...checksum.reverse(), 0xff, this._type];
    if (this._sequence !== null) headerParts.push(this._sequence);

    const header = Buffer.from(headerParts);

    return this._payload ? Buffer.concat([header, this._payload]) : header;
  }
}

export default Packet;
