import { Socket, createSocket } from 'dgram';
import EventEmitter from 'events';
import { CommandPacketPart, LoginPacket, Packet, PacketError, PacketTypes, createPacket } from './packet';
import ArconError from './ArconError';

export enum ConnectionState {
  CLOSED,
  CLOSING,
  CONNECTING,
  CONNECTED
}

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

export declare interface BaseClient {
  on(event: 'connected', listener: () => void): this;
  on(event: 'disconnected', listener: (reason: string, abortReconnect: boolean) => void): this;
  on(event: 'error', listener: (error: Error | PacketError | ArconError) => void): this;
}

/**
 * The minimum viable implementation of an RCON client.
 * @extends EventEmitter
 */
export class BaseClient extends EventEmitter {
  // Connection options
  private _host: string;
  private _port: number;
  private _password: string;
  private _autoReconnect: boolean;

  private _sequence = 0;

  private _lastCommandPacketSentAt: Date | null = null;
  private _lastCommandPacketReceivedAt: Date | null = null;

  // Connection state
  private _socket: Socket | null = null;
  private _state: ConnectionState = ConnectionState.CLOSED;

  // Timeouts and intervals
  private _timeouts = new Map<string, NodeJS.Timeout>();

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
   * Opens a connection to the RCON server.
   * @returns Whether the connection was successfully established.
   */
  public connect(): boolean {
    if (this._state !== ConnectionState.CLOSED) return false;

    this._state = ConnectionState.CONNECTING;

    this._setup();

    this._socket?.connect(this._port, this._host);

    return true;
  }

  /**
   * Closes the connection to the RCON server.
   * @returns Whether the connection was successfully closed.
   */
  public close(reason?: string, abortReconnect = !this._autoReconnect): boolean {
    // Capture state and prevent further close attempts
    const state = this._state;
    this._state = ConnectionState.CLOSING;

    // Do nothing if the connection is already in process of closing
    if (state === ConnectionState.CLOSED || state === ConnectionState.CLOSING) return false;

    // Reset socket
    if (this._socket) {
      this._socket.close();
      this._socket = null;
    }

    // Reset sequence and timers
    this._sequence = 0;
    this._lastCommandPacketSentAt = null;
    this._lastCommandPacketReceivedAt = null;

    // Reset timeouts
    this._clearTimeout('login');
    this._clearTimeout('heartbeat');

    // Emit disconnected event
    this._state = ConnectionState.CLOSED;
    this.emit('disconnected', reason, abortReconnect);

    if (!abortReconnect) {
      this.connect();
    }

    return true;
  }

  /**
   * Clears a timeout if it exists.
   */
  private _clearTimeout(key: string) {
    const timeout = this._timeouts.get(key);
    if (timeout) {
      clearTimeout(timeout);
      clearInterval(timeout);
      this._timeouts.delete(key);
    }
  }

  /**
   * Generates a sequence number for a packet.
   */
  protected _getSequence() {
    const sequence = this._sequence;
    this._sequence = (this._sequence + 1) % 256;

    this._lastCommandPacketSentAt = new Date();

    return sequence;
  }

  /**
   * Handles the response to a command packet.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected _handleCommandPacket(packet: Packet | CommandPacketPart) {
    this._lastCommandPacketReceivedAt = new Date();
  }

  /**
   * Handles the response to the login packet.
   */
  private _handleLoginPacket(packet: LoginPacket) {
    this._clearTimeout('login');

    if (packet.data.toString() === '0') {
      this.emit('error', new ArconError('Invalid password.'));
      this.close('Invalid password.', true);
      return;
    }

    this._state = ConnectionState.CONNECTED;
    this.emit('connected');

    const interval = setInterval(() => {
      this._heartbeat();
    }, 1000);

    this._timeouts.set('heartbeat', interval);
  }

  /**
   * Passes a received packet to the proper handler
   */
  private _handleMessage(data: Buffer) {
    const packet = createPacket(data);

    if (packet instanceof PacketError) {
      this.emit('error', packet);
      return;
    }

    if (packet instanceof LoginPacket) {
      this._handleLoginPacket(packet);
      return;
    }

    if (this._state !== ConnectionState.CONNECTED) return;

    if (packet.type === PacketTypes.Message) {
      this._handleMessagePacket(packet);
      return;
    }

    this._handleCommandPacket(packet);
  }

  /**
   * Handles the response to a message packet.
   */
  protected _handleMessagePacket(packet: Packet) {
    const response = Packet.create(PacketTypes.Message, null, packet.sequence);

    this._send(response.toBuffer());
  }

  /**
   * Sends a heartbeat packet to the RCON server.
   */
  private _heartbeat() {
    const sendHeartbeat = () => {
      const packet = Packet.create(PacketTypes.Command, null, this._getSequence());
      this._send(packet.toBuffer());
    };

    // Send a heartbeat if we've not sent a command packet yet. This will happen
    // right after the login is completed.
    if (!this._lastCommandPacketSentAt) {
      sendHeartbeat();
      return;
    }

    const now = new Date();
    const lastCommandDiff = now.getTime() - this._lastCommandPacketSentAt.getTime();

    // If a command takes longer than 15 seconds to respond, connection is dead.
    if (this._lastCommandPacketReceivedAt) {
      const lastCommandReceivedDiff =
        this._lastCommandPacketSentAt.getTime() - this._lastCommandPacketReceivedAt.getTime();

      if (lastCommandReceivedDiff > 15_000) {
        this.close('Connection timed out.');
        return;
      }
    }

    // Send a heartbeat every 20 seconds.
    if (lastCommandDiff > 20_000) {
      sendHeartbeat();
    }
  }

  /**
   * Wrapper for sending a command to the RCON server.
   */
  protected _send(data: Buffer) {
    if (this._socket) {
      this._socket.send(data);
    }
  }

  /**
   * Sends the login packet to the RCON server.
   */
  private _sendLogin() {
    const packet = LoginPacket.create(this._password);

    const timeout = setTimeout(() => {
      this.close('Login timed out.');
    }, 5000);

    this._timeouts.set('login', timeout);

    this._send(packet.toBuffer());
  }

  /**
   * Sets up the socket event listeners.
   */
  private _setup() {
    this._socket = createSocket('udp4');

    this._socket.once('connect', () => this._sendLogin());
    this._socket.on('message', (data) => this._handleMessage(data));

    this._socket.on('error', (error) => {
      this.emit('error', error);
      this.close('Socket error.');
    });
  }
}
