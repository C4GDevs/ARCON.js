import { createSocket, Socket } from 'dgram';
import EventEmitter from 'events';
import CommandManager from '../commandManager/CommandManager';
import { MultiPartPacket, Packet, PacketTypes } from '../packetManager/Packet';
import PacketManager from '../packetManager/PacketManager';
import Player from '../playerManager/Player';
import PlayerManager, { IPlayerManager } from '../playerManager/PlayerManager';

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
  /** Whether bans should be loaded on connection and cached. */
  loadBans?: boolean;
}

export default interface ARCon {
  on(event: 'command', listener: (data: string) => void): this;
  on(event: 'connected', listener: (loggedIn: boolean) => void): this;
  on(event: 'disconnected', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'message', listener: (message: string) => void): this;
  on(event: 'playerConnected', listener: (message: Player) => void): this;
  on(event: 'playerDisonnected', listener: (message: Player) => void): this;
}

export default class ARCon extends EventEmitter {
  /** @readonly IP address of RCon server. */
  public readonly ip: string;

  /** @readonly Whether bans should be loaded on connection and cached. */
  public readonly loadBans: boolean;

  /** @readonly Password of RCon server. */
  public readonly password: string;

  /** @readonly Controller for players connected to server. */
  private readonly _players: PlayerManager;

  /** @readonly Port of RCon server. */
  public readonly port: number;

  /** @readonly Determines if messages (such as BELogs) should be split into separate events. */
  public readonly separateMessageTypes: boolean;

  /** @readonly Time to wait (in milliseconds) before a connection is aborted. */
  public readonly timeout: number;

  /** @readonly Controller for fetching commands. */
  private readonly _commandManager: CommandManager;

  /** Is this client currently connected to an RCon server. */
  private _connected: boolean;

  /** Time which client last sent a command packet. */
  private _lastCommandTime: Date;

  /** Time which client last received a packet. */
  private _lastResponseTime: Date;

  /** @readonly Controller for constructing and destructing packets. */
  private readonly _packetManager: PacketManager;

  /** @readonly UDP socket use to communicate to server. */
  private readonly _socket: Socket;

  constructor(opts: ConnectionProperies) {
    super();

    this.ip = opts.ip;
    this.port = opts.port;
    this.password = opts.password;
    this.timeout = opts.timeout ?? 5_000;
    this.separateMessageTypes = opts.separateMessageTypes ?? false;
    this.loadBans = opts.loadBans ?? false;

    this._commandManager = new CommandManager(this);
    this._players = new PlayerManager(this);
    this._packetManager = new PacketManager();

    this._socket = createSocket('udp4');
    this._socket.on('message', (packet) => this._handlePacket(packet));
    this._socket.on('error', (err) => this.emit('error', err));

    this._connected = false;

    this._lastCommandTime = new Date();
    this._lastResponseTime = new Date();

    setInterval(() => {
      this._heartbeat();
    }, 5_000);
  }

  public get commands() {
    const manager = this._commandManager;

    return {
      addBan: manager.addBan,
      admins: manager.admins,
      bans: manager.bans,
      loadBans: manager.loadBans,
      loadEvents: manager.loadEvents,
      loadScripts: manager.loadScripts,
      missions: manager.missions,
      removeBan: manager.removeBan,
      sayGlobal: manager.sayGlobal,
      writeBans: manager.writeBans
    };
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

  /** Get the {@link PlayerManager} */
  public get playerManager(): IPlayerManager {
    const players = [...this._players.cache];
    return {
      players,
      kick: this._players.kick,
      resolve: this._players.resolve,
      say: this._players.say
    };
  }

  /**
   * Sends a command to RCon server.
   * @param data command to send to RCon server.
   */
  public send(data: string) {
    const packet = this._packetManager.buildBuffer(PacketTypes.COMMAND, data);

    this._send(packet);
  }

  /** Process incoming command packet. */
  private _commandMessage(packet: Packet) {
    if (packet.sequence === null) return;

    // Packet is not ready yet.
    if (packet instanceof MultiPartPacket) return;

    // There's no data to process.
    if (!packet.data) return;

    // Always cache player list.
    if (packet.data.startsWith('Players on server')) {
      const players = packet.data.matchAll(
        /(\d+) +([0-9.]+):\d+ +\d+ +([a-z0-9]{32})\([A-Z]+\) (.+?)(?:$| \((Lobby)\)$)/gm
      );

      for (const player of players) {
        const [, idstr, ip, guid, name, inLobby] = player;

        const lobby = inLobby === 'Lobby';
        const id = Number(idstr);

        const existingPlayer = this._players.resolve(id);

        if (existingPlayer) {
          existingPlayer.lobby = lobby;

          this._players.remove(existingPlayer);
          this._players.add(existingPlayer);
          continue;
        }

        this._players.add(new Player({ id, ip, guid, name, lobby }));
      }

      return;
    }

    // todo: implement ban manager
    if (packet.data.startsWith('GUID Bans') && this.loadBans) {
      return;
    }
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

    if (packet.type === PacketTypes.COMMAND) {
      this._commandMessage(packet);
      return;
    }
  }

  private _heartbeat() {
    if (!this._connected) return;

    const lastResponseDelta = Date.now() - this._lastResponseTime.valueOf();
    const lastCommandDelta = Date.now() - this._lastCommandTime.valueOf();

    // Send out a command to keep connection alive.
    if (lastResponseDelta > 5_000 || lastCommandDelta > 40_000) {
      const packet = this._packetManager.buildBuffer(PacketTypes.COMMAND, 'players');

      this._send(packet);
      this._lastCommandTime = new Date();
    }

    // RCon server hasn't sent a packet in 10 seconds.
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
      this._send(this._packetManager.buildBuffer(PacketTypes.COMMAND, 'players'));

      this.emit('connected', { success: true, error: null });
      this._connected = true;
      return;
    }

    this.emit('connected', { success: false, error: 'Connection refused (Bad login)' });
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

    if (packet.data?.endsWith('connected')) {
      const match = /^Player #(\d+) (.+) \(((?:(?:[0-9](\.|)){1,3}){4}):[0-9]{1,5}\) connected$/.exec(packet.data);
      if (!match) {
        this.emit('error', new Error('Could not parse guid of connecting player'));
        return;
      }
      const [, id, name, ip] = match;

      this._players.add(new Player({ id: Number(id), name, ip, lobby: true }));
    }

    if (packet.data?.startsWith('Verified GUID')) {
      const match = /^Verified GUID \(([a-z0-9]{32})\) of player #([0-9]+)$/.exec(packet.data);

      if (!match) {
        this.emit('error', Error('Could not parse guid of connecting player'));
        return;
      }

      const [, guid] = match;

      const player = this._players.setGuid(guid[2], guid[1]);

      this.emit('playerConnected', player);
    }

    if (packet.data?.endsWith('disconnected')) {
      const match = /^Player #([0-9]+) .+ disconnected$/.exec(packet.data);

      if (!match) {
        this.emit('error', Error('Could not parse id of disconnecting player'));
        return;
      }

      const [, id] = match;

      const player = this._players.resolve(Number(id));

      this.emit('playerDisconnected', player);
    }
  }
}
