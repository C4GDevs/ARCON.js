import ArconError from './ArconError';
import { BaseClient, ClientOptions } from './client';
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
  // Server messages
  playerConnected: /^Player #(\d+) (.*) \(([\d.]+):\d+\) connected$/,
  playerGuidCalculated: /^Player #(\d+) (.*) BE GUID: ([a-z0-9]{32})$/,
  playerGuidVerified: /^Verified GUID \(([a-z0-9]{32})\) of player #(\d+) (.*)$/,
  playerDisconnected: /^Player #(\d+) (.*) disconnected$/,
  playerKicked: /^Player #(\d+) (.*) \((?:[a-z0-9]{32}|-)\) has been kicked by BattlEye: (.+)$/,
  beLog: /^([a-zA-Z ]+) Log: #(\d+) (.*) \(([a-z0-9]{32})\) - #(\d+) (.+)$/s,
  playerMessage: /^\(([a-zA-Z]+)\) (.+)$/,
  adminMessage: /RCon admin #(\d+): \((.+?)\) (.+)$/,
  banCheckTimeout: /Ban check timed out, no response from BE Master/,
  masterQueryTimeout: /Master query timed out, no response from BE Master/,
  connectedToBeMaster: /Connected to BE Master/,
  disconnectedFromBeMaster: /Disconnected from BE Master/,
  connectionFailedBeMaster: /Could not connect to BE Master/,
  beMasterFailedToReceive: /Failed to receive from BE Master \(.+\)/,
  unknownCommand: /Unknown command/,
  filterKickDisabled: /Warning: Disabled kicking for (.+) scans. (.+)/i,
  eventLogError: /Failed to open event log file/,

  // Command responses
  playerList:
    /^(\d+)\s+([\d.]+):\d+\s+([-0-9]+)\s+((?:[a-z0-9]){32}|-)(?:\((\?|OK)\)|)\s+(.+?)(?:(?: \((Lobby)\)$|$))/gm,
  missions: /(.+\.pbo$)/gm,
};

export declare interface Arcon {
  on(event: 'connected', listener: () => void): this;
  on(event: 'disconnected', listener: (reason: string, abortReconnect: boolean) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'players', listener: (players: Player[]) => void): this;
  on(event: 'missions', listener: (missions: string[]) => void): this;
  on(event: 'playerConnected', listener: (player: Player) => void): this;
  on(event: 'playerDisconnected', listener: (player: Player, reason: string) => void): this;
  on(event: 'playerUpdated', listener: (player: Player, changes: [boolean, boolean, boolean]) => void): this;
  on(event: 'beLog', listener: (log: BeLog) => void): this;
  on(event: 'playerMessage', listener: (player: Player, channel: string, message: string) => void): this;
  on(event: 'adminMessage', listener: (id: number, channel: string, message: string) => void): this;
}

export class Arcon extends BaseClient {
  private _ready = false;

  private _players: Map<number, Player> = new Map();
  private _connectingPlayers: Map<number, Pick<Player, 'id' | 'ip' | 'name'> & { guid?: string }> = new Map();
  private _playerUpdateRate: number;
  private _playerUpdateInterval: NodeJS.Timeout;

  private _lastCommandSentAt: Date | null = null;
  private _commandQueueInterval: NodeJS.Timeout;
  private _commandQueue: string[] = [];
  private _packetParts: CommandPacketPart[] = [];
  private _waitingForCommandResponse = false;

  constructor(options: ArconOptions) {
    super(options);

    this._playerUpdateRate = options.playerUpdateInterval ?? 5000;

    this.prependListener('connected', () => {
      this._commandQueueInterval = setInterval(() => {
        this._processCommandQueue();
      }, 500);

      this._playerUpdateInterval = setInterval(() => {
        if (!this._commandQueue.includes('players')) this.sendCommand('players');
      }, this._playerUpdateRate);

      this.sendCommand('players');
    });
  }

  override close(reason?: string, abortReconnect?: boolean) {
    this._players = new Map();
    this._connectingPlayers = new Map();
    this._packetParts = [];
    this._commandQueue = [];
    this._waitingForCommandResponse = false;
    this._ready = false;

    clearInterval(this._playerUpdateInterval);
    clearInterval(this._commandQueueInterval);

    return super.close(reason, abortReconnect);
  }

