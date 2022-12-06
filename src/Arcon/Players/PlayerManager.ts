import Player from './Player';

export default class PlayerManager {
  public readonly _players: Map<number, Player> = new Map();
}
