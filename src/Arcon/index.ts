import { BaseClient, ClientOptions } from './client';
import { ServerMessageError } from './error';
import { CommandPacketPart, Packet, PacketTypes } from './packet';
import { Player } from './player';

export interface ArconOptions extends ClientOptions {
  /** The interval for updating player data. Minimum 5000ms. */
  playerUpdateInterval?: number;
}

export interface BeLog {
  type: string;
  filter: number;
  log: string;
  guid: string;
  player?: Player;
}

const regexes = {
  playerConnected: /^Player #(\d+) (.+) \(([\d.]+):\d+\) connected$/,
  playerGuidCalculated: /^Player #(\d+) (.+) BE GUID: ([a-z0-9]{32})$/,
  playerGuidVerified: /^Verified GUID \([a-z0-9]{32}\) of player #(\d+) .+$/,
  playerDisconnected: /^Player #(\d+) (.+) disconnected$/,
  playerKicked: /^Player #(\d+) .+ \([a-z0-9]{32}\) has been kicked by BattlEye: (.+)$/,
  beLog: /^([a-zA-Z]+) Log: #(\d+) .+ \(([a-z0-9]{32})\) - #(\d+) (.+)$/,
  playerList: /^(\d+)\s+([\d.]+):\d+\s+([-0-9]+)\s+((?:[a-z0-9]){32})\((\?|OK)\)\s+(.+?)(?:(?: \((Lobby)\)$|$))/gm,
  playerMessage: /^\(([a-zA-Z]+)\) (.+)$/,
  adminMessage: /RCon admin #(\d+): \((.+?)\) (.+)$/
};

export declare interface Arcon {
  on(event: 'connected', listener: () => void): this;
  on(event: 'disconnected', listener: () => void): this;
  on(event: 'error', listener: (error: Error | ServerMessageError) => void): this;
  on(event: 'players', listener: (players: Player[]) => void): this;
  on(event: 'playerConnected', listener: (player: Player) => void): this;
  on(event: 'playerDisconnected', listener: (player: Player, reason: string) => void): this;
  on(event: 'playerUpdated', listener: (player: Player, changes: [boolean, boolean, boolean]) => void): this;
  on(event: 'beLog', listener: (log: BeLog) => void): this;
  on(event: 'playerMessage', listener: (player: Player, channel: string, message: string) => void): this;
  on(event: 'adminMessage', listener: (id: number, channel: string, message: string) => void): this;
}

export class Arcon extends BaseClient {
  private _connectingPlayers = new Map<number, { name: string; ip: string }>();

  /** Interval for sending commands to server. */
  private _commandProcessInterval: NodeJS.Timeout;

  /** Number of times we've sent the current command. */
  private _commandSendAttempts = 0;

  /** Timestamp of the last command send/rety. */
  private _commandSendTime: Date;

  /** List of all commands to process. */
  private _commandQueue: Packet[] = [];

  private _hasReceivedPlayers = false;

  /** Timestamp of the last command part received. */
  private _lastCommandPartReceivedAt: Date = new Date();

  /** List of all parts of the current command. */
  private _packetParts: CommandPacketPart[] = [];

  private _players: Player[] = [];

  /** Interval for updating player data. */
  private _playerUpdateInterval: NodeJS.Timeout;

  /** Time between player update requests. */
  private _playerUpdateIntervalTime: number;

  /** Whether we are currently processing a command. */
  private _waitingForResponse = false;

  constructor(options: ArconOptions) {
    super(options);

    this._playerUpdateIntervalTime = options.playerUpdateInterval ?? 5000;

    this.on('connected', () => {
      this.sendCommand('players');

      this._commandProcessInterval = setInterval(() => this._processCommandQueue(), 100);

      this._playerUpdateInterval = setInterval(() => {
        if (!this._connected) return;
        const playerUpdateQueued = this._commandQueue.some((packet) => packet.data?.toString() === 'players');

        if (!playerUpdateQueued) this.sendCommand('players');
      }, this._playerUpdateIntervalTime);
    });
  }

  /**
   * Closes the connection to the server.
   * @param abortReconnect - Whether to abort the reconnection process.
   */
  override close(abortReconnect: boolean) {
    clearInterval(this._commandProcessInterval);
    clearInterval(this._playerUpdateInterval);

    this._commandQueue = [];
    this._waitingForResponse = false;
    this._commandSendAttempts = 0;
    this._packetParts = [];

    this._players = [];
    this._connectingPlayers = new Map();
    this._hasReceivedPlayers = false;

    super.close(abortReconnect);
  }

  public get players() {
    return this._players;
  }

  /**
   * Adds a command to the queue to be sent to the server.
   * @param command Formatted command data.
   * @example arcon.sendCommand('reassign');
   * @example arcon.sendCommand('say -1 Hello Everyone');
   */
  public sendCommand(command: string) {
    const sequence = this._getSequence();

    const packet = Packet.create(PacketTypes.Command, Buffer.from(command), sequence);

    this._commandQueue.push(packet);
  }

