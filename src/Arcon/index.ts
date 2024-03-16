import { createSocket, Socket } from 'dgram';
import { EventEmitter } from 'events';
import PacketManager from './Packets/PacketManager';
import { Packet, PacketTypes, PacketWithSequence } from './Packets/Packet';
import PlayerManager, { PlayerResolvable } from './Players/PlayerManager';
import Player from './Players/Player';

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
  MPEventHandler = 'MPEventHandler',
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

export enum MessageChannels {
  Global = 'Global',
  Side = 'Side',
  Command = 'Command',
  Group = 'Group',
  Direct = 'Direct',
  Vehicle = 'Vehicle',
  Unknown = 'Unknown'
}

export type ConnectionOptions = {
  autoReconnect?: boolean;
  ip: string;
  password: string;
  port: number;
};

export type DisconnectInfo =
  | {
      type: 'left';
      reason: null;
    }
  | {
      type: 'kicked';
      reason: string;
    };

export type PlayerMessageInfo = {
  channel: keyof typeof MessageChannels;
  message: string;
};

/**
 * @param 0 - Lobby status has changed
 * @param 1 - IP has been set
 */
type PlayerUpdateInfo = [boolean, boolean];

type Events = {
  connected: () => void;
  disconnected: (reason: string) => void;
  playerJoined: (player: Player) => void;
  playerLeft: (player: Player, info: DisconnectInfo) => void;
  playerUpdated: (player: Player, info: PlayerUpdateInfo) => void;
  playerMessage: (player: Player, info: PlayerMessageInfo) => void;
  beLog: (log: BELog) => void;
  error: (error: Error) => void;
};

interface IPlayerManager {
  players: Player[];
  resolve: (identifier: PlayerResolvable) => Player | null;
}

interface Identifier {
  id: number;
  name: string;
  ip: string;
}

export default interface Arcon {
  on<U extends keyof Events>(event: U, listener: Events[U]): this;

  once<U extends keyof Events>(event: U, listener: Events[U]): this;

  emit<U extends keyof Events>(event: U, ...args: Parameters<Events[U]>): boolean;
}

export default class Arcon extends EventEmitter implements Arcon {
  // Required fields
  public readonly ip: string;
  public readonly password: string;
  public readonly port: number;

  // Optional fields
  public readonly autoReconnect = false;

  // Private fields
  private readonly _packetManager: PacketManager;
  private readonly _playerManager: PlayerManager;

  private _socket: Socket;
  private _connectedAt: Date;
  private _currentCommandPacket: Buffer | null = null;
  private _commandPacketAttempts = 0;
  private _lastCommandReceived = 0;
  private _hasInitializedPlayers = false;
  private _connected = false;
  private _abortReconnection = false;
  private _running = false;
  private _lastSocketConnection = 0;

  private _joiningPlayers: Map<number, Identifier>;

  private _intervalHandle: NodeJS.Timer;

  constructor(options: ConnectionOptions) {
    super();

    Object.assign(this, options);

    this._packetManager = new PacketManager();
    this._playerManager = new PlayerManager();
  }

  public connect() {
    this._currentCommandPacket = null;
    this._commandPacketAttempts = 0;
    this._lastCommandReceived = 0;
    this._hasInitializedPlayers = false;
    this._joiningPlayers = new Map();

    this._packetManager.resetSequence();
    this._playerManager.clearPlayers();
    this._socket = createSocket('udp4');

    this._intervalHandle = setInterval(() => {
      this._sendCommandPacket();
      this._checkConnection();
    }, 1_000);

    this._socket.on('connect', () => this._login());
    this._socket.on('message', (data) => this._handleMessage(data));
    this._socket.on('error', (error) => this.emit('error', error));

    this._socket.connect(this.port, this.ip);

    this._running = true;
  }

  public disconnect() {
    this._disconnect('Manual disconnect', true);
  }

  public get playerManager(): IPlayerManager {
    const manager = this._playerManager;
    return {
      players: [...manager.players.values()],
      resolve: manager.resolve.bind(manager)
    };
  }

  public get abortReconnection() {
    return this._abortReconnection;
  }

  public set abortReconnection(value: boolean) {
    this._abortReconnection = value;
  }

