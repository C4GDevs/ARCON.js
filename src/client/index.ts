import { createSocket, Socket } from 'dgram';
import EventEmitter from 'events';
import { Packet, PacketTypes } from '../packetManager/Packet';
import PacketManager from '../packetManager/PacketManager';
import PlayerManager from '../playerManager/PlayerManager';

interface ConnectionProperies {
  /** IP address to connect to. */
  ip: string;
  /** Port to connect to. */
  port: number;
  /** RCon server's password. */
  password: string;
  /** Time to wait (in milliseconds) before a connection is aborted. */
  timeout?: number;
  /** Splits different message types into different events. */
  separateMessageTypes?: boolean;
}

export default class ARCon extends EventEmitter {
  /** @readonly IP address of RCon server. */
  public readonly ip: string;

  /** @readonly Port of RCon server. */
  public readonly port: number;

  /** @readonly Password of RCon server. */
  public readonly password: string;

  /** @readonly Time to wait (in milliseconds) before a connection is aborted. */
  public readonly timeout: number;

  /** @readonly Controller for players connected to server. */
  public readonly players: PlayerManager;

  /** @readonly Determines if messages (such as BELogs) should be split into separate events. */
  public readonly separateMessageTypes: boolean;

  /** @readonly UDP socket use to communicate to server. */
  private readonly _socket: Socket;

  /** @readonly Controller for constructing and destructing packets. */
  private readonly _packetManager: PacketManager;

  /** Is this client currently connected to an RCon server. */
  private _connected: boolean;

  /** Time which client last sent a command packet. */
  private _lastCommandTime: Date;

  /** Time which client last received a packet. */
  private _lastResponseTime: Date;

  /** Sequence number of packet sent at `_lastCommandTime` */
  private _heartbeatId: number | null;

  constructor(opts: ConnectionProperies) {
    super();

    this.ip = opts.ip;
    this.port = opts.port;
    this.password = opts.password;
    this.timeout = opts.timeout ?? 5_000;
    this.separateMessageTypes = opts.separateMessageTypes ?? false;

    this.players = new PlayerManager();

    this._socket = createSocket('udp4');
    this._socket.on('message', (packet) => this._handlePacket(packet));
    this._socket.on('error', (err) => this.emit('error', err));

    this._packetManager = new PacketManager();

    this._connected = false;

    this._lastCommandTime = new Date();
    this._lastResponseTime = new Date();
    this._heartbeatId = null;

    setInterval(() => {
      this._heartbeat();
    }, 1_000);
  }

  public get connected(): boolean {
    return this._connected;
  }

  /**
   * Initiates connection with RCon server.
   * @example
   * ```ts
   * arcon.connect()
   *  .then(() => console.log('connected'))
   *  .catch((reason) => console.error(reason))
   * ```
   */
  public connect() {
    return new Promise<void>((resolve, reject) => {
      if (this._connected) reject('Already connected to server');

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

  /** Disconnects from RCon server. */
  public disconnect() {
    if (!this._connected) return;

    this._connected = false;
    this._socket.disconnect();
  }

  /** Process incoming command packet. */
  private _commandMessage(packet: Packet) {
    if (!packet.sequence) return;

    // Heartbeat response.
    if (this._heartbeatId ?? -1 === packet.sequence) return;
  }

  /** Processes and identifies packets from RCon server. */
  private _handlePacket(buf: Buffer) {
    this._lastResponseTime = new Date();

    const packet = this._packetManager.buildPacket(buf);

    if (packet.type === PacketTypes.LOGIN) {
      this._loginMessage(packet);
      return;
    }

    if (packet.type === PacketTypes.SERVER_MESSAGE) {
      this._serverMessage(packet);
      return;
    }

    // Heartbeat response.
    if (packet.type === PacketTypes.COMMAND) {
      this._commandMessage(packet);
      return;
    }
  }

  private _heartbeat() {
    if (!this._connected) return;

    const lastResponseDelta = Date.now() - this._lastResponseTime.valueOf();
    const lastCommandDelta = Date.now() - this._lastCommandTime.valueOf();

    if (lastResponseDelta > 5_000 || lastCommandDelta > 40_000) {
      const packet = this._packetManager.buildBuffer(PacketTypes.COMMAND, 'version');

      this._heartbeatId = this._packetManager.buildPacket(packet).sequence;

      this._send(packet);
      this._lastCommandTime = new Date();
    }

    if (lastResponseDelta > 10_000) {
      this.disconnect();
      this.emit('disconnected', 'no message');
    }
  }

  private _login() {
    const packet = this._packetManager.buildBuffer(PacketTypes.LOGIN, this.password);
    this._send(packet);
  }

  /** Process incoming login packet. */
  private _loginMessage(packet: Packet) {
    const data = packet.rawData?.[0] ?? 0x00;

    // 0x01 is success 0x00 is failure.
    if (data === 0x01) {
      this.emit('connected', { success: true, error: null });
      this._connected = true;
    } else this.emit('connected', { success: false, error: 'Connection refused (Bad login)' });
  }

  private _send(buffer: Buffer) {
    this._socket.send(buffer, this.port, this.ip);
  }

  /** Process incoming server packet. */
  private _serverMessage(packet: Packet) {
    if (packet.sequence === null) return;

    // Make sure to tell RCon server we received the message.
    const response = this._packetManager.buildResponseBuffer(packet.sequence);
    this._send(response);

    if (!this.separateMessageTypes) {
      this.emit('message', packet.data);
      return;
    }

    // Process messages further.
  }
}
