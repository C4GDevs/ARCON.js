import { expect } from 'chai';
import Packet from '../src/client/Packet';

describe('Packet functions', () => {
  const loginBuffer = Buffer.from([0x42, 0x45, 0x3f, 0x19, 0x56, 0x0d, 0xff, 0x00, 0x74, 0x65, 0x73, 0x74]);
  const commandBuffer = Buffer.from([0x42, 0x45, 0x83, 0xa5, 0xd3, 0x16, 0xff, 0x01, 0x00, 0x74, 0x65, 0x73, 0x74]);
  const invalidBuffer = Buffer.from([0x42, 0x45, 0x3f, 0x19, 0x55, 0x0d, 0xff, 0x00, 0x74, 0x65, 0x73, 0x74]);

  it('identifies valid buffers', () => {
    const loginPacket = Packet.from(loginBuffer);
    const commandPacket = Packet.from(commandBuffer);

    expect(loginPacket).to.be.instanceOf(Packet);
    expect(commandPacket).to.be.instanceOf(Packet);
    expect(Packet.from.bind(Packet, invalidBuffer)).to.throw('Packet payload does not match checksum.');

    expect(loginPacket.type).to.equal(0x00);
    expect(loginPacket.sequence).to.be.null;

    expect(commandPacket.type).to.equal(0x01);
    expect(commandPacket.sequence).to.equal(0);
  });

  it('converts back to buffer', () => {
    const commandPacket = Packet.from(commandBuffer);
    expect(commandPacket.toBuffer().compare(commandBuffer)).to.equal(0);
  });
});
