import { createSocket, Socket } from 'dgram';
import { EventEmitter } from 'stream';
import PacketManager, { PacketTypes } from './Packets/PacketManager';

interface ConnectionOptions {
  autoReconnect?: boolean;
  ip: string;
  password: string;
  port: number;
}

export default class Arcon extends EventEmitter {
  // Required fields
  public readonly ip: string;
  public readonly password: string;
  public readonly port: number;

  // Optional fields
  public readonly autoReconnect: boolean = false;

  // Private fields
  private readonly _socket: Socket;
  private readonly _packetManager: PacketManager;

  constructor(options: ConnectionOptions) {
    super();

    Object.assign(this, options);

    this._socket = createSocket('udp4');
    this._packetManager = new PacketManager();

    this._socket.on('connect', () => this._login());
    this._socket.on('message', (data) => this._handleMessage(data));
  }

  public connect() {
    this._socket.connect(this.port, this.ip);
  }

  private _handleMessage(data: Buffer) {
    this._packetManager.buildPacket(data);
  }

  private _login() {
    const callback = () => clearTimeout(connectionTimeout);

    this._socket.prependListener('message', callback);

    const connectionTimeout = setTimeout(() => {
      this._socket.close();
      this._socket.removeListener('message', callback);
    }, 5_000);

    const buffer = this._packetManager.buildBuffer(PacketTypes.Login, this.password);

    this._socket.send(buffer);
  }
}
