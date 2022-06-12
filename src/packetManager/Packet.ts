export enum PacketTypes {
  LOGIN = 0x00,
  COMMAND = 0x01,
  SERVER_MESSAGE = 0x02
}

export class Packet {
  public readonly type: PacketTypes;
  public readonly sequence: number | null;
  public readonly data: string | null;

  constructor(type: PacketTypes, sequence: number | null, data?: Buffer | string) {
    this.type = type;
    this.sequence = sequence;
    this.data = data?.toString() || null;
  }

  public get rawData(): Buffer | null {
    if (!this.data) return null;
    return Buffer.from(this.data, 'ascii');
  }
}

export class MultiPartPacket extends Packet {
  public readonly index: number;
  public readonly length: number;
  public readonly data: string;
  public readonly sequence: number;

  constructor(index: number, length: number, sequence: number, data: Buffer) {
    super(PacketTypes.COMMAND, sequence, data);

    this.index = index;
    this.length = length;
    this.data = data.toString();
    this.sequence = sequence;
  }
}
