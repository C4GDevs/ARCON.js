import { createSocket } from 'dgram';
import EventEmitter from 'events';
import CommandManager from './commands';
import Packet, { MessageTypes } from './Packet';
import PacketManager from './PacketManager';
import PacketPart from './PacketPart';

interface ConnectionProperties {
  ip: string;
  port: number;
  password: string;
  autoReconnect?: boolean;
  connectionTimeout?: number;
}

declare interface Connection {
  on(event: 'connected', listener: (loggedIn: boolean) => void): this;
  on(event: 'message', listener: (message: Packet) => void): this;
  on(event: 'disconnected', listener: () => void): this;
}

class Connection extends EventEmitter {
  public commands: CommandManager;

  private readonly _ip: string;
  private readonly _port: number;
  private readonly _password: string;
  private readonly _autoReconnect: boolean;
  private readonly _connectionTimeout: number;

  private _socket = createSocket('udp4');
  private _connected = false;
  private _sequence = -1;
  private _packets = new PacketManager();

  constructor({ ip, port, password, autoReconnect, connectionTimeout }: ConnectionProperties) {
    super();

    this._ip = ip;
    this._port = port;
    this._password = password;
    this._autoReconnect = autoReconnect ?? false;
    this._connectionTimeout = connectionTimeout ?? 5_000;

    this.commands = new CommandManager(this);

    this._socket.on('connect', () => this._login());
    this._socket.on('message', (data) => this._receivePacket(data));
    this._socket.on('close', () => this._handleDisconnection());

    setInterval(() => {
      this._heartbeat();
    }, 15_000);
  }

  public get ip(): string {
    return this._ip;
  }

  public get port(): number {
    return this._port;
  }

  public get password(): string {
    return this._password;
  }

  public get connected(): boolean {
    return this._connected;
  }

  public get autoReconnect(): boolean {
    return this._autoReconnect;
  }

  public connect() {
    this._socket.connect(this._port, this._ip);

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject('Could not connect to server.');
      }, this._connectionTimeout);

      this.once('connected', (success: boolean) => {
        clearTimeout(timeout);
        if (success) resolve();
        else reject('Connection refused (bad password).');
      });
    });
  }

  public sendCommand(command: string, ...data: (string | number | null)[]) {
    return new Promise<Packet>((resolve, reject) => {
      if (!this._connected) reject();

      const sequence = this._getNextSequence();

      const formatted = data ? `${command} ${data.join(' ')}` : command;

      const packet = new Packet(MessageTypes.COMMAND, sequence, formatted);
      this._socket.send(packet.toBuffer());

      this.once(sequence.toString(), (data: Packet) => {
        resolve(data);
      });
    });
  }

  private _heartbeat() {
    if (this._connected) {
      this._socket.send(new Packet(MessageTypes.COMMAND, this._getNextSequence(), null).toBuffer());
    }
  }

  private _login() {
    if (this._connected) return;
    this._socket.send(new Packet(MessageTypes.LOGIN, null, this.password).toBuffer());
  }

  private _getNextSequence() {
    if (++this._sequence > 255) this._sequence = 0;
    return this._sequence;
  }

  private _receivePacket(data: Buffer) {
    let packet = Packet.from(data);

    if (packet instanceof PacketPart) {
      this._packets.addPacket(packet);

      if (packet.index === packet.parts - 1) {
        const p = this._packets.getPacket(packet.sequence);
        if (!p) return;
        packet = p;
      } else {
        return;
      }
    }

    switch (packet.type) {
      case MessageTypes.LOGIN: {
        if (packet.payload?.[0] === 0x01) {
          this._connected = true;
          setTimeout(() => this.emit('connected', true), 1000);
        } else this.emit('connected', false);
        break;
      }

      case MessageTypes.COMMAND: {
        if (!packet.payload?.toString().trim()) break;
        if (packet.sequence !== null) this.emit(packet.sequence.toString(), packet);
        else this.emit('message', packet);
        break;
      }

      case MessageTypes.SERVER_MESSAGE: {
        const response = new Packet(MessageTypes.SERVER_MESSAGE, packet.sequence, null);
        this._socket.send(response.toBuffer());

        this.emit('message', packet);
        break;
      }

      default:
        break;
    }
  }

  private _handleDisconnection() {
    this.emit('disconnected');
    if (this._autoReconnect) this.connect();
  }
}

export = Connection;