  public get players() {
    return this._players;
  }

  /**
   * Sends a command to the server.
   * @param command Formatted command data.
   * @example arcon.sendCommand('reassign');
   * @example arcon.sendCommand('say -1 Hello Everyone');
   */
  public sendCommand(command: string) {
    this._commandQueue.push(command);
  }

  private static _getMessageType(message: string): keyof typeof regexes | undefined {
    for (const [type, regex] of Object.entries(regexes)) {
      const re = new RegExp(regex);
      if (re.test(message)) {
        return type as keyof typeof regexes;
      }
    }
  }

  protected override _handleCommandPacket(packet: Packet | CommandPacketPart) {
    super._handleCommandPacket(packet);

    let commandPacket: Packet | null = null;

    if (packet instanceof CommandPacketPart) {
      const duplicatePart = this._packetParts.some(
        (part) => packet.sequence === part.sequence && packet.packetIndex === part.packetIndex,
      );

      if (duplicatePart) return;

      this._packetParts.push(packet);

      // Get parts for current sequence
      const parts = this._packetParts.filter((part) => packet.sequence === part.sequence);

      if (packet.totalPackets === parts.length) {
        const sortedParts = parts.sort((a, b) => a.packetIndex - b.packetIndex);

        const data = Buffer.concat(sortedParts.map((part) => part.data));

        commandPacket = Packet.create(PacketTypes.Command, data, packet.sequence);
      }
    } else {
      commandPacket = packet;
    }

    if (!commandPacket || !commandPacket.data || !commandPacket.data.length) return;

    this._waitingForCommandResponse = false;

    this._lastCommandSentAt = null;
    this._commandQueue.shift();

    this._packetParts = [];

    const commandPacketData = commandPacket.data.toString();

    // Early check for player list
    if (commandPacketData.startsWith('Players on server:')) {
      this._playerList(commandPacketData);
      return;
    }

    if (commandPacketData.startsWith('Missions on server:')) {
      this._missions(commandPacketData);
      return;
    }

    this.emit('error', new Error(`Unsupported command type: ${commandPacket.data}`));
  }

  override _handleMessagePacket(packet: Packet) {
    super._handleMessagePacket(packet);

    if (super.hasSeenSequenceId(packet.sequence)) {
      return;
    }

    super.handleSequenceId(packet.sequence);

    if (!packet.data) return;

    const data = packet.data.toString();

    // Ignore rcon admins logging in
    if ((data.startsWith('RCon admin') && data.endsWith('logged in')) || !this._ready) return;

    const type = Arcon._getMessageType(data);

    if (!type) {
      // Only error on non-empty error messages
      if (data) {
        this.emit('error', new Error(`Unknown message type: ${data}`));
      }

      return;
    }

    switch (type) {
      case 'playerConnected':
        this._playerConnected(data);
        break;

      case 'playerGuidCalculated':
        this._playerGuidCalculated(data);
        break;

      case 'playerGuidVerified':
        this._playerGuidVerified(data);
        break;

      case 'playerDisconnected':
        this._playerDisconnected(data);
        break;

      case 'playerKicked':
        this._playerKicked(data);
        break;

      case 'beLog':
        this._beLog(data);
        break;

      case 'playerMessage':
        this._playerMessage(data);
        break;

      case 'adminMessage':
        this._adminMessage(data);
        break;

      // Emit error event for generic RCON errors
      case 'masterQueryTimeout':
      case 'banCheckTimeout':
      case 'beMasterFailedToReceive':
      case 'connectionFailedBeMaster':
      case 'disconnectedFromBeMaster':
      case 'eventLogError':
      case 'filterKickDisabled':
        this.emit('error', new ArconError(`RCON error: ${data}`));
        break;
    }
  }

  // Initial connection of player
  private _playerConnected(data: string) {
    const re = new RegExp(regexes.playerConnected);

    const match = data.match(re);

    if (!match) {
      this.emit('error', new ArconError(`Could not parse 'playerConnected' event: ${data}`));
      return;
    }

    const [, idStr, name, ip] = match;

    const id = parseInt(idStr);

    this._connectingPlayers.set(id, { id, ip, name });
  }

