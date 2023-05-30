import { Socket, createSocket } from 'dgram';
import crc32 from 'buffer-crc32';
import EventEmitter from 'events';
import BaseError from './errors/base-error';
import PacketError from './errors/packet-error';
import CredentialError from './errors/credential-error';
import ConnectionError from './errors/connection-error';
import { appendFile } from 'fs/promises';

const commandResponseFormats = {
  playerList: /^Players on server:/
} as const;

const serverMessageFormats = {
  playerIdentifier: /^Player #([0-9]+) (.+) \(((?:[0-9]{1,3}\.){3}[0-9]{1,3}):[0-9]+\) connected$/,
  playerJoin: /^Verified GUID \(([a-z0-9]{32})\) of player #([0-9]+)/,
  playerLeave: /^Player #([0-9]+) .+ disconnected$/,
  playerKicked: /^Player #([0-9]+) .+ has been kicked by BattlEye: (.+)$/
} as const;

interface Identifier {
  id: number;
  name: string;
  ip: string;
}

interface Player extends Identifier {
  guid: string;
}

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
  playerJoin: (player: Player) => void;
  playerLeave: (player: Player) => void;
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

  private _commandParts: Map<number, Buffer[]>;

  private _players: Map<number, Player>;
  private _identifiers: Map<number, Identifier>;

  private _initialPlayersPulled: boolean;

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

  public get players() {
    return [...this._players.values()];
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
    this._commandParts = new Map();

    this._players = new Map();
    this._identifiers = new Map();
    this._initialPlayersPulled = false;

    socket.on('message', (msg: Buffer) => this._handlePacket(msg));
    socket.on('error', (err) => this.emit('error', err));

    socket.connect(this._port, this._ip, () => {
      this._sendLogin();
    });
  }

  private _handleCommand(data: Buffer) {
    const sequenceNumber = data[0];
    const isMultiPart = data[1] === 0x00;

    if (isMultiPart) {
      const partNumber = data[3];
      const totalParts = data[2];
      const partData = data.slice(4);

      const parts = this._commandParts.get(sequenceNumber) || [];

      if (!this._commandParts.has(sequenceNumber)) {
        this._commandParts.set(sequenceNumber, parts);
      }

      parts[partNumber] = partData;

      if (parts.length === totalParts) {
        this._commandParts.delete(sequenceNumber);
        this._processCommand(Buffer.concat(parts).toString());
      }
    } else {
      this._processCommand(data.slice(1).toString());
    }
  }

  private _handleLogin(data: Buffer) {
    clearInterval(this._loginTimeout);

    if (data[0] === 0x00) {
      this.emit('error', new CredentialError({ error: 'Invalid password' }));

      this.close();
      return;
    }

    const packet = this._createPacket(PacketType.Command, Buffer.from('players'));
    this._socket.send(packet, 0, packet.length);

    this._heartbeatInterval = setInterval(() => {
      const packet = this._createPacket(PacketType.Command, Buffer.from(''));
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
        this._handleCommand(packet.data);
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

    // Player identifier (still joining)
    if (serverMessageFormats.playerIdentifier.test(payload)) {
      const [, id, name, ip] = serverMessageFormats.playerIdentifier.exec(payload) || [null, null, null, null];

      if (!id || !name || !ip) {
        return;
      }

      const identifier: Identifier = {
        id: parseInt(id),
        name,
        ip
      };

      this._identifiers.set(identifier.id, identifier);

      return;
    }

    // Player finished joining
    if (serverMessageFormats.playerJoin.test(payload)) {
      const [, guid, id] = serverMessageFormats.playerJoin.exec(payload) || [null, null, null];

      if (!guid || !id) {
        return;
      }

      const identifier = this._identifiers.get(parseInt(id));

      if (!identifier) {
        return;
      }

      const player: Player = {
        ...identifier,
        guid
      };

      this._identifiers.delete(player.id);

      this._players.set(player.id, player);

      this.emit('playerJoin', player);

      return;
    }

    // Player leave
    if (serverMessageFormats.playerLeave.test(payload)) {
      const [, id] = serverMessageFormats.playerLeave.exec(payload) || [null, null];

      if (!id) {
        return;
      }

      const player = this._players.get(parseInt(id));

      if (!player) {
        return;
      }

      this._players.delete(parseInt(id));

      this.emit('playerLeave', player);

      return;
    }

    // Player kicked
    if (serverMessageFormats.playerKicked.test(payload)) {
      const [, id, reason] = serverMessageFormats.playerKicked.exec(payload) || [null, null];

      if (!id) {
        return;
      }

      const player = this._players.get(parseInt(id));

      if (!player) {
        return;
      }

      this._players.delete(parseInt(id));

      this.emit('playerLeave', player);

      return;
    }
  }

  private _processCommand(data: string) {
    if (commandResponseFormats.playerList.test(data)) {
      const playerList = data.split('\n').slice(3, -1);

      for (const playerLine of playerList) {
        const regexp =
          /^([0-9]+)\s+((?:[0-9]{1,3}\.){3}[0-9]{1,3}):[0-9]+\s+[0-9-]+\s+([0-9a-z]{32})\(OK\)\s+(.+?)((?:$|\s+\(Lobby\)))/;

        const [, id, ip, guid, name] = regexp.exec(playerLine) || [null, null, null, null, null];

        if (!id || !ip || !guid || !name) continue;

        if (this._players.has(parseInt(id))) {
          const player = this._players.get(parseInt(id));

          if (!player) continue;

          if (!player.ip) player.ip = ip;

          continue;
        }

        if (this._initialPlayersPulled) continue;

        const player: Player = {
          id: parseInt(id),
          ip,
          guid,
          name
        };

        this._players.set(player.id, player);

        this.emit('playerJoin', player);
      }

      this._initialPlayersPulled = true;
    }
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
