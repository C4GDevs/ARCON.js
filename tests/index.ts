import { expect } from 'chai';
import { Arcon, PacketTypes } from '../src';

const connection = new Arcon({
  ip: '140.82.114.3',
  port: 2333,
  password: 'test',
  timeout: 100,
  separateMessageTypes: true
});

const successResponsePacket = Buffer.from([0x42, 0x45, 0x69, 0xdd, 0xde, 0x36, 0xff, 0x00, 0x01]);
const failLoginPacket = Buffer.from([0x42, 0x45, 0xff, 0xed, 0xd9, 0x41, 0xff, 0x00, 0x00]);

describe('Connection', () => {
  it('Rejects on failed connection', () => {
    connection.once('error', (e) => expect(e).to.equal('Could not connect to server (Port closed)'));
    connection.connect();
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

  connection.removeAllListeners('error');

  it('Errors on multiple connections', () => {
    connection.once('error', (e) => expect(e).to.equal('Tried to connect while already connected'));
    connection.connect();
  });

  it('Handles messages', () => {
    const manager = connection['_packetManager'];
    const connectionPacket = manager.buildBuffer(
      PacketTypes.SERVER_MESSAGE,
      'Player #0 Tren (37.158.225.96:9) connected'
    );
    const guidPacket = manager.buildBuffer(
      PacketTypes.SERVER_MESSAGE,
      'Verified GUID (fec4444cd6c294037444ca480f3f08de) of player #0 Tren'
    );
    const disconnectionPacket = manager.buildBuffer(PacketTypes.SERVER_MESSAGE, 'Player #0 Tren disconnected');

    const playerListPacket = manager.buildBuffer(
      PacketTypes.COMMAND,
      'Players on server:\n1 127.0.0.1:2302    100  5ddabbcb89ca69b98da05b337e4aaa27(OK) Testing (Lobby)'
    );

    const playerListPacket2 = manager.buildBuffer(
      PacketTypes.COMMAND,
      'Players on server:\n1 127.0.0.1:2302    100  5ddabbcb89ca69b98da05b337e4aaa27(OK) Testing'
    );

    const belogPacket = manager.buildBuffer(
      PacketTypes.SERVER_MESSAGE,
      'RemoteExec Log: #1 Testing (5ddabbcb89ca69b98da05b337e4aaa27) - #0 "testvalue"'
    );

    const kickPacket = manager.buildBuffer(
      PacketTypes.SERVER_MESSAGE,
      'Player #1 Testing (5ddabbcb89ca69b98da05b337e4aaa27) has been kicked by BattlEye: RemoteExec Restriction #0'
    );

    connection['_handlePacket'](connectionPacket);
    expect(connection.playerManager.players.length).to.be.greaterThan(0);

    connection['_handlePacket'](guidPacket);
    expect(connection.playerManager.players[0].guid).not.to.be.undefined;

    connection['_handlePacket'](disconnectionPacket);
    expect(connection.playerManager.players.length).to.equal(0);

    connection['_handlePacket'](playerListPacket);
    expect(connection.playerManager.players.length).to.equal(1);
    expect(connection.playerManager.players[0].lobby).to.be.true;

    connection['_handlePacket'](playerListPacket2);
    expect(connection.playerManager.players.length).to.equal(1);
    expect(connection.playerManager.players[0].lobby).to.be.false;

    connection.once('belog', (log) => {
      expect(log.type).to.equal('RemoteExec');
      expect(log.filter).to.equal(0);
      expect(log.data).to.equal('"testvalue"');
    });
    connection['_handlePacket'](belogPacket);

    connection['_handlePacket'](kickPacket);
    expect(connection.playerManager.players.length).to.equal(0);
  });
});
