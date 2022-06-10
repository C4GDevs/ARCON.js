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

const largePacket = [
  Buffer.from([0x42, 0x45, 0x43, 0x46, 0xfc, 0x3f, 0xff, 0x01, 0x05, 0x00, 0x04, 0x00, 0x74, 0x65, 0x73, 0x74]),
  Buffer.from([0x42, 0x45, 0xf3, 0x6f, 0x9c, 0x02, 0xff, 0x01, 0x05, 0x00, 0x04, 0x01, 0x74, 0x65, 0x73, 0x74]),
  Buffer.from([0x42, 0x45, 0x23, 0x15, 0x3c, 0x45, 0xff, 0x01, 0x05, 0x00, 0x04, 0x02, 0x74, 0x65, 0x73, 0x74]),
  Buffer.from([0x42, 0x45, 0x93, 0x3c, 0x5c, 0x78, 0xff, 0x01, 0x05, 0x00, 0x04, 0x03, 0x74, 0x65, 0x73, 0x74])
];

describe('Packet Manager', () => {
  it('Ensures packets are valid', () => {
    try {
      manager.buildPacket(invalidBuffer);
    } catch (e) {
      let v = e as unknown as Error;
      expect(v.message).to.equal('Invalid packet checksum');
    }
  });

  it('Creates a packet from a buffer', () => {
    const packet = manager.buildPacket(validBuffer);

    expect(packet).to.be.instanceOf(Packet);

    expect(packet.type).to.equal(PacketTypes.LOGIN);
    expect(packet.data).to.be.a.string('test');
  });

  it('Creates a packet from multiple parts', () => {
    let finishedPacket: Packet | null = null;
    for (const packet of largePacket) {
      const p = manager.buildPacket(packet);
      if (p instanceof Packet) finishedPacket = p;
    }

    expect(finishedPacket).to.not.be.null;
    expect(finishedPacket).to.be.instanceOf(Packet);

    expect(finishedPacket?.data).to.equal('testtesttesttest');
    expect(finishedPacket?.type).to.equal(PacketTypes.COMMAND);
  });
});
