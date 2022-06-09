import { expect } from 'chai';
import arcon from '../src';

const connection = new arcon({ ip: '140.82.114.3', port: 2333, password: 'test', timeout: 100 });

describe('Connection', () => {
  it('Rejects on failed connection', async () => {
    connection.connect().catch((e) => expect(e).to.equal('Could not connect to server'));
  });

  it('Rejects on incorrect password', () => {
    connection.connect().catch((e) => expect(e).to.equal('Connection refused (Bad login)'));
    connection.emit('_loggedIn', false);
  });

  it('Emits on successful connection', async () => {
    connection.connect().then(() => expect(connection.connected).to.equal(true));
    connection.emit('_loggedIn', true);
  });

  it('Errors on multiple connections', async () => {
    connection.connect().catch((e) => expect(e.message).to.equal('Already connected to server.'));
  });
});