  public sendCommand(data: string) {
    if (!this._connected) return;

    const buffer = this._packetManager.buildBuffer(PacketTypes.Command, data);

    this._socket.send(buffer);
  }

  private _disconnect(reason: string, abort = false) {
    if (this._intervalHandle) clearInterval(this._intervalHandle);

    if (!this._running) return;

    this._connected = false;
    this._running = false;

    this._socket.close();
    this._socket.removeAllListeners();

    if (abort) this._abortReconnection = true;

    this.emit('disconnected', reason);

    setTimeout(() => {
      this._attemptReconnection(reason);
    }, 5_000);
  }

  public get connectedAt() {
    return this._connectedAt ?? null;
  }

  private _attemptReconnection(disconnectReason: string) {
    if (disconnectReason === 'Invalid password' || this._abortReconnection) return;

    this.connect();
  }

  private _handleMessage(data: Buffer) {
    const type = this._packetManager.getPacketType(data);

    switch (type) {
      case PacketTypes.Login: {
        const packet = <Packet>this._packetManager.buildPacket(data);
        this._handleLoginPacket(packet);
        break;
      }

      case PacketTypes.Command: {
        const packet = <PacketWithSequence>this._packetManager.buildPacket(data);
        if (packet !== null) this._handleCommandPacket(packet);
        break;
      }

      case PacketTypes.ServerMessage: {
        const packet = <PacketWithSequence>this._packetManager.buildPacket(data);
        this._handleServerMessagePacket(packet);
        break;
      }
    }
  }

  private _login() {
    const callback = () => {
      clearTimeout(connectionTimeout);
      this._socket.removeListener('message', callback);
    };

    this._socket.prependListener('message', callback);

    const connectionTimeout = setTimeout(() => {
      this._socket.removeListener('message', callback);
      this._disconnect('Failed to connect to server');
    }, 5_000);

    const buffer = this._packetManager.buildBuffer(PacketTypes.Login, this.password);

    this._socket.send(buffer);
  }

  private _checkConnection() {
    if (!this._running) return;

    if (Date.now() - this._lastCommandReceived > 10_000 && this._connected) {
      this._disconnect('Connection timed out');
    }
  }

  private _sendCommandPacket() {
    if (!this._connected) return;

    if (this._currentCommandPacket) {
      if (this._commandPacketAttempts > 3) {
        this._disconnect('Failed to receive command response');
        return;
      }

      this._socket.send(this._currentCommandPacket);
      this._commandPacketAttempts++;

      return;
    }

    if (Date.now() - this._lastCommandReceived < 5_000) return;

    const buffer = this._packetManager.buildBuffer(PacketTypes.Command, 'players');

    this._currentCommandPacket = buffer;

    this._socket.send(buffer);
  }

  private _handleLoginPacket(packet: Packet) {
    if (packet.rawData[0] === 1) {
      const buffer = this._packetManager.buildBuffer(PacketTypes.Command, 'players');

      this._socket.send(buffer);

      this._connected = true;
      this._connectedAt = new Date();
      this._lastCommandReceived = Date.now();

      this.emit('connected');
    } else {
      this._disconnect('Invalid password');
    }
  }

  private _handleCommandPacket(packet: PacketWithSequence) {
    this._currentCommandPacket = null;
    this._commandPacketAttempts = 0;
    this._lastCommandReceived = Date.now();

    if (packet.data.length === 0) return;

    if (packet.data.startsWith('Players on server')) {
      const matches = packet.data.matchAll(
        /^(\d+) +((?:\d{1,3}(?:\.|)){4}):\d+ +([-\d]+) +([a-z0-9]{32})\(OK\) +(.+?)(?:(?: \((Lobby)\)$|$))/gm
      );

      if (!matches) return;

      for (const match of matches) {
        const [, idStr, ip, pingStr, guid, name, lobbyStr] = match;

        const id = Number(idStr);
        const lobby = lobbyStr === 'Lobby';

        const foundPlayer = this._playerManager.players.has(id);

        const ping = Number(pingStr);

        if (foundPlayer) {
          const player = this._playerManager.players.get(id);
          if (player) {
            const updatedFields: PlayerUpdateInfo = [lobby !== player.lobby, ip !== player.ip];

            player.lobby = lobby;
            player.ping = ping;
            player.ip = ip;

            if (updatedFields.some(Boolean)) this.emit('playerUpdated', player, updatedFields);
          }

          continue;
        }

        if (this._hasInitializedPlayers) continue;

        const player = new Player(id, guid, name, lobby, ip);

        this._playerManager.players.set(id, player);

        this.emit('playerJoined', player);
      }

      this._hasInitializedPlayers = true;
    }
  }

