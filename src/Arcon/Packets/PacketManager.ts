import crc32 from 'buffer-crc32';

export enum PacketTypes {
  Login
}

export default class PacketManager {
  private _sequence = -1;

  public buildBuffer(type: PacketTypes, data: string) {
    const checksumInput = [0xff, type];

    const isLoginPacket = type === PacketTypes.Login;

    if (!isLoginPacket) checksumInput.push(this._getNextSequence());
    if (data) checksumInput.push(...Buffer.from(data));

    const checksum = crc32(Buffer.from(checksumInput));

    const header = [0x42, 0x45, ...checksum.reverse(), 0xff, type];
    if (!isLoginPacket) header.push(checksumInput[2]);

    const bufferHeader = Buffer.from(header);

    return data ? Buffer.concat([bufferHeader, Buffer.from(data)]) : bufferHeader;
  }

  public buildPacket(data: Buffer) {
    return
  }

  private _getNextSequence() {
    return ++this._sequence % 256;
  }
}
