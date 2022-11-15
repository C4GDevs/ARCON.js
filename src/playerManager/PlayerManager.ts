import ARCon from '../client';
import Player from './Player';

/**
 * Data that resolves to a {@link Player} object. This can be:
 * * A Player object
 * * A BattlEye GUID
 * * An IP address
 */
export type PlayerResolvable = Player | string | number;

interface PlayerManagerFunctions {
  kick(player: Player, reason?: string): void;
  resolve(player: PlayerResolvable): Player | null;
  say(message: string, target: Player): void;
}

export interface IPlayerManager extends PlayerManagerFunctions {
  players: Player[];
}

export default class PlayerManager implements PlayerManagerFunctions {
  private readonly _arcon: ARCon;
  private _cache: Set<Player>;

  constructor(arcon: ARCon) {
    this._arcon = arcon;
    this._cache = new Set();
  }

  get cache() {
    return this._cache;
  }

  set cache(players: Set<Player>) {
    this._cache = players;
  }

  /**
   * Add a player to the cache.
   * @param player The player to add.
   */
  public add(player: Player) {
    this._cache.add(player);
  }

  /**
   * Kicks a player from the server.
   * @param player The player to kick.
   * @param reason Text to show the player.
   */
  kick = (player: Player, reason?: string) => {
    let text = `kick ${player.id}`;
    if (reason) text += ` ${reason}`;
    this._arcon.send(text);
  };

  /**
   * Removes a player from the cache.
   * @param player The player to remove.
   */
  public remove(player: Player) {
    this._cache.delete(player);
  }

  /**
   * Send a message to player.
   * @param message Text to display.
   * @param target Player to send message to.
   */
  say = (message: string, target: Player) => {
    const text = `say ${target.id} ${message}`;

    this._arcon.send(text);
  };

  /**
   * Resolves a {@link PlayerResolvable} to a {@link Player} object.
   *
   * @param player The player to find.
   * @returns A {@link Player} object if found, else `null`.
   *
   * @example
   * ```ts
   * const player = resolve("77.125.33.126");
   * ```
   */
  resolve = (player: PlayerResolvable): Player | null => {
    if (player instanceof Player) return player;

    const playerList = [...this._cache.values()];

    if (typeof player === 'number') return playerList.find((p) => p.id === player) || null;
    if (/^[0-9a-z]{32}$/.test(player)) return playerList.find((p) => p.guid === player) || null;
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(player)) return playerList.find((p) => p.ip === player) || null;

    return null;
  };
}
