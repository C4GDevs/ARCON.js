import { createSocket, Socket } from 'dgram';
import { EventEmitter } from 'stream';
import PacketManager from './Packets/PacketManager';
import { Packet, PacketTypes, PacketWithSequence } from './Packets/Packet';
import PlayerManager from './Players/playerManager';
import Player from './Players/Player';

interface ConnectionOptions {
  autoReconnect?: boolean;
  ip: string;
  password: string;
  port: number;
}

type DisconnectInfo =
  | {
      type: 'left';
      reason: null;
    }
  | {
      type: 'kicked';
      reason: string;
    };

export default interface Arcon {
  on(event: 'connected', listener: () => void): this;
  on(event: 'disconnected', listener: (reason: string) => void): this;
  on(event: 'playerConnected', listener: (player: Player) => void): this;
  on(event: 'playerDisconnected', listener: (player: Player, info: DisconnectInfo) => void): this;
}

export default class Arcon extends EventEmitter {
  // Required fields
  public readonly ip: string;
  public readonly password: string;
  public readonly port: number;

  // Optional fields
  public readonly autoReconnect = false;

  // Private fields
  private readonly _socket: Socket;
  private readonly _packetManager: PacketManager;
  private readonly _playerManager: PlayerManager;

  private _currentCommandPacket: Buffer | null = null;
  private _commandPacketAttempts = 0;
  private _lastCommandReceived = 0;
  private _hasInitializedPlayers = false;
  private _connected = false;

  constructor(options: ConnectionOptions) {
    super();

    Object.assign(this, options);

    this._socket = createSocket('udp4');
    this._packetManager = new PacketManager();
    this._playerManager = new PlayerManager();

    this._socket.on('connect', () => this._login());
    this._socket.on('message', (data) => this._handleMessage(data));

    setInterval(() => {
      this._sendCommandPacket();
      this._checkConnection();
    }, 1_000);
  }

  public connect() {
    this._currentCommandPacket = null;
    this._commandPacketAttempts = 0;
    this._lastCommandReceived = 0;
    this._hasInitializedPlayers = false;

    this._packetManager.resetSequence();

    this._socket.connect(this.port, this.ip);
  }

  private _disconnect(reason: string) {
    this._socket.disconnect();
    this._connected = false;

    this.emit('disconnected', reason);

    if (this.autoReconnect) this._attemptReconnection(reason);
  }

  private _attemptReconnection(disconnectReason: string) {
    if (disconnectReason === 'Invalid password') return;
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
        const packet = <PacketWithSequence | null>this._packetManager.buildPacket(data);
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
    const callback = () => clearTimeout(connectionTimeout);

    this._socket.prependListener('message', callback);

    const connectionTimeout = setTimeout(() => {
      this._socket.removeListener('message', callback);
      this._disconnect('Failed to connect to server');
    }, 5_000);

    const buffer = this._packetManager.buildBuffer(PacketTypes.Login, this.password);

    this._socket.send(buffer);
  }

  private _checkConnection() {
    if (!this._connected) return;

    if (Date.now() - this._lastCommandReceived > 10_000) {
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
        /^(\d+) +((?:\d{1,3}(?:\.|)){4}):\d+ +[-\d]+ +([a-z0-9]{32})\(OK\) +(.+?)(?:(?: \((Lobby)\)$|$))/gm
      );

      if (!matches) return;

      for (const match of matches) {
        const [, idStr, _ip, guid, name, lobbyStr] = match;

        const id = Number(idStr);
        const lobby = lobbyStr === 'Lobby';

        const foundPlayer = this._playerManager._players.has(id);

        if (foundPlayer) {
          const player = this._playerManager._players.get(id);
          if (player) player.lobby = lobby;

          continue;
        }

        if (this._hasInitializedPlayers) continue;

        const player = new Player(id, guid, name, lobby);

        this._playerManager._players.set(id, player);

        this.emit('playerConnected', player);
      }

      this._hasInitializedPlayers = true;
    }
  }

  private _handleServerMessagePacket(packet: PacketWithSequence) {
    const buffer = this._packetManager.buildBuffer(PacketTypes.ServerMessage, packet.sequence);

    if (/^Verified GUID/.test(packet.data)) {
      const match = /^Verified GUID \(([a-z0-9]{32})\) of player #(\d+) (.+)$/.exec(packet.data);

      if (!match) return;

      const [, guid, id, name] = match;

      const player = new Player(Number(id), guid, name, true);

      this._playerManager._players.set(player.id, player);

      this.emit('playerConnected', player);
    }

    if (/^Player #\d+ .+ disconnected$/.test(packet.data)) {
      const match = /^Player #(\d+) .+ disconnected/.exec(packet.data);

      if (!match) return;

      const [, idStr] = match;

      const id = Number(idStr);

      const player = this._playerManager._players.get(id);

      if (player) {
        this._playerManager._players.delete(id);

        this.emit('playerDisconnected', player, { type: 'left', reason: null });
      }
    }

    if (/^Player #\d+ .+ \([a-z0-9]{32}\) has been kicked by BattlEye:/.test(packet.data)) {
      const match = /^Player #(\d+) .+ \([a-z0-9]{32}\) has been kicked by BattlEye: (.+)/.exec(packet.data);

      if (!match) return;

      const [, idStr, , reason] = match;

      const id = Number(idStr);

      const player = this._playerManager._players.get(id);

      if (player) {
        this._playerManager._players.delete(id);

        this.emit('playerDisconnected', player, { type: 'kicked', reason });
      }
    }

    this._socket.send(buffer);
  }
}
