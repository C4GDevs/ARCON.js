# arcon.js [![](https://img.shields.io/npm/v/arcon.js?maxAge=3600)](https://npmjs.com/package/arcon.js) [![install size](https://packagephobia.com/badge?p=arcon.js)](https://packagephobia.com/result?p=arcon.js) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## About
arcon.js is a lightweight RCON client for connecting to ARMA III servers.

## Installation
arcon.js is available via [npm](https://npmjs.org/package/arcon.js).
```
npm install arcon.js
```

## Usage
To connect to an RCON server, you must create an Arcon instance. This can be done by using the class constructor with the necessary connection properties.
```ts
import Arcon, { ConnectionOptions } from 'arcon.js';

const options: ConnectionOptions = {
  ip: '127.0.0.1',
  port: 2312,
  password: 'password',
  heartbeatInterval: 10000 // Optional, default 5000ms
};

const arcon = new Arcon(options);

arcon.on('error', (err) => {
  console.error(err);
});

arcon.on('connected', () => {
  console.log('Connected!');
});

arcon.start();
```

Once connected, the instance will begin emitting different events such as `playerJoin` or `playerLeave`.
