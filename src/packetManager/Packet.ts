export enum PacketTypes {
  LOGIN = 0x00,
  COMMAND = 0x01,
  SERVER_MESSAGE = 0x02
}

export class Packet {
  public readonly type: PacketTypes;
  public readonly sequence: number;
  public readonly data: string | null;

  constructor(type: PacketTypes, sequence: number, data?: Buffer | string) {
    this.type = type;
    this.sequence = sequence;
    this.data = data?.toString() || null;
  }
}

export class MultiPartPacket extends Packet {
  public readonly index: number;
  public readonly length: number;
  public readonly data: string;

  constructor(index: number, length: number, sequence: number, data: Buffer) {
    super(PacketTypes.COMMAND, sequence, data);

    this.index = index;
    this.length = length;
    this.data = data.toString();
  }
}
