import { expect } from 'chai';
import Packet, { MessageTypes } from '../src/client/Packet';

describe('Packet functions', () => {
  it('Creates packets', () => {
    const correctPacket = Buffer.from([0x42, 0x45, 0x7f, 0xab, 0x3d, 0xac, 0xff, 0x00, 0x74, 0x65, 0x73, 0x74]);

    const packet = new Packet(MessageTypes.LOGIN, null, 'test');

    expect(packet).to.be.instanceOf(Packet);
    expect(correctPacket.compare(packet.toBuffer())).to.equal(0);
  });
});
