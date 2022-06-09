import Player from './Player';

/**
 * Data that resolves to a {@link Player} object. This can be:
 * * A Player object
 * * A BattlEye GUID
 * * An IP address
 */
type PlayerResolvable = Player | string | number;

export default class PlayerManager {
  private readonly _cache: Set<Player>;

  constructor() {
    this._cache = new Set();
  }

  get cache() {
    return this._cache;
  }

  /**
   * Add a player to the cache.
   * @param player The player to add.
   */
  public add(player: Player) {
    this._cache.add(player);
  }

  /**
   * Removes a player from the cache.
   * @param player The player to remove.
   */
  public remove(player: Player) {
    this._cache.delete(player);
  }

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
  public resolve(player: PlayerResolvable): Player | null {
    if (player instanceof Player) return player;

    const playerList = [...this._cache];

    if (typeof player === 'number') return playerList.find((p) => p.id === player) || null;
    if (/^[0-9a-z]{32}$/.test(player)) return playerList.find((p) => p.guid === player) || null;
    if (/^(?>\d{1,3}\.){3}\d{1,3}$/.test(player)) return playerList.find((p) => p.ip === player) || null;

    return null;
  }
}