  // First time player GUID is available
  private _playerGuidCalculated(data: string) {
    const re = new RegExp(regexes.playerGuidCalculated);
    const match = data.match(re);

    if (!match) {
      this.emit('error', new ArconError("Could not parse 'playerGuidCalculated' event", data));
      return;
    }

    const [, idStr, , guid] = match;

    const id = parseInt(idStr);

    const connectingPlayer = this._connectingPlayers.get(id);

    // Race condition check
    const alreadyConnected = this._players.get(id);

    if (alreadyConnected && alreadyConnected.guid === guid) {
      this._connectingPlayers.delete(id);
      return;
    }

    if (!connectingPlayer) {
      // Will be picked up by playerlist
      // this.emit('error', new ArconError(`playerGuidCalculated: Player #${id} not found.`, data));
      return;
    }

    // Extend object with guid and update map
    this._connectingPlayers.set(id, { ...connectingPlayer, guid });
  }

  // First time player GUID is available and reliable
  private _playerGuidVerified(data: string) {
    const re = new RegExp(regexes.playerGuidVerified);
    const match = data.match(re);

    if (!match) {
      this.emit('error', new ArconError("Could not parse 'playerGuidVerified' event", data));
      return;
    }

    const [, guid, idStr] = match;

    const id = parseInt(idStr);

    const connectingPlayer = this._connectingPlayers.get(id);
    const player = this._players.get(id);

    if (!connectingPlayer && !player) {
      // Will be picked up by playerlist
      // this.emit('error', new ArconError(`playerGuidVerified: Player #${id} not found.`, data));
      return;
    }

    // If connecting, always overwrite
    if (connectingPlayer) {
      const newPlayer = new Player(
        guid,
        connectingPlayer.id,
        connectingPlayer.ip,
        connectingPlayer.name,
        0,
        true,
        true,
      );

      this._connectingPlayers.delete(id);
      this._players.set(newPlayer.id, newPlayer);
      this.emit('playerConnected', newPlayer);

      return;
    }

    // If connected, but unverified
    if (player && player.guid === guid && !player.verified) {
      player.verified = true;

      this.emit('playerConnected', player);
    }
  }

  // Player disconnected
  private _playerDisconnected(data: string) {
    // Ignore disconnects when Arcon isn't ready, as we don't have any player identifiers to match on yet
    if (!this._ready) return;

    const re = new RegExp(regexes.playerDisconnected);
    const match = data.match(re);

    if (!match) {
      this.emit('error', new ArconError("Could not parse 'playerDisconnected' event", data));
      return;
    }

    const [, idStr] = match;

    const id = parseInt(idStr);

    const player = this._players.get(id);

    if (!player) {
      if (this._connectingPlayers.has(id)) {
        this._connectingPlayers.delete(id);
        return;
      }

      this.emit('error', new ArconError(`playerDisconnected: Player #${id} not found.`, data));
      return;
    }

    this._players.delete(id);

    this.emit('playerDisconnected', player, 'disconnected');
  }

