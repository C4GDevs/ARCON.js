import { BaseClient, ClientOptions } from './client';
import { CommandPacketPart, Packet, PacketTypes } from './packet';
import { Player } from './player';

export interface ArconOptions extends ClientOptions {
  /** The interval for updating player data. Minimum 5000ms. */
  playerUpdateInterval?: number;
}

const regexes = {
  playerConnected: /^Player #(\d+) (.+) \(([\d\.]+):\d+\) connected$/,
  playerGuidCalculated: /^Player #(\d+) (.+) BE GUID: ([a-z0-9]{32})$/,
  playerGuidVerified: /^Verified GUID \([a-z0-9]{32}\) of player #(\d+) .+$/,
  playerDisconnected: /^Player #(\d+) (.+) disconnected$/,
  playerKicked: /^Player #(\d+) .+ \([a-z0-9]{32}\) has been kicked by BattlEye: (.+)$/,
  beLog: /^([a-zA-Z]+) Log: #(\d+) .+ \(([a-z0-9]{32})\) - #(\d+) (.+)$/,
  playerList: /^(\d+)\s+([\d\.]+):\d+\s+([-0-9]+)\s+((?:[a-z0-9]){32})\((\?|OK)\)\s+(.+?)(?:(?: \((Lobby)\)$|$))/gm
};

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
   */
  public sendCommand(command: string) {
    const sequence = this._getSequence();

    const packet = Packet.create(PacketTypes.Command, Buffer.from(command), sequence);

    this._commandQueue.push(packet);
  }

  private _beLog(data: string) {
    const [_, type, idStr, guid, filter, log] = data.match(regexes.beLog) ?? [];

    if (!type || !idStr || !guid || !filter) return;

    const id = parseInt(idStr);

    const player = this._players.find((p) => p.id === id);

    if (!player) return;

    this.emit('beLog', { type, player, filter, log });
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

    // Ignore heartbeat packets.
    if (!commandPacket || !commandPacket.data?.length) return;

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
  }

  private _playerConnected(data: string) {
    const [_, idStr, name, ip] = data.match(regexes.playerConnected) ?? [];

    if (!idStr || !name || !ip) return;

    const id = parseInt(idStr);

    this._connectingPlayers.set(id, { name, ip });
  }

  private _playerDisconnected(data: string) {
    const [_, idStr] = data.match(regexes.playerDisconnected) ?? [];

    if (!idStr) return;

    const id = parseInt(idStr);

    const player = this._players.find((p) => p.id === id);

    if (!player) return;

    this._players = this._players.filter((p) => p.id !== id);

    this.emit('playerDisconnected', player, 'disconnected');
  }

  private _playerKicked(data: string) {
    const [_, idStr, reason] = data.match(regexes.playerKicked) ?? [];

    if (!idStr || !reason) return;

    const id = parseInt(idStr);

    const player = this._players.find((p) => p.id === id);

    if (!player) return;

    this._players = this._players.filter((p) => p.id !== id);

    this.emit('playerDisconnected', player, reason);
  }

  private _playerGuidCalculated(data: string) {
    const [_, idStr, name, guid] = data.match(regexes.playerGuidCalculated) ?? [];

    if (!idStr || !name || !guid) return;

    const id = parseInt(idStr);

    const playerInfo = this._connectingPlayers.get(id);

    if (!playerInfo) return;

    const player = new Player(guid, id, playerInfo.ip, playerInfo.name, -1, true, false);

    this._players.push(player);
  }

  private _playerGuidVerified(data: string) {
    const [_, idStr] = data.match(regexes.playerGuidVerified) ?? [];

    if (!idStr) return;

    const id = parseInt(idStr);

    const player = this._players.find((p) => p.id === id);

    if (!player) return;

    player.verified = true;

    this.emit('playerConnected', player);
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
        const _changes = [
          existingPlayer.ping !== ping,
          existingPlayer.verified !== verified,
          existingPlayer.lobby !== lobby
        ];

        existingPlayer.lobby = lobby;
        existingPlayer.ping = ping;
        existingPlayer.verified = verified;

        if (_changes.some((c) => c)) this.emit('playerUpdated', existingPlayer, _changes);
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
