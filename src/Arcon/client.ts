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

    return true;
  }

  /**
   * Closes the connection to the RCON server.
   * @returns Whether the connection was successfully closed.
   */
  public close(): boolean {
    if (this._state !== ConnectionState.CONNECTED) return false;

    this._state = ConnectionState.CLOSING;

    this._socket?.close();
    this._socket = null;

    this._state = ConnectionState.CLOSED;

    return true;
  }

  private _setup() {
    this._socket = createSocket('udp4');

    this._socket.once('connect', () => {});
  }
}
