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
  private _lastCommandTime = 0;
  private _hasInitializedPlayers = false;

  constructor(options: ConnectionOptions) {
    super();

    Object.assign(this, options);

    this._socket = createSocket('udp4');
    this._packetManager = new PacketManager();
    this._playerManager = new PlayerManager();

    this._socket.on('connect', () => this._login());
    this._socket.on('message', (data) => this._handleMessage(data));

    setInterval(() => {
      this._heartbeat();
    }, 1_000);
  }

  public connect() {
    this._socket.connect(this.port, this.ip);
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
      this._socket.close();
      this._socket.removeListener('message', callback);
    }, 5_000);

    const buffer = this._packetManager.buildBuffer(PacketTypes.Login, this.password);

    this._socket.send(buffer);
  }

  private _heartbeat() {
    const lastCommandDelta = Date.now() - this._lastCommandTime;

    if (lastCommandDelta > 10_000) {
      const buffer = this._packetManager.buildBuffer(PacketTypes.Command, 'players');
      this._socket.send(buffer);

      this._lastCommandTime = Date.now();
    }
  }

  private _handleLoginPacket(packet: Packet) {
    if (packet.rawData[0] === 1) {
      const buffer = this._packetManager.buildBuffer(PacketTypes.Command, 'players');

      this._socket.send(buffer);
    }
  }

  private _handleCommandPacket(packet: PacketWithSequence) {
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
    }

    if (/^Player #\d+ .+ disconnected$/.test(packet.data)) {
      const match = /^Player #(\d+) .+ disconnected/.exec(packet.data);

      if (!match) return;

      const [, id] = match;

      this._playerManager._players.delete(Number(id));
    }

    if (/^Player #\d+ .+ \([a-z0-9]{32}\) has been kicked by BattlEye:/.test(packet.data)) {
      const match = /^Player #(\d+) .+ \([a-z0-9]{32}\) has been kicked/.exec(packet.data);

      if (!match) return;

      const [, id] = match;

      this._playerManager._players.delete(Number(id));
    }

    this._socket.send(buffer);
  }
}
