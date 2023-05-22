import { Socket, createSocket } from 'dgram';
import crc32 from 'buffer-crc32';
import EventEmitter from 'events';
import BaseError from './errors/base-error';
import PacketError from './errors/packet-error';
import CredentialError from './errors/credential-error';
import ConnectionError from './errors/connection-error';

enum PacketType {
  Login = 0x00,
  Command = 0x01,
  Message = 0x02
}

interface Packet {
  prefix: string;
  type: PacketType;
  checksum: string;
  data: Buffer;
}

type Events = {
  error: (err: BaseError) => void;
};

export interface ConnectionOptions {
  ip: string;
  port: number;
  password: string;
  /**
   * The interval in milliseconds to send a `players` command to the server.
   * Must be greater than 1000ms and less than 40000ms.
   */
  heartbeatInterval?: number;
}

export interface Arcon {
  on<U extends keyof Events>(event: U, listener: Events[U]): this;
  once<U extends keyof Events>(event: U, listener: Events[U]): this;
  emit<U extends keyof Events>(event: U, ...args: Parameters<Events[U]>): boolean;
}

export class Arcon extends EventEmitter {
  public readonly heartbeatTime: number;

  private readonly _ip: string;
  private readonly _port: number;
  private readonly _password: string;

  private _socket: Socket;
  private _sequenceNumber = 0;

  private _heartbeatInterval: NodeJS.Timeout;
  private _loginTimeout: NodeJS.Timeout;

  private _lastPacketReceivedTime = 0;
  private _packetTimeoutCheckInterval: NodeJS.Timeout;

  private _closed = false;

  constructor(options: ConnectionOptions) {
    super();

    const { ip, port, password, heartbeatInterval = 5000 } = options;

    // Clamp heartbeatInterval to be between 1000ms and 40000ms
    this.heartbeatTime = Math.min(Math.max(heartbeatInterval, 1000), 40000);

    this._ip = ip;
    this._port = port;
    this._password = password;

    this._createSocket();
  }

  public close(shouldReconnect = false) {
    if (this._closed) return;
    clearInterval(this._heartbeatInterval);
    clearInterval(this._packetTimeoutCheckInterval);
    clearTimeout(this._loginTimeout);

    this._socket.close();

    if (shouldReconnect) {
      setTimeout(() => this._createSocket(), 1000);
    }

    this._closed = !shouldReconnect;
  }

  private _createPacket(type: PacketType, data: Buffer) {
    const header = Buffer.from('BE');

    let prefixedData: Buffer;

    if (type === PacketType.Command) {
      prefixedData = Buffer.from([0xff, type, this._sequenceNumber, ...data]);
      this._sequenceNumber++ & 0xff;
    } else {
      prefixedData = Buffer.from([0xff, type, ...data]);
    }

    const checksum = crc32(prefixedData).reverse();

    return Buffer.concat([header, checksum, prefixedData]);
  }

  private _createSocket() {
    const socket = createSocket('udp4');

    this._socket = socket;
    this._sequenceNumber = 0;

    socket.on('message', (msg: Buffer) => this._handlePacket(msg));
    socket.on('error', (err) => this.emit('error', err));

    socket.connect(this._port, this._ip, () => {
      this._sendLogin();
    });
  }

  private _handleLogin(data: Buffer) {
    clearInterval(this._loginTimeout);

    if (data[0] === 0x00) {
      this.emit('error', new CredentialError({ error: 'Invalid password' }));

      this.close();
      return;
    }

    this._heartbeatInterval = setInterval(() => {
      const packet = this._createPacket(PacketType.Command, Buffer.from('players'));
      this._socket.send(packet, 0, packet.length);
    }, this.heartbeatTime);

    this._packetTimeoutCheckInterval = setInterval(() => {
      if (Date.now() - this._lastPacketReceivedTime > this.heartbeatTime * 2) {
        this.emit('error', new ConnectionError({ error: 'No message received' }));
        this.close(true);
      }
    }, 1000);
  }

  private _handlePacket(msg: Buffer) {
    const packet = this._validateMessage(msg);

    if (packet instanceof PacketError) {
      this.emit('error', packet);
      return;
    }

    this._lastPacketReceivedTime = Date.now();

    switch (packet.type) {
      case PacketType.Login:
        this._handleLogin(packet.data);
        break;
      case PacketType.Command:
        // this._handleCommand(packet.data);
        break;
      case PacketType.Message:
        this._handleMessage(packet.data);
        break;
      default:
        this.emit('error', new PacketError({ packet: msg, error: 'Invalid packet type', parsedPacket: packet }));
    }
  }

  private _handleMessage(data: Buffer) {
    const sequence = data[0];
    const payload = data.slice(1).toString();

    // Battleye expects a response containing the sequence number
    const packet = this._createPacket(0x02, Buffer.from([sequence]));
    this._socket.send(packet, 0, packet.length);
  }

  private _sendLogin() {
    const packet = this._createPacket(0x00, Buffer.from(this._password, 'ascii'));

    this._socket.send(packet, 0, packet.length);

    this._loginTimeout = setTimeout(() => {
      this.emit('error', new ConnectionError({ error: 'Login timed out' }));
      this.close(true);
    }, 5000);
  }

  private _validateMessage(msg: Buffer): Packet | PacketError {
    /**
     * Packet formats:
     * - General structure: BE + CRC32 + 0xFF + (0x00 | 0x01 | 0x02) + data
     * - Login:   0x00 OR 0x01
     * - Command: 0x01 + 0x00-0xFF + data
     * - Message: 0x02 + 0x00-0xFF + data
     *
     * - If a command is too large to fit in one packet, `data` will have
     *   this subheader at the start: 0x00 + number of packets + this index
     */
    if (msg.length < 8) return new PacketError({ packet: msg, error: 'Packet too short', parsedPacket: null });

    const prefix = msg.slice(0, 2).toString();

    if (prefix !== 'BE')
      return new PacketError({ packet: msg, error: 'Invalid packet prefix', parsedPacket: { prefix } });

    const checksum = msg.slice(2, 6).toString();

    const calculatedChecksum = crc32(Buffer.from(msg.slice(6))).reverse();

    if (checksum !== calculatedChecksum.toString())
      return new PacketError({ packet: msg, error: 'Invalid checksum', parsedPacket: { prefix, checksum } });

    const type = msg[7];
    const data = msg.slice(8);

    return {
      prefix,
      checksum,
      type,
      data
    };
  }
}
