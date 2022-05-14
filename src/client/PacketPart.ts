import crc32 from 'buffer-crc32';
import { MessageTypes } from './Packet';

class PacketPart {
  private readonly _parts: number;
  private readonly _index: number;
  private readonly _type: MessageTypes;
  private readonly _sequence: number;
  private readonly _payload: Buffer;

  constructor(type: MessageTypes, sequence: number, payload: Buffer, parts: number, index: number) {
    this._type = type;
    this._sequence = sequence;
    this._payload = payload;
    this._parts = parts;
    this._index = index;
  }

  public get payload(): Buffer {
    return this._payload;
  }

  public get sequence(): number {
    return this._sequence;
  }

  public get type(): MessageTypes {
    return this._type;
  }

  public get parts(): number {
    return this._parts;
  }

  public get index(): number {
    return this._index;
  }

  public toBuffer(): Buffer {
    let checksumInput = Buffer.alloc(3);

    checksumInput.writeUInt8(0xff);
    checksumInput.writeUInt8(this._type, 1);

    checksumInput.writeUInt8(this._sequence, 2);
    checksumInput = Buffer.concat([checksumInput, this._payload]);

    const checksum = crc32(checksumInput);

    const headerParts = [0x42, 0x45, ...checksum.reverse(), 0xff, this._type, this._sequence, this._parts, this._index];

    const header = Buffer.from(headerParts);

    return Buffer.concat([header, this._payload]);
  }
}

export = PacketPart;
