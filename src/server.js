// src/server.js
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import {
  manager,
  initializeSonosEvents,
  allPlayers,
  allGroups,
  managedModelNames,
  playerState,
  play,
  pause,
  join,
  unjoin,
  getVolume,
  setVolume
} from './sonos.js';

console.log('Starting Sonos Dashboard Server...');

const app = express();
app.use(express.json());
app.use(express.static('public'));

function sendError(res, error, fallbackStatus = 500) {
  const status = /not found/i.test(error.message) ? 404 : fallbackStatus;
  console.error(error);
  res.status(status).json({ error: error.message });
}

function asyncRoute(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch(error => sendError(res, error));
  };
}

app.get('/api/config', (_, res) => {
  res.json({ managedModels: managedModelNames() });
});

app.get('/api/players', (_, res) => {
  res.json(allPlayers());
});

app.get('/api/groups', (_, res) => {
  res.json(allGroups());
});

app.get('/api/state', asyncRoute(async (_, res) => {
  const players = allPlayers();
  const states = await Promise.all(players.map(player => playerState(player.uuid)));
  res.json({
    players,
    groups: allGroups(),
    states
  });
}));

app.get('/api/:uuid/state', asyncRoute(async (req, res) => {
  res.json(await playerState(req.params.uuid));
}));

app.get('/api/:uuid/volume', asyncRoute(async (req, res) => {
  res.json({ volume: await getVolume(req.params.uuid) });
}));

app.post('/api/:uuid/volume/:vol', asyncRoute(async (req, res) => {
  await setVolume(req.params.uuid, req.params.vol);
  res.sendStatus(204);
}));

app.post('/api/:uuid/play', asyncRoute(async (req, res) => {
  await play(req.params.uuid);
  res.sendStatus(204);
}));

app.post('/api/:uuid/pause', asyncRoute(async (req, res) => {
  await pause(req.params.uuid);
  res.sendStatus(204);
}));

app.post('/api/:uuid/join/:to', asyncRoute(async (req, res) => {
  await join(req.params.uuid, req.params.to);
  res.sendStatus(204);
}));

app.post('/api/:uuid/unjoin', asyncRoute(async (req, res) => {
  await unjoin(req.params.uuid);
  res.sendStatus(204);
}));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', async socket => {
  console.log('New WebSocket client connected');

  try {
    const players = allPlayers();
    socket.send(JSON.stringify({ type: 'players', players }));
    socket.send(JSON.stringify({ type: 'groups', groups: allGroups() }));

    const states = await Promise.all(players.map(player => playerState(player.uuid)));
    states.forEach(state => {
      socket.send(JSON.stringify({ type: 'stateSnapshot', ...state }));
    });
  } catch (error) {
    socket.send(JSON.stringify({ type: 'error', error: error.message }));
  }
});

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, ...payload });
  wss.clients.forEach(client => {
    if (client.readyState === client.OPEN) client.send(msg);
  });
}

initializeSonosEvents(broadcast);

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`Dashboard on :${port}`);
  console.log(`Managing Sonos models: ${managedModelNames().join(', ')}`);
  console.log(`Total Sonos devices discovered: ${manager.Devices.length}`);
});
