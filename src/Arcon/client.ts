import { Socket, createSocket } from 'dgram';
import EventEmitter from 'events';
import { CommandPacketPart, LoginPacket, Packet, PacketError, PacketTypes, createPacket } from './packet';

export interface ClientOptions {
  /** Host of the RCON server. */
  host: string;
  /** Port of the RCON server. */
  port: number;
  /** The password of the RCON server. */
  password: string;
  /**
   * Whether to automatically reconnect to the server if disconnected.
   * Does not reconnect if the `password` is incorrect.
   * @default true
   */
  autoReconnect?: boolean;
}

/**
 * The minimum viable implementation of an RCON client.
 * @extends EventEmitter
 */
export class BaseClient extends EventEmitter {
  protected _connected = false;
  protected _socket: Socket;

  protected _seqeuence = 0;

  private _lastPacketReceivedAt: Date;
  private _sequenceModifiedAt: Date;

  // Timeouts
  private _heartbeatInverval: NodeJS.Timeout;
  private _loginTimeout: NodeJS.Timeout;
  private _connectionCheckInterval: NodeJS.Timeout;

  // Connection options
  private _host: string;
  private _port: number;
  private _password: string;
  protected _autoReconnect: boolean;

  /**
   * @param options - The options for the ARCON instance.
   */
  constructor({ host, port, password, autoReconnect }: ClientOptions) {
    super();

    this._host = host;
    this._port = port;
    this._password = password;
    this._autoReconnect = autoReconnect ?? true;
  }

  /**
   * Opens a socket to the server and login.
   */
  public connect() {
    if (this._connected) return;
    this._socket = createSocket('udp4');

    this._socket.on('message', (buf) => this._parseMessage(buf));

    this._socket.once('connect', () => this._sendLogin());

    this._socket.on('error', (error) => {
      this.emit('error', error);
      this.close(false);
    });

    this._socket.connect(this._port, this._host);
  }

  public close(abortReconnect: boolean) {
    if (!this._connected) return;

    this._connected = false;

    this._socket.removeAllListeners();
    this._socket.close();

    this._seqeuence = 0;

    clearInterval(this._heartbeatInverval);
    clearTimeout(this._loginTimeout);
    clearInterval(this._connectionCheckInterval);

    if (abortReconnect || !this._autoReconnect) return;

    setTimeout(() => this.connect(), 5000);
  }

  private _checkConnection() {
    if (this._lastPacketReceivedAt.getTime() + 25_000 < Date.now()) {
      this.close(false);
    }
  }

  protected _getSequence() {
    const sequence = this._seqeuence;
    this._seqeuence = (this._seqeuence + 1) % 256;

    this._sequenceModifiedAt = new Date();

    return sequence;
  }

  private _handleLogin(packet: LoginPacket) {
    clearTimeout(this._loginTimeout);

    if (packet.data.toString() === '0') {
      this.emit('error', new Error('Login failed'));
      this.close(true);
      return;
    }

    this._connected = true;

    this._heartbeatInverval = setInterval(() => this._sendHeartbeat(), 1000);
    this._connectionCheckInterval = setInterval(() => this._checkConnection(), 1000);

    this.emit('connected');
  }

  protected _handleCommandPacket(_packet: Packet | CommandPacketPart) {}
  protected _handleMessagePacket(packet: Packet) {
    const response = Packet.create(PacketTypes.Message, null, packet.sequence);

    this._socket.send(response.toBuffer());
  }

  private _parseMessage(buf: Buffer) {
    const packet = createPacket(buf);

    if (packet instanceof PacketError) return this.emit('error', packet);

    this._lastPacketReceivedAt = new Date();

    if (packet instanceof LoginPacket) return this._handleLogin(packet);

    if (packet.type === PacketTypes.Message) return this._handleMessagePacket(packet);

    return this._handleCommandPacket(packet);
  }

  /**
   * Sends an empty command packet to the server.
   * RCON protocol expects a heartbeat packet at least once
   * every 45 seconds, if no other commands are sent.
   */
  private _sendHeartbeat() {
    if (!this._connected) return;

    if (this._sequenceModifiedAt && this._sequenceModifiedAt.getTime() + 22_500 > Date.now()) return;

    const sequence = this._getSequence();

    const heartbeatPacket = Packet.create(PacketTypes.Command, null, sequence);

    this._socket.send(heartbeatPacket.toBuffer());
  }

  private _sendLogin() {
    const loginPacket = LoginPacket.create(PacketTypes.Login, Buffer.from(this._password));

    // Server is unreachable if it does not respond within 5 seconds.
    this._loginTimeout = setTimeout(() => {
      this.emit('error', new Error('Login timeout'));
      this.close(false);
    }, 5000);

    this._socket.send(loginPacket.toBuffer());
  }
}