  private _adminMessage(data: string) {
    const [_, idStr, channel, message] = data.match(regexes.adminMessage) ?? [];

    if (!idStr || !channel || !message) {
      const error = new ServerMessageError('Failed to parse message', 'adminMessage', data);
      this.emit('error', error);
      return;
    }

    const id = parseInt(idStr);

    this.emit('adminMessage', id, channel, message);
  }

  private _beLog(data: string) {
    const [_, type, idStr, guid, filterStr, log] = data.match(regexes.beLog) ?? [];

    if (!type || !idStr || !guid || !filterStr || !log) {
      const error = new ServerMessageError('Failed to parse message', 'beLog', data);
      this.emit('error', error);
      return;
    }

    const id = parseInt(idStr);
    const filter = parseInt(filterStr);

    const player = this._players.find((p) => p.id === id);

    const baseLog: BeLog = { type, filter, log, guid };

    // BE logs are important, so we'll emit them even if the player isn't found.
    if (!player) {
      // It may be better to not emit an error, or make a different event.
      const error = new ServerMessageError('Player not found', 'beLog', data);
      this.emit('error', error);

      this.emit('beLog', baseLog);
      return;
    }

    this.emit('beLog', { ...baseLog, player });
  }

  override _handleCommandPacket(packet: Packet | CommandPacketPart) {
    let commandPacket: Packet | null = null;

    if (packet instanceof CommandPacketPart) {
      this._lastCommandPartReceivedAt = new Date();
      this._packetParts.push(packet);

      if (packet.totalPackets === this._packetParts.length) {
        const sortedParts = this._packetParts.sort((a, b) => a.packetIndex - b.packetIndex);

        const data = Buffer.concat(sortedParts.map((part) => part.data));

        commandPacket = Packet.create(PacketTypes.Command, data, packet.sequence);
      }
    } else commandPacket = packet;

    // Ignore if we haven't received the full command yet.
    if (!commandPacket) return;

    // Ignore heartbeats.
    if (!this._commandQueue.some((x) => x.sequence === commandPacket!.sequence)) return;

    this._processCommand(commandPacket);

    // Free up the command queue.
    this._waitingForResponse = false;
    this._commandSendAttempts = 0;
    this._commandQueue.shift();
  }

  override _handleMessagePacket(packet: Packet): void {
    super._handleMessagePacket(packet);
    if (!this._hasReceivedPlayers || !packet.data) return;

    const data = packet.data.toString();

    // Player connected
    if (regexes.playerConnected.test(data)) return this._playerConnected(data);

    // Player guid calculated
    if (regexes.playerGuidCalculated.test(data)) return this._playerGuidCalculated(data);

    // Player guid verified
    if (regexes.playerGuidVerified.test(data)) return this._playerGuidVerified(data);

    // Player disconnected
    if (regexes.playerDisconnected.test(data)) return this._playerDisconnected(data);

    // Player kicked
    if (regexes.playerKicked.test(data)) return this._playerKicked(data);

    // BE log
    if (regexes.beLog.test(data)) return this._beLog(data);

    // Player message
    if (regexes.playerMessage.test(data)) return this._playerMessage(data);

    // RCon admin message
    if (regexes.adminMessage.test(data)) return this._adminMessage(data);
  }

  private _playerConnected(data: string) {
    const [_, idStr, name, ip] = data.match(regexes.playerConnected) ?? [];

    if (!idStr || !name || !ip) {
      const error = new ServerMessageError('Failed to parse message', 'playerConnected', data);
      this.emit('error', error);
      return;
    }

    const id = parseInt(idStr);

    this._connectingPlayers.set(id, { name, ip });
  }

  private _playerDisconnected(data: string) {
    const [_, idStr] = data.match(regexes.playerDisconnected) ?? [];

    if (!idStr) {
      const error = new ServerMessageError('Failed to parse message', 'playerDisconnected', data);
      this.emit('error', error);
      return;
    }

    const id = parseInt(idStr);

    const player = this._players.find((p) => p.id === id);

    if (!player) {
      if (this._connectingPlayers.has(id)) {
        this._connectingPlayers.delete(id);
        return;
      }

      const error = new ServerMessageError('Player not found', 'playerDisconnected', data);
      this.emit('error', error);
      return;
    }

    this._players = this._players.filter((p) => p.id !== id);

    this.emit('playerDisconnected', player, 'disconnected');
  }

  private _playerKicked(data: string) {
    const [_, idStr, reason] = data.match(regexes.playerKicked) ?? [];

    if (!idStr || !reason) {
      const error = new ServerMessageError('Failed to parse message', 'playerKicked', data);
      this.emit('error', error);
      return;
    }

    const id = parseInt(idStr);

    const player = this._players.find((p) => p.id === id);

    if (!player) {
      const error = new ServerMessageError('Player not found', 'playerKicked', data);
      this.emit('error', error);
      return;
    }

    this._players = this._players.filter((p) => p.id !== id);

    this.emit('playerDisconnected', player, reason);
  }

