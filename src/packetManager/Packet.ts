export enum PacketTypes {
  LOGIN = 0x00,
  COMMAND = 0x01,
  SERVER_MESSAGE = 0x02
}

export class Packet {
  public readonly type: PacketTypes;
  public readonly data: string | null;

  constructor(type: PacketTypes, data?: Buffer) {
    this.type = type;
    this.data = data?.toString() || null;
  }
}

export class MultiPartPacket extends Packet {}
