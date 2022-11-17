import { createSocket, Socket } from 'dgram';
import EventEmitter from 'events';
import CommandManager from '../commandManager/CommandManager';
import { MultiPartPacket, Packet, PacketTypes } from '../packetManager/Packet';
import PacketManager from '../packetManager/PacketManager';
import Player from '../playerManager/Player';
import PlayerManager, { IPlayerManager } from '../playerManager/PlayerManager';
import { RCONError } from './rconError';

export enum BELogTypes {
  AddBackpackCargo = 'AddBackpackCargo',
  AddForce = 'AddForce',
  AddMagazineCargo = 'AddMagazineCargo',
  AddTorque = 'AddTorque',
  AddWeaponCargo = 'AddWeaponCargo',
  AttachTo = 'AttachTo',
  CreateVehicle = 'CreateVehicle',
  DeleteVehicle = 'DeleteVehicle',
  MoveOut = 'MoveOut',
  MPEventHandler = 'MPEventHandler', // Unsure, may not be correct
  PublicVariable = 'PublicVariable',
  PublicVariableVal = 'PublicVariableVal',
  RemoteControl = 'RemoteControl',
  RemoteExec = 'RemoteExec',
  Script = 'Script',
  SelectPlayer = 'SelectPlayer',
  SetDamage = 'SetDamage',
  SetPos = 'SetPos',
  SetVariable = 'SetVariable',
  SetVariableVal = 'SetVariableVal',
  SetVisibility = 'SetVisibility',
  TeamSwitch = 'TeamSwitch',
  WaypointCondition = 'WaypointCondition',
  WaypointStatement = 'WaypointStatement'
}

export interface BELog {
  type: BELogTypes;
  filter: number;
  player: Player | null;
  data: string;
  guid: string;
}

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
  /** Whether BELog events require a player object to be found. */
  requirePlayerForLogs?: boolean;
}

export default interface ARCon {
  on(event: 'belog', listener: (data: BELog) => void): this;
  on(event: 'command', listener: (data: string) => void): this;
  on(event: 'connected', listener: (data: { success: boolean; error: string | null }) => void): this;
  on(event: 'disconnected', listener: (reason: string) => void): this;
  on(event: 'error', listener: (error: RCONError) => void): this;
  on(event: 'message', listener: (message: string) => void): this;
  on(event: 'playerConnected', listener: (message: Player) => void): this;
  on(event: 'playerDisconnected', listener: (message: Player) => void): this;
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

  /** @readonly BELogs require player object in cache. */
  public readonly requirePlayerForLogs: boolean;

  constructor(opts: ConnectionProperies) {
    super();

    this.ip = opts.ip;
    this.port = opts.port;
    this.password = opts.password;
    this.timeout = opts.timeout ?? 5_000;
    this.separateMessageTypes = opts.separateMessageTypes ?? false;
    this.loadBans = opts.loadBans ?? false;
    this.requirePlayerForLogs = opts.requirePlayerForLogs ?? true;

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
    }, 500);
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

  /** Initiates connection with RCon server. */
  public connect() {
    if (this._connected) {
      const error = new RCONError('Tried to connect while already connected');
      this.emit('error', error);
      return;
    }

    this._socket.connect(this.port, this.ip, async (err?: Error) => {
      if (err) {
        const error = new RCONError('Could not connect to server', { message: err.message });
        this.emit('error', error);
        return;
      }

      /**
       * This occurs when the RCON port is being blocked on the remote server.
       * DGRAM socket will not inform us that we couldn't connect, so we do it manually.
       */
      setTimeout(() => {
        if (this._connected) return;

        this._socket.disconnect();
        const error = new RCONError('Could not connect to server', { message: 'Port closed' });
        this.emit('error', error);
      }, this.timeout);

      this._login();
    });
  }

  /** Disconnects from RCon server. */
  public disconnect() {
    if (!this._connected) return;

    this._connected = false;
    this._socket.disconnect();

    this._packetManager.reset();
  }

  /** Get the {@link PlayerManager} */
  public get playerManager(): IPlayerManager {
    const players = [...this._players.cache.values()];
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

    this.emit('command', packet.data);

    // Always cache player list.
    if (packet.data.startsWith('Players on server')) {
      const players = packet.data.matchAll(
        /(\d+) +([0-9.]+):\d+ +[-\d]+ +([a-z0-9]{32})\([A-Z]+\) (.+?)(?:$| \((Lobby)\)$)/gm
      );

      const newPlayerList: Player[] = [];

      for (const player of players) {
        const [, idstr, ip, guid, name, inLobby] = player;

        const lobby = inLobby === 'Lobby';
        const id = Number(idstr);

        let playerObject = this._players.resolve(id);

        if (!playerObject) {
          playerObject = new Player({ id, ip, name, guid, lobby });
          this.emit('playerConnected', playerObject);
        } else {
          playerObject.lobby = lobby;
        }

        newPlayerList.push(playerObject);
      }

      for (const player of this._players.cache) {
        const foundPlayer = newPlayerList.find((p) => p.guid === player.guid);

        // A player could be found in cache if they leave and rejoin very quickly,
        // but they'll have a new and larger id than the last one.
        if (!foundPlayer || foundPlayer.id > player.id) {
          this.emit('playerDisconnected', player);
        }
      }

      this._players.cache = new Set(newPlayerList);

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

    try {
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
    } catch (err) {
      const error = new RCONError('Could not build packet', err);
      this.emit('error', error);
    }
  }

  private _heartbeat() {
    if (!this._connected) return;

    const lastResponseDelta = Date.now() - this._lastResponseTime.valueOf();
    const lastCommandDelta = Date.now() - this._lastCommandTime.valueOf();

    // Send out a command to keep connection alive.
    if (lastCommandDelta > 5_000) {
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

    this.emit('message', packet.data);

    if (!packet.data) return;

    if (/^[A-Z][A-Za-z]+ Log/.test(packet.data)) {
      // BELog
      const match = /^([A-Za-z]+) Log: #(\d+) .+ \(([a-z0-9]{32})\) - #(\d+) (.+)/s.exec(packet.data);

      if (!match) {
        const error = new RCONError('Could not parse belog', { message: packet.data });
        this.emit('error', error);
        return;
      }

      const [, type, playerId, guid, filterIndex, logdata] = match;

      const player = this._players.resolve(Number(playerId));

      if (!player && this.requirePlayerForLogs) {
        const error = new RCONError('Could not find player for belog', { id: playerId, message: packet.data });
        this.emit('error', error);
        return;
      }

      if (this.separateMessageTypes)
        this.emit('belog', {
          type,
          filter: Number(filterIndex),
          player,
          guid,
          data: logdata
        });
    }
  }
}