  // Player was kicked
  private _playerKicked(data: string) {
    const re = new RegExp(regexes.playerKicked);
    const match = data.match(re);

    if (!match) {
      this.emit('error', new ArconError("Could not parse 'playerKicked' event", data));
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [, idStr, _name, reason] = match;

    const id = parseInt(idStr);

    const player = this._players.get(id);

    if (!player) {
      const connectingPlayer = this._connectingPlayers.get(id);

      if (connectingPlayer) {
        this._connectingPlayers.delete(id);
        return;
      }

      this.emit('error', new ArconError(`playerKicked: Player #${id} not found.`, data));
      return;
    }

    this._players.delete(id);

    this.emit('playerDisconnected', player, reason);
  }

  // BattlEye log message
  private _beLog(data: string) {
    const re = new RegExp(regexes.beLog, 's');
    const match = data.match(re);

    if (!match) {
      this.emit('error', new ArconError("Could not parse 'beLog' event", data));
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [, type, idStr, _name, guid, filterStr, log] = match;

    const id = parseInt(idStr);

    const player = this._players.get(id);

    if (!player) this.emit('error', new ArconError(`beLog: Player #${id} not found.`, data));

    const filter = parseInt(filterStr);

    const beLog: BeLog = {
      type,
      filter,
      log,
      guid,
      player,
    };

    this.emit('beLog', beLog);
  }

  private _playerList(data: string) {
    const re = new RegExp(regexes.playerList, 'gm');
    const players = [...data.matchAll(re)];

    for (const player of players) {
      const [, idStr, ip, pingStr, guid, verifiedStr, name, lobbyStr] = player;

      const id = parseInt(idStr);
      const ping = parseInt(pingStr);
      const verified = verifiedStr === 'OK';
      const lobby = lobbyStr === 'Lobby';

      const existingPlayer = this._players.get(id);
      const connectingPlayer = this._connectingPlayers.get(id);

      // If verified, add player early
      if (!existingPlayer && verified) {
        const newPlayer = new Player(guid, id, ip, name, ping, lobby, verified);

        this._players.set(id, newPlayer);
        this._connectingPlayers.delete(id);

        continue;
      }

      // If unverified and not connecting, add to connecting
      if (guid === '-' && !connectingPlayer) {
        this._connectingPlayers.set(id, { id, ip, name, guid });
        continue;
      }

      // If existing, check for changes
      if (existingPlayer) {
        const changes = [
          existingPlayer.ping !== ping,
          existingPlayer.lobby !== lobby,
          existingPlayer.verified !== verified,
        ];

        if (changes.some((c) => c)) {
          existingPlayer.ping = ping;
          existingPlayer.lobby = lobby;
          existingPlayer.verified = verified;

          this.emit('playerUpdated', existingPlayer, changes);
        }
      }
    }

    this.emit('players', [...this._players.values()]);

    // Arcon is only ready for use after first player list fetch
    if (!this._ready) {
      this._ready = true;
    }
  }

  private _missions(data: string) {
    const re = new RegExp(regexes.missions, 'gm');
    const missions = [...data.matchAll(re)].map((m) => m[1]);

    this.emit('missions', missions);
  }

  // Player sends a message
  private _playerMessage(data: string) {
    const re = new RegExp(regexes.playerMessage);
    const match = data.match(re);

    if (!match) {
      this.emit('error', new ArconError("Could not parse 'playerMessage' event", data));
      return;
    }

    const [, channel, message] = match;

    // Find all players that match the start of the message
    // and sort them by name length, longest name is best match.
    const machingPlayers = [...this._players.values()]
      .filter((p) => message.startsWith(p.name))
      .sort((a, b) => b.name.length - a.name.length);

    // Check for unverified connecting players as a backup
    if (machingPlayers.length === 0) {
      const [connectingMatch] = [...this._connectingPlayers.values()]
        .filter((p) => !!p.guid && message.startsWith(p.name))
        .sort((a, b) => b.name.length - a.name.length);

      if (connectingMatch && connectingMatch.guid) {
        const unverifiedPlayer = new Player(
          connectingMatch.guid,
          connectingMatch.id,
          connectingMatch.ip,
          connectingMatch.name,
          0,
          true,
          false,
        );

        machingPlayers.push(unverifiedPlayer);
      }
    }

    if (machingPlayers.length === 0) {
      this.emit('error', new ArconError(`playerMessage: No player found for message: ${message}`, data));
      return;
    }

    const player = machingPlayers[0];

    const text = message.slice(player.name.length + 2);

    this.emit('playerMessage', player, channel, text);
  }

  // RCon admin sends a message
  private _adminMessage(data: string) {
    const re = new RegExp(regexes.adminMessage);
    const match = data.match(re);

    if (!match) {
      this.emit('error', new ArconError("Could not parse 'adminMessage' event", data));
      return;
    }

    const [, idStr, channel, message] = match;

    const id = parseInt(idStr);

    this.emit('adminMessage', id, channel, message);
  }

  private _processCommandQueue() {
    if (this._waitingForCommandResponse) {
      if (this._lastCommandSentAt && Date.now() - this._lastCommandSentAt.getTime() > 5000) {
        this._packetParts = [];
        this._waitingForCommandResponse = false;
      }

      return;
    }

    const command = this._commandQueue.at(0);

    if (!command) return;

    this._waitingForCommandResponse = true;
    this._lastCommandSentAt = new Date();

    const packet = Packet.create(PacketTypes.Command, Buffer.from(command), this._getSequence());

    this._send(packet.toBuffer());
  }
}
