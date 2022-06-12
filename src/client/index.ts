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
  private _lastResponseTime: Date;

  constructor(opts: ConnectionProperies) {
    super();

    this.ip = opts.ip;
    this.port = opts.port;
    this.password = opts.password;
    this.timeout = opts.timeout ?? 5_000;

    this.players = new PlayerManager();

    this._socket = createSocket('udp4');
    this._socket.on('message', (packet) => this._handlePacket(packet));
    this._socket.on('error', (err) => console.log(err));

    this._packetManager = new PacketManager();

    this._connected = false;
    this._lastResponseTime = new Date();

    setInterval(() => this._heartbeat(), 10_000);
  }

  public get connected(): boolean {
    return this._connected;
  }

  public connect() {
    return new Promise<void>((resolve, reject) => {
      if (this._connected) reject('Already connected to server.');

      setTimeout(() => {
        if (!this._connected) reject('Could not connect to server');
      }, this.timeout);

      this._socket.connect(this.port, this.ip, async (err?: Error) => {
        if (err) {
          reject('Could not connect to server');
        }

        this._login();
        resolve();
      });
    });
  }

  public disconnect() {
    this._connected = false;
    this._socket.disconnect();
  }

  private _handlePacket(buf: Buffer) {
    this._lastResponseTime = new Date();
    const packet = this._packetManager.buildPacket(buf);

    // Handle login response, 0x01 is success 0x00 is failure.
    if (packet.type === PacketTypes.LOGIN) {
      const data = packet.rawData?.[0] ?? 0x00;

      if (data === 0x01) {
        this.emit('connected', { success: true, error: null });
        this._connected = true;
      } else this.emit('connected', { success: false, error: 'Connection refused (Bad login)' });

      return;
    }

    // Sequence should never be null here, Typescript needs this for static checks.
    if (packet.sequence === null) return;

    // Make sure to send reply back to server.
    if (packet.type === PacketTypes.SERVER_MESSAGE) {
      const response = this._packetManager.buildResponseBuffer(packet.sequence);
      this._send(response);

      this.emit('message', packet.data);
    }
  }

  // BattlEye requires reauth after 45 seconds of no messages.
  private _heartbeat() {
    if (!this._connected) return;

    const isConnected = Date.now() - this._lastResponseTime.valueOf() < 45_000;

    if (isConnected) this._send(this._packetManager.buildBuffer(PacketTypes.COMMAND));
    else {
      this._connected = false;
      this.emit('disconnected', 'no message');
    }
  }

  private _login() {
    const packet = this._packetManager.buildBuffer(PacketTypes.LOGIN, this.password);
    this._send(packet);
  }

  private _send(buffer: Buffer) {
    this._socket.send(buffer, this.port, this.ip);
  }
}
