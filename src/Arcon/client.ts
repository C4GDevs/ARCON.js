import { Socket, createSocket } from 'dgram';
import EventEmitter from 'events';
import { CommandPacketPart, LoginPacket, Packet, PacketError, PacketTypes, createPacket } from './packet';

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

export declare interface BaseClient {}

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

  // Connection state
  private _socket: Socket | null = null;
  private _state: ConnectionState = ConnectionState.CLOSED;

  // Timeouts
  private _loginTimeout: NodeJS.Timeout | null = null;

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
  public close(reason?: string): boolean {
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

    // Reset timeouts
    this._clearTimeout(this._loginTimeout);

    // Emit disconnected event
    this._state = ConnectionState.CLOSED;
    this.emit('disconnected', reason);
    return true;
  }

  /**
   * Clears a timeout if it exists.
   */
  private _clearTimeout(timeout: NodeJS.Timeout | null) {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  }

  /**
   * Handles the response to a command packet.
   */
  protected _handleCommandPacket(packet: Packet | CommandPacketPart) {}

  /**
   * Handles the response to the login packet.
   */
  private _handleLoginPacket(packet: LoginPacket) {
    this._clearTimeout(this._loginTimeout);

    if (packet.data.toString() === '0') {
      this.emit('error', new Error('Invalid password.'));
      this.close('Invalid password.');
      return;
    }

    this.emit('connected');
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

    this._socket?.send(response.toBuffer());
  }

  /**
   * Wrapper for sending a command to the RCON server.
   */
  private _send(data: Buffer) {
    if (this._socket) {
      this._socket.send(data);
    }
  }

  /**
   * Sends the login packet to the RCON server.
   */
  private _sendLogin() {
    const packet = LoginPacket.create(this._password);

    this._loginTimeout = setTimeout(() => {
      this.close('Login timed out.');
    }, 5000);

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
