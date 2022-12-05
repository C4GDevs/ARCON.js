import crc32 from 'buffer-crc32';

import { Packet, PacketTypes, PacketWithSequence } from './Packet';

export default class PacketManager {
  private _sequence = -1;

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

    if (packetType === 0) return new Packet(packetType, content);

    return new PacketWithSequence(packetType, content.subarray(1), content[0]);
  }

  public getPacketType(data: Buffer) {
    return data[7];
  }

  private _getNextSequence() {
    return ++this._sequence % 256;
  }
}
