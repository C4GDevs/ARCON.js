export enum PacketTypes {
  Login,
  Command,
  ServerMessage
}

class Packet {
  public readonly type: PacketTypes;
  public readonly data: string;
  public readonly rawData: Buffer;

  constructor(type: PacketTypes, data: Buffer) {
    this.type = type;
    this.data = data?.toString();
    this.rawData = data;
  }
}

class PacketWithSequence extends Packet {
  public readonly sequence: number;

  constructor(type: PacketTypes.Command | PacketTypes.ServerMessage, data: Buffer, sequence: number) {
    super(type, data);

    this.sequence = sequence;
  }
}

export { Packet, PacketWithSequence };
