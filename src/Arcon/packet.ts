import crc32 from 'buffer-crc32';

export enum PacketTypes {
  Login = 0x00,
  Command = 0x01,
  Message = 0x02
}

/**
 * All packets are in this format:
 * [BE]|[CRC32]|0xff|[TYPE]|[SEQUENCE]|[DATA]
 * BE is the prefix
 * CRC32 is a 4-byte checksum
 * 0xff is a constant
 * TYPE is a single byte of PacketTypes
 * SEQUENCE is a single byte
 * DATA is the rest of the packet
 *
 * For `Command` packets, DATA can contain a header if the response
 * is too large to fit in a single packet. The header is 3 bytes:
 * 0x00|[TOTAL PACKETS]|[THIS PACKET INDEX]
 * packet index is 0-based.
 */

/**
 * A packet sent or received from the server.
 */
export class Packet {
  readonly prefix: string;
  readonly type: PacketTypes;
  readonly checksum: string;
  readonly sequence: number;
  readonly data: Buffer | null;

  constructor(checksum: string, type: PacketTypes, sequence: number, data: Buffer | null) {
    this.prefix = 'BE';
    this.checksum = checksum;
    this.type = type;
    this.sequence = sequence;
    this.data = data;
  }

  static create(type: PacketTypes, data: Buffer | null, sequence: number) {
    const parts = Buffer.from([0xff, type, sequence]);

    if (data) Buffer.concat([parts, data]);

    const checksum = crc32(Buffer.from(parts)).reverse();
    return new Packet(checksum.toString(), type, sequence, data);
  }

  toBuffer() {
    const header = Buffer.from('BE');

    let prefixedData = Buffer.from([0xff, this.type, this.sequence]);

    if (this.data) prefixedData = Buffer.concat([prefixedData, this.data]);

    const checksum = crc32(prefixedData).reverse();

    return Buffer.concat([header, checksum, prefixedData]);
  }
}

/**
 * A login packet is a special {@link Packet} that does not have a sequence number.
 * It is only used as a response from the server.
 * The data is a single byte, 0 for failure, 1 for success.
 */
export class LoginPacket {
  readonly prefix: string;
  readonly checksum: string;
  readonly type = 0;
  readonly data: Buffer;

  constructor(checksum: string, type: PacketTypes, data: Buffer) {
    this.prefix = 'BE';
    this.checksum = checksum;
    this.data = data;
  }

  static create(type: PacketTypes, data: Buffer) {
    const checksum = crc32(Buffer.from([0xff, type, ...data])).reverse();
    return new LoginPacket(checksum.toString(), type, data);
  }

  toBuffer() {
    const header = Buffer.from('BE');

    let prefixedData = Buffer.from([0xff, this.type, ...this.data]);

    const checksum = crc32(prefixedData).reverse();

    return Buffer.concat([header, checksum, prefixedData]);
  }
}

export class CommandPacketPart {
  readonly prefix: string;
  readonly checksum: string;
  readonly type = 1;
  readonly sequence: number;
  readonly totalPackets: number;
  readonly packetIndex: number;
  readonly data: Buffer;

  constructor(
    checksum: string,
    sequence: number,
    totalPackets: number,
    packetIndex: number,
    data: Buffer
  ) {
    this.prefix = 'BE';
    this.checksum = checksum;
    this.sequence = sequence;
    this.totalPackets = totalPackets;
    this.packetIndex = packetIndex;
    this.data = data;
  }

  static create(type: PacketTypes, data: Buffer, sequence: number, totalPackets: number, packetIndex: number) {
    const parts = [0xff, type, sequence, totalPackets, packetIndex];

    if (data) parts.push(...data);

    const checksum = crc32(Buffer.from(parts)).reverse();
    return new CommandPacketPart(checksum.toString(), sequence, totalPackets, packetIndex, data);
  }
}

export class PacketError {
  packet: Buffer;
  error: string;
  parsedPacket: { prefix?: string; checksum?: string } | null;

  constructor(packet: Buffer, error: string, parsedPacket: { prefix?: string; checksum?: string } | null) {
    this.packet = packet;
    this.error = error;
    this.parsedPacket = parsedPacket;
  }
}

/**
 * Creates a {@link LoginPacket} from a buffer.
 * @param msg The buffer to create a packet from.
 */
export const createPacket = (msg: Buffer) => {
  if (msg.length < 8) return new PacketError(msg, 'Packet too short', null);

  const prefix = msg.subarray(0, 2).toString();

  if (prefix !== 'BE') return new PacketError(msg, 'Invalid packet prefix', { prefix });

  const checksum = msg.subarray(2, 6).toString();

  const calculatedChecksum = crc32(Buffer.from(msg.subarray(6))).reverse();

  if (checksum !== calculatedChecksum.toString()) return new PacketError(msg, 'Invalid checksum', { prefix, checksum });

  const type = msg[7];
  const data = msg.subarray(8);

  if (type === PacketTypes.Login) return new LoginPacket(checksum, type, data);

  const sequence = data[0];
  const packetData = data.subarray(1);

  const dataHasHeader = packetData.length && packetData[0] === 0x00;

  if (type === PacketTypes.Message || !dataHasHeader) return new Packet(checksum, type, sequence, packetData);

  const totalPackets = packetData[1];
  const packetIndex = packetData[2];
  const commandData = packetData.subarray(3);

  return new CommandPacketPart(checksum, sequence, totalPackets, packetIndex, commandData);
};
