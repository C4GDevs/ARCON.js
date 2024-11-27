# ARCON.js [![](https://img.shields.io/npm/v/arcon.js?maxAge=3600)](https://npmjs.com/package/arcon.js) [![install size](https://packagephobia.com/badge?p=arcon.js)](https://packagephobia.com/result?p=arcon.js) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Tests](https://github.com/C4GDevs/ARCON.js/actions/workflows/test.yml/badge.svg?branch=v5.x&event=push)](https://github.com/C4GDevs/ARCON.js/actions/workflows/test.yml)

ARCON.js is a lightweight, event-based RCON client for Arma III servers designed to be reliable and easy to use.

## Installation

ARCON.js can be installed via [npm](https://www.npmjs.com/package/arcon.js) using `npm install arcon.js`

## Usage

An RCON connection can be established by instantiating the `Arcon` class and calling the `connect` function.

#### Arcon constructor properties

| Property             | Description                                                                     | type   | required | default |
| -------------------- | ------------------------------------------------------------------------------- | ------ | -------- | ------- |
| host                 | The hostname/IP address of the RCON server.                                     | string | true     |         |
| port                 | The port of the RCON server.                                                    | number | true     |         |
| password             | The password of the RCON server.                                                | string | true     |         |
| autoReconnect        | Whether to automatically reconnect on disconnects. Excludes incorrect password. | bool   | false    | true    |
| playerUpdateInterval | Time (in ms) between sending a `players` command to the server.                 | number | false    | 5000    |

```ts
import { Arcon } from 'arcon.js';

const connection = new Arcon({
  host: '127.0.0.1',
  port: 2312,
  password: '12345'
});

connection.connect();
```

### Events

Being an event-based library, there are multiple events that you can subscribe to. A list of all events can be found [here](../src/Arcon/index.ts#L29).
Note that if you do not add a listener to the `error` event, your application will crash if an error is ever created.

```ts
import { Arcon, Player, BeLog } from 'arcon.js';

const connection = new Arcon({
  host: '127.0.0.1',
  port: 2312,
  password: '12345'
});

connection.on('connected', () => {
  console.log('Connected!');
});

connection.on('disconnected', () => {
  console.log('Disconnected!');
});

connection.on('error', (error: Error) => {
  console.error(error);
});

connection.on('players', (players: Player[]) => {
  console.log(players);
});

connection.on('playerConnected', (player: Player) => {
  console.log(player);
});

connection.on('playerDisconnected', (player: Player, reason: string) => {
  // If a player disconnects by themself, reason is "disconnected".
  // Otherwise it will be parsed from text.
  console.log(player, reason);
});

connection.on(
  'playerUpdated',
  (player: Player, [pingUpdate, verifiedUpdate, lobbyUpdate]: [boolean, boolean, boolean]) => {
    if (pingUpdate) console.log(player.ping);
  }
);

connection.on('beLog', (log: BeLog) => {
  console.log(log);
});

connection.on('playerMessage', (player: Player, channel: string, message: string) => {
  console.log(`(${channel}) ${player.name}: ${message}`);
});

connection.on('adminMessage', (id: number, channel: string, message: string) => {
  console.log(id, channel, message);
});

connection.connect();
```
