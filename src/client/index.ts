import { createSocket, Socket } from 'dgram';
import EventEmitter from 'events';
import { PacketTypes } from '../packetManager/Packet';
import PacketManager from '../packetManager/PacketManager';
import PlayerManager from '../playerManager/PlayerManager';

interface ConnectionProperies {
  ip: string;
  port: number;
  password: string;
  timeout?: number;
}

export default class ARcon extends EventEmitter {
  public readonly ip: string;
  public readonly port: number;
  public readonly password: string;
  public readonly timeout: number;
  public readonly players: PlayerManager;

  private readonly _socket: Socket;
  private readonly _packetManager: PacketManager;

  private _connected: boolean;

  constructor(opts: ConnectionProperies) {
    super();

    this.ip = opts.ip;
    this.port = opts.port;
    this.password = opts.password;
    this.timeout = opts.timeout ?? 5_000;

    this.players = new PlayerManager();

    this._socket = createSocket('udp4');
    this._socket.on('message', (packet) => this._handlePacket(packet));
    this._socket.on('close', () => (this._connected = false));

    this._packetManager = new PacketManager();

    this._connected = false;
  }

  public get connected(): boolean {
    return this._connected;
  }

  public connect() {
    if (this._connected) throw new Error('Already connected to server.');

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject('Could not connect to server');
      }, this.timeout);

      this._socket.connect(this.port, this.ip, async (err?: Error) => {
        if (err) {
          reject('Could not connect to server');
        }
        this._login();

        this.once('_loggedIn', (success: boolean) => {
          clearTimeout(timeout);

          if (success) {
            this._connected = true;
            this.emit('connected');
            resolve();
          }

          this._socket.disconnect();
          reject('Connection refused (Bad login)');
        });
      });
    });
  }

  public disconnect() {
    this._connected = false;
    this._socket.disconnect();
  }

  private _login() {
    this._socket.send(this._packetManager.buildBuffer(PacketTypes.LOGIN, this.password));
    return;
  }

  private _handlePacket(buf: Buffer) {
    const packet = this._packetManager.buildPacket(buf);

    if (packet.type === PacketTypes.LOGIN) {
      const data = packet.rawData?.[0] ?? 0x00;

      if (data === 0x01) this.emit('_loggedIn', true);
      else this.emit('_loggedIn', false);
      return;
    }
  }
}