  private _playerGuidCalculated(data: string) {
    const [_, idStr, name, guid] = data.match(regexes.playerGuidCalculated) ?? [];

    if (!idStr || !name || !guid) {
      const error = new ServerMessageError('Failed to parse message', 'playerGuidCalculated', data);
      this.emit('error', error);
      return;
    }

    const id = parseInt(idStr);

    const playerInfo = this._connectingPlayers.get(id);

    if (!playerInfo) {
      const error = new ServerMessageError('Player not found', 'playerGuidCalculated', data);
      this.emit('error', error);
      return;
    }

    const player = new Player(guid, id, playerInfo.ip, playerInfo.name, -1, true, false);

    this._players.push(player);
  }

  private _playerGuidVerified(data: string) {
    const [_, idStr] = data.match(regexes.playerGuidVerified) ?? [];

    if (!idStr) {
      const error = new ServerMessageError('Failed to parse message', 'playerGuidVerified', data);
      this.emit('error', error);
      return;
    }

    const id = parseInt(idStr);

    const player = this._players.find((p) => p.id === id);

    if (!player) {
      const error = new ServerMessageError('Player not found', 'playerGuidVerified', data);
      this.emit('error', error);
      return;
    }

    if (this._connectingPlayers.has(id)) this._connectingPlayers.delete(id);

    player.verified = true;

    this.emit('playerConnected', player);
  }

  private _playerMessage(data: string) {
    const [_, channel, message] = data.match(regexes.playerMessage) ?? [];

    if (!channel || !message) {
      const error = new ServerMessageError('Failed to parse message', 'playerMessage', data);
      this.emit('error', error);
      return;
    }

    // Find all players that match the start of the message
    // and sort them by name length, longest name is best match.
    const matchingNames = this._players
      .filter((p) => message.startsWith(p.name))
      .sort((a, b) => b.name.length - a.name.length);

    if (matchingNames.length === 0) {
      const error = new ServerMessageError('Player not found', 'playerMessage', data);
      this.emit('error', error);
      return;
    }

    const player = matchingNames[0];

    const text = message.slice(player.name.length + 2);

    this.emit('playerMessage', player, channel, text);
  }

  private _processCommand(packet: Packet) {
    const data = packet.data!.toString();

    if (data.startsWith('Players on server:')) return this._processPlayerList(data);
  }

  private _processCommandQueue() {
    if (this._commandQueue.length === 0 || !this._connected) return;

    // We're free to send a new command.
    if (!this._waitingForResponse) {
      const packet = this._commandQueue[0];

      // Reset command counters.
      this._commandSendTime = new Date();
      this._waitingForResponse = true;
      this._commandSendAttempts++;
      this._packetParts = [];

      this._socket.send(packet.toBuffer());
    }

    // Server is unreachable.
    if (this._commandSendAttempts > 5) {
      this.emit('error', new Error('Command response timeout'));
      this.close(false);
      return;
    }

    // Resend command if the server hasn't replied.
    const timeSinceLastSend = Date.now() - this._commandSendTime.getTime();

    if (timeSinceLastSend < 4000) return;

    const timeSinceLastPacket = Date.now() - this._lastCommandPartReceivedAt.getTime();

    // Don't resend if we're still receiving parts of the command.
    if (timeSinceLastPacket < 500) return;

    this._commandSendAttempts++;
    this._commandSendTime = new Date();

    this._socket.send(this._commandQueue[0].toBuffer());
  }

  /**
   * Processes the list of players on the server.
   * @param data Raw data from the server.
   */
  private _processPlayerList(data: string) {
    const players = data.matchAll(regexes.playerList);

    for (const player of players) {
      const [_, idStr, ip, pingStr, guid, verifiedStr, name, lobbyStr] = player;

      const id = parseInt(idStr);
      const ping = parseInt(pingStr);
      const verified = verifiedStr === 'OK';
      const lobby = lobbyStr === 'Lobby';

      const existingPlayer = this._players.find((p) => p.id === id);

      // Update the player if they already exist.
      if (existingPlayer) {
        const changes = [
          existingPlayer.ping !== ping,
          existingPlayer.verified !== verified,
          existingPlayer.lobby !== lobby
        ];

        existingPlayer.lobby = lobby;
        existingPlayer.ping = ping;
        existingPlayer.verified = verified;

        if (changes.some((c) => c)) this.emit('playerUpdated', existingPlayer, changes);
        continue;
      }

      // Only add to players list if we haven't fetched them yet.
      if (!this._hasReceivedPlayers) this._players.push(new Player(guid, id, ip, name, ping, lobby, verified));
    }

    if (!this._hasReceivedPlayers) {
      this.emit('players', this._players);
      this._hasReceivedPlayers = true;
    }
  }
}
