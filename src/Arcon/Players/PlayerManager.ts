import Player from './Player';

export type PlayerResolvable = Player | number | string;

export default class PlayerManager {
  public readonly players: Map<number, Player> = new Map();

  public clearPlayers() {
    this.players.clear();
  }

  public resolve(identifier: PlayerResolvable): Player | null {
    if (identifier instanceof Player) return identifier;

    if (typeof identifier === 'string') {
      const playerList = [...this.players.values()];

      const targetProperty = /^[a-z0-9]{32}$/.test(identifier) ? 'guid' : 'name';

      const player = playerList.find((player) => player[targetProperty] === identifier);
      if (player) return player;
    }

    if (typeof identifier === 'number') {
      const player = this.players.get(identifier);
      if (player) return player;
    }

    return null;
  }
}
