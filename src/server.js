// src/server.js
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import {
  manager,
  initializeSonosEvents,
  allPlayers,
  allGroups,
  play,
  pause,
  join,
  unjoin,
  getVolume,
  setVolume
} from './sonos.js';

console.log('Starting Sonos Dashboard Server...');

const app  = express();
app.use(express.static('public'));

// Route to get all Sonos players
app.get('/api/players', (_, res) => {
  console.log(`/api/players → allPlayers()`);
  res.json(allPlayers());
});

// Route to get all Sonos groups
app.get('/api/groups', (_, res) => {
  console.log(`/api/groups → allGroups()`);
  res.json(allGroups());
});

// Route to play a specific Sonos player by UUID
app.post('/api/:uuid/play',  (req,res)=> {
  console.log(`/api/${req.params.uuid}/play`);
  play(req.params.uuid).then(()=>res.sendStatus(204));
});

// Route to pause a specific Sonos player by UUID
app.post('/api/:uuid/pause', (req,res)=> {
  console.log(`/api/${req.params.uuid}/pause`);
  pause(req.params.uuid).then(()=>res.sendStatus(204));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', async socket => {
  console.log('New WebSocket client connected');

  const players = allPlayers();

  for (const p of players) {
    const vol = await getVolume(p.uuid);
    socket.send(JSON.stringify({ type: 'volume', uuid: p.uuid, volume: vol }));

    const device = manager.Devices.find(d => d.uuid === p.uuid);
    if (device) {
      socket.send(JSON.stringify({ type: 'muted', uuid: p.uuid, muted: device.Muted }));
      socket.send(JSON.stringify({ type: 'state', uuid: p.uuid, state: device.CurrentTransportStateSimple }));
      socket.send(JSON.stringify({ type: 'track', uuid: p.uuid, track: device.AVTransportService?.LastChangeEnqueuedMetadata }));
    }
  }

  socket.send(JSON.stringify({ type: 'groups', groups: allGroups() }));
});

// Broadcast a message to all connected WebSocket clients
function broadcast(type, payload) {
  const msg = JSON.stringify({ type, ...payload });
  // console.log(`Broadcasting: ${msg}`);
  wss.clients.forEach(c => {
    if (c.readyState === c.OPEN) c.send(msg);
  });
}

initializeSonosEvents(broadcast);

// Route to get volume of a specific Sonos player by UUID
app.get('/api/:uuid/volume', async (req, res) => {
  console.log(`/api/${req.params.uuid}/volume → GET`);
  const v = await getVolume(req.params.uuid);
  if (v === null) return res.sendStatus(404);
  res.json({ volume: v });
});

// Route to set volume of a specific Sonos player by UUID
app.post('/api/:uuid/volume/:vol', async (req, res) => {
  console.log(`/api/${req.params.uuid}/volume/${req.params.vol} → SET`);
  await setVolume(req.params.uuid, req.params.vol);
  res.sendStatus(204);
});

// Route to join a Sonos player to another group/player
app.post('/api/:uuid/join/:to', async (req, res) => {
  console.log(`/api/${req.params.uuid}/join/${req.params.to}`);
  await join(req.params.uuid, req.params.to);
  res.sendStatus(204);
});

// Route to unjoin a Sonos player from its group
app.post('/api/:uuid/unjoin', async (req, res) => {
  console.log(`/api/${req.params.uuid}/unjoin`);
  await unjoin(req.params.uuid);
  res.sendStatus(204);
});

// Route to get full state of a specific Sonos player by UUID
app.get('/api/:uuid/state', (req, res) => {
  const device = manager.Devices.find(d => d.uuid === req.params.uuid);
  if (!device) return res.sendStatus(404);

  res.json({
    uuid: device.uuid,
    name: device.Name,
    volume: device.Volume,
    muted: device.Muted,
    state: device.CurrentTransportStateSimple,
    track: device.AVTransportService?.LastChangeEnqueuedMetadata,
  });
});

server.listen(3000, ()=>console.log('Dashboard on :3000'));