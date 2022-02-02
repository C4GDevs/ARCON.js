import crc32 from 'buffer-crc32';

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

    if (payload === null) {
      this._payload = null;
      return;
    }

    this._payload = payload instanceof Buffer ? payload : Buffer.from(payload);
  }

  public static from(data: Buffer): Packet {
    const checksum = data.subarray(2, 6);
    const type = data[7];
    const payload = data.subarray(8);

    if (checksum.compare(crc32(data.subarray(6)).reverse()) !== 0)
      throw new Error('Packet payload does not match checksum.');

    if (type === MessageTypes.LOGIN) return new Packet(type, null, payload);

    const sequence = payload[0];

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
    const payload = this._payload || Buffer.from([0x00, 0x00]);

    let checksumInput = Buffer.alloc(prefixSize);

    checksumInput.writeUInt8(0xff);
    checksumInput.writeUInt8(this._type, 1);

    if (this._sequence !== null) checksumInput.writeUInt8(this._sequence, 2);
    checksumInput = Buffer.concat([checksumInput, payload]);

    const checksum = crc32(checksumInput);

    const headerParts = [0x42, 0x45, ...checksum.reverse(), 0xff, this._type];
    if (this._sequence !== null) headerParts.push(this._sequence);

    const header = Buffer.from(headerParts);

    return Buffer.concat([header, payload]);
  }
}

export default Packet;
