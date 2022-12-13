import Player from './Player';

export default class PlayerManager {
  public readonly _players: Map<number, Player> = new Map();

  public clearPlayers() {
    this._players.clear();
  }
}
