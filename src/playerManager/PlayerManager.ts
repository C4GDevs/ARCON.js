import ARcon from '../client';
import Player from './Player';

type PlayerResolvable = Player | string | number;

export default class PlayerManager {
  private readonly _arcon: ARcon;
  private readonly _cache: Set<Player>;

  constructor(arcon: ARcon) {
    this._cache = new Set();
    this._arcon = arcon;
  }

  get cache() {
    return this._cache;
  }

  public add(player: Player) {
    this._cache.add(player);
  }

  public remove(player: Player) {
    this._cache.delete(player);
  }

  public resolve(player: PlayerResolvable) {
    if (player instanceof Player) return player;

    const playerList = [...this._cache];

    if (typeof player === 'number') return playerList.find((p) => p.id === player);
    if (/^[0-9a-z]{32}$/.test(player)) return playerList.find((p) => p.guid === player);
    if (/^(?>\d{1,3}\.){3}\d{1,3}$/.test(player)) return playerList.find((p) => p.ip === player);
  }
}
