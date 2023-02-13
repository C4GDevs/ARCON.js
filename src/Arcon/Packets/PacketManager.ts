import crc32 from 'buffer-crc32';

import { Packet, PacketTypes, PacketWithSequence } from './Packet';

export default class PacketManager {
  private _sequence = -1;
  private _packetParts: Map<number, PacketWithSequence[]> = new Map();

  constructor() {
    // TODO: find a better way to clean packets
    setInterval(() => {
      for (let i = 0; i < this._sequence; i++) {
        if (this._packetParts.has(i)) {
          this._packetParts.delete(i);
        }
      }
    }, 1000);
  }

  public buildBuffer(type: PacketTypes, input: string | number) {
    const checksumInput = [0xff, type];

    const shouldAddSequence = type === PacketTypes.Command ? true : false;

    const data = Buffer.from(typeof input === 'string' ? input : [input]);

    if (shouldAddSequence) checksumInput.push(this._getNextSequence());
    if (data) checksumInput.push(...Buffer.from(data));

    const checksum = crc32(Buffer.from(checksumInput));

    const header = [0x42, 0x45, ...checksum.reverse(), 0xff, type];
    if (shouldAddSequence) header.push(checksumInput[2]);

    const bufferHeader = Buffer.from(header);

    return data ? Buffer.concat([bufferHeader, Buffer.from(data)]) : bufferHeader;
  }

  /** Builds a {@link Packet} or {@link PacketWithSequence} from a buffer */
  public buildPacket(data: Buffer) {
    const checksum = data.subarray(2, 6);
    const packetType = data[7];
    const content = data.subarray(8);

    if (packetType === PacketTypes.Login) return new Packet(packetType, content);

    if (packetType === PacketTypes.Command) {
      const sequence = content[0];
      const info = content.subarray(1);

      if (info[0] !== 0) return new PacketWithSequence(packetType, info, sequence);

      const packetLength = info[1];
      const index = info[2];

      const packetArray =
        <PacketWithSequence[]>this._packetParts.get(sequence) ?? new Array<PacketWithSequence>(packetLength);

      // If the packet is already complete, ignore it
      if (packetArray.length !== packetLength) {
        this._packetParts.delete(sequence);
        return null;
      }

      packetArray[index] = new PacketWithSequence(packetType, info.subarray(3), sequence);

      this._packetParts.set(sequence, packetArray);

      if (packetArray.length === packetLength && Object.values(packetArray).length === packetLength) {
        const fullContent = Buffer.concat(packetArray.map((p) => p.rawData));

        this._packetParts.delete(sequence);
        return new PacketWithSequence(packetType, fullContent, sequence);
      }

      return null;
    }

    return new PacketWithSequence(packetType, content.subarray(1), content[0]);
  }

  public getPacketType(data: Buffer) {
    return data[7];
  }

  public resetSequence() {
    this._sequence = -1;
  }

  private _getNextSequence() {
    return ++this._sequence % 256;
  }
}
