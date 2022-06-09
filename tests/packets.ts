import { expect } from 'chai';
import { Packet, PacketTypes } from '../src/packetManager/Packet';
import packetManager from '../src/packetManager/PacketManager';

const manager = new packetManager();

const validBuffer = Buffer.from([
  0x42,
  0x45, // BE
  0x7f,
  0xab,
  0x3d,
  0xac, // Checksum
  0xff, // Separator
  0x00, // Packet type
  0x74,
  0x65,
  0x73,
  0x74 // test
]);

// Same as validBuffer, but 0xab is now 0xac @ i = 3
const invalidBuffer = Buffer.from([0x42, 0x45, 0x7f, 0xac, 0x3d, 0xac, 0xff, 0x00, 0x74, 0x65, 0x73, 0x74]);

describe('Packet Manager', () => {
  it('Ensures packets are valid', () => {
    try {
      manager.buildPacket(invalidBuffer);
    } catch (e) {
      expect(e).to.be('Invalid packet checksum');
    }
  });

  it('Creates a packet from a buffer', () => {
    const packet = manager.buildPacket(validBuffer);

    expect(packet).to.be.instanceOf(Packet);

    expect(packet.type).to.equal(PacketTypes.LOGIN);
    expect(packet.data).to.be.a.string('test');
  });
});
