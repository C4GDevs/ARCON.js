import { expect } from 'chai';
import { arcon } from '../src';

const connection = new arcon({ ip: '140.82.114.3', port: 2333, password: 'test', timeout: 100 });

const successResponsePacket = Buffer.from([0x42, 0x45, 0x69, 0xdd, 0xde, 0x36, 0xff, 0x00, 0x01]);
const failLoginPacket = Buffer.from([0x42, 0x45, 0xff, 0xed, 0xd9, 0x41, 0xff, 0x00, 0x00]);

describe('Connection', () => {
  it('Rejects on failed connection', async () => {
    connection.connect().catch((e) => expect(e).to.equal('Could not connect to server'));
  });

  it('Rejects on incorrect password', () => {
    connection.once('connected', ({ success, error }) => {
      expect(error).to.not.be.null;
      expect(error).to.equal('Connection refused (Bad login)');
    });

    connection['_handlePacket'](failLoginPacket);
  });

  it('Emits on successful connection', () => {
    connection.once('connected', ({ success, error }) => {
      expect(success).to.be.true;
    });

    connection['_handlePacket'](successResponsePacket);
  });

  it('Errors on multiple connections', async () => {
    connection.connect().catch((e) => expect(e).to.equal('Already connected to server'));
  });
});
