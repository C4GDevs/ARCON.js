import { createSocket } from 'dgram';
import EventEmitter from 'events';
import Packet, { MessageTypes } from './Packet';

interface ConnectionProperties {
  ip: string;
  port: number;
  password: string;
}

declare interface Connection {
  on(event: 'connected', listener: () => void): this;
}

class Connection extends EventEmitter {
  private readonly _ip: string;
  private readonly _port: number;
  private readonly _password: string;

  private _socket = createSocket('udp4');
  private _connected = false;
  private _sequence = 0;

  constructor({ ip, port, password }: ConnectionProperties) {
    super();

    this._ip = ip;
    this._port = port;
    this._password = password;

    this._socket.on('connect', this._login);
    this._socket.on('message', this._receivePacket);

    setInterval(this._heartbeat, 30_000);
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

  public connect() {
    this._socket.connect(this._port, this._ip);
  }

  public sendCommand(command: string) {
    if (++this._sequence > 255) this._sequence = 0;
    const packet = new Packet(MessageTypes.COMMAND, this._sequence, command);
    this._socket.send(packet.toBuffer());
  }

  private _heartbeat() {
    if (this._connected) {
      this._socket.send(new Packet(MessageTypes.COMMAND).toBuffer());
    }
  }

  private _login() {
    this._socket.send(new Packet(MessageTypes.LOGIN, null, this.password).toBuffer());
  }

  private _receivePacket(data: Buffer) {
    const packet = Packet.from(data);

    switch (packet.type) {
      case MessageTypes.LOGIN:
        if (packet.payload?.[0] === 0x01) {
          this._connected = true;
          this.emit('connected');
        } else throw new Error('Failed to login to RCON server.');
        break;
      case MessageTypes.COMMAND:
        break;
      case MessageTypes.SERVER_MESSAGE: {
        const response = new Packet(MessageTypes.SERVER_MESSAGE, packet.sequence, null);
        this._socket.send(response.toBuffer());
        break;
      }
      default:
        break;
    }
  }
}

export = Connection;
