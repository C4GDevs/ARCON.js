import { createSocket, Socket } from 'dgram';

interface ConnectionOptions {
  autoReconnect?: boolean;
  ip: string;
  password: string;
  port: number;
}

export default class Arcon {
  // Required fields
  public readonly ip: string;
  public readonly password: string;
  public readonly port: number;

  // Optional fields
  public readonly autoReconnect: boolean = false;

  // Private fields
  private readonly _socket: Socket;

  constructor(options: ConnectionOptions) {
    Object.assign(this, options);

    this._socket = createSocket('udp4');

    this._socket.on('connect', () => this._login());
  }

  public connect() {
    this._socket.connect(this.port, this.ip);
  }

  private _login() {
    const callback = () => clearTimeout(connectionTimeout);

    this._socket.prependListener('message', callback);

    const connectionTimeout = setTimeout(() => {
      this._socket.close();
      this._socket.removeListener('message', callback);
    }, 5_000);
  }
}
