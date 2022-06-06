import { createSocket, RemoteInfo, Socket } from 'dgram';
import EventEmitter from 'events';
import PlayerManager from '../playerManager/PlayerManager';

interface ConnectionProperies {
  ip: string;
  port: number;
  password: string;
}

export default class ARcon extends EventEmitter {
  public readonly ip: string;
  public readonly port: number;
  public readonly password: string;
  public readonly players: PlayerManager;

  private _socket: Socket;

  constructor(opts: ConnectionProperies) {
    super();

    this.ip = opts.ip;
    this.port = opts.port;
    this.password = opts.password;

    this.players = new PlayerManager(this);

    this._socket = createSocket('udp4');
    this._socket.on('message', this._handlePacket);
  }

  public connect() {
    return new Promise<void>((resolve) => {
      this._socket.connect(this.port, this.ip, async () => {
        this._login();
        this.once('_loggedIn', () => resolve());
      });
    });
  }

  private _login() {
    this._socket.send('mybuffer');
    return;
  }

  private _handlePacket(buf: Buffer, _rinfo: RemoteInfo) {}
}
