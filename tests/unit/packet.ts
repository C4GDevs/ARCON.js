import { expect } from 'chai';
import { createPacket, Packet, LoginPacket, CommandPacketPart, PacketError } from '../../src/Arcon/packet';

describe('Packet', () => {
  it('Creates a `PacketError` when the buffer is too short', () => {
    const packet = createPacket(Buffer.from([0x42, 0x45, 0x00, 0x00]));

    expect(packet).to.be.instanceOf(PacketError);
  });

  it('Creates a `PacketError` when the prefix is invalid', () => {
    const packet = createPacket(Buffer.from([0x42, 0x44, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));

    expect(packet).to.be.instanceOf(PacketError);
  });

  it('Creates a `PacketError` when the checksum is invalid', () => {
    const packet = createPacket(
      Buffer.from([
        0x42,
        0x45, // BE
        0x5e,
        0x34,
        0x62, // Should be 0x61
        0xf6, // Checksum
        0xff, // Separator
        0x00, // Packet type
        0x00, // Sequence
        0x74,
        0x65,
        0x73,
        0x74 // test
      ])
    );

    expect(packet).to.be.instanceOf(PacketError);
  });
});