  private _handleServerMessagePacket(packet: PacketWithSequence) {
    const buffer = this._packetManager.buildBuffer(PacketTypes.ServerMessage, packet.sequence);

    const sendResponse = () => this._socket.send(buffer);

    if (/^Player #([0-9]+) (.+) \(((?:[0-9]{1,3}\.){3}[0-9]{1,3}):[0-9]+\) connected$/.test(packet.data)) {
      const match = /^Player #([0-9]+) (.+) \(((?:[0-9]{1,3}\.){3}[0-9]{1,3}):[0-9]+\) connected$/.exec(packet.data);

      if (!match) return sendResponse();

      const [, idStr, name, ip] = match;

      const identifier = { id: Number(idStr), name, ip };

      this._joiningPlayers.set(identifier.id, identifier);
    }

    if (/^Verified GUID/.test(packet.data)) {
      const match = /^Verified GUID \(([a-z0-9]{32})\) of player #(\d+) (.+)$/.exec(packet.data);

      if (!match) return sendResponse();

      const [, guid, id, name] = match;

      const player = new Player(Number(id), guid, name, true);

      const identifier = this._joiningPlayers.get(player.id);

      if (identifier) {
        player.ip = identifier.ip;
        this._joiningPlayers.delete(player.id);
      }

      this._playerManager.players.set(player.id, player);

      this.emit('playerJoined', player);
    }

    if (/^Player #\d+ .+ disconnected$/.test(packet.data)) {
      const match = /^Player #(\d+) .+ disconnected/.exec(packet.data);

      if (!match) return sendResponse();

      const [, idStr] = match;

      const id = Number(idStr);

      const player = this._playerManager.players.get(id);

      if (player) {
        this._playerManager.players.delete(id);

        this.emit('playerLeft', player, { type: 'left', reason: null });
      }
    }

    if (/^Player #\d+ .+ \([a-z0-9]{32}\) has been kicked by BattlEye:/.test(packet.data)) {
      const match = /^Player #(\d+) .+ \([a-z0-9]{32}\) has been kicked by BattlEye: (.+)/.exec(packet.data);

      if (!match) return sendResponse();

      const [, idStr, reason] = match;

      const id = Number(idStr);

      const player = this._playerManager.players.get(id);

      if (player) {
        this._playerManager.players.delete(id);

        this.emit('playerLeft', player, { type: 'kicked', reason });
      }
    }

    if (/^\(Global|Side|Command|Group|Direct|Vehicle|Unknown\) /.test(packet.data)) {
      const match = /^\((Global|Side|Command|Group|Direct|Vehicle|Unknown)\) (.+)$/.exec(packet.data);

      if (!match) return sendResponse();

      const [, channel, text] = match;

      const names = [...this._playerManager.players.values()]
        .map((player) => player.name)
        .sort((a, b) => b.length - a.length);

      const name = names.find((name) => text.startsWith(name));

      if (!name) return sendResponse();

      const player = [...this._playerManager.players.values()].find((player) => player.name === name);

      if (!player) return sendResponse();

      const channelStr = <MessageChannels>channel;

      this.emit('playerMessage', player, { channel: channelStr, message: text.slice(name.length + 2) });
    }

    if (/^[A-Z][A-Za-z]+ Log/.test(packet.data)) {
      const match = /^([A-Za-z]+) Log: #(\d+) .+ \(([a-z0-9]{32})\) - #(\d+) (.+)/s.exec(packet.data);

      if (!match) return sendResponse();

      const [, type, playerId, guid, filterIndex, data] = match;

      const player = this._playerManager.resolve(Number(playerId));

      if (!player) return sendResponse();

      this.emit('beLog', {
        type: <BELogTypes>type,
        filter: Number(filterIndex),
        player,
        guid,
        data
      });
    }

    sendResponse();
  }
}
