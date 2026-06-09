// src/sonos.js
import { SonosManager, SonosEvents } from '@svrooij/sonos';

const DEFAULT_LEGACY_MODELS = 'Sonos Connect:Amp';
const managedModels = new Set(
  (process.env.SONOS_MANAGED_MODELS || DEFAULT_LEGACY_MODELS)
    .split(',')
    .map(model => model.trim())
    .filter(Boolean)
);

export const manager = new SonosManager();

if (process.env.SONOS_HOST) {
  console.log(`Initializing Sonos from ${process.env.SONOS_HOST}.`);
  await manager.InitializeFromDevice(process.env.SONOS_HOST);
} else {
  await manager.InitializeWithDiscovery();
}
console.log(`Discovered ${manager.Devices.length} Sonos devices.`);

const deviceMeta = new Map();

function uuidOf(device) {
  return device?.Uuid ?? device?.uuid ?? null;
}

async function loadDeviceMeta(device) {
  const uuid = uuidOf(device);
  if (!uuid) return null;
  if (deviceMeta.has(uuid)) return deviceMeta.get(uuid);

  try {
    const description = await device.GetDeviceDescription();
    const meta = {
      modelName: description.modelName,
      displayName: description.displayName,
      roomName: description.roomName,
      host: device.Host
    };
    deviceMeta.set(uuid, meta);
    return meta;
  } catch (error) {
    console.warn(`Failed to load Sonos metadata for ${device.Name}:`, error.message);
    const meta = {
      modelName: 'Unknown',
      displayName: 'Unknown',
      roomName: device.Name,
      host: device.Host
    };
    deviceMeta.set(uuid, meta);
    return meta;
  }
}

await Promise.all(manager.Devices.map(loadDeviceMeta));

function allDevices() {
  return manager.Devices;
}

function managedDevices() {
  return allDevices().filter(device => {
    const meta = deviceMeta.get(uuidOf(device));
    return managedModels.has(meta?.modelName);
  });
}

function getManagedDeviceByUuid(uuid) {
  return managedDevices().find(device => uuidOf(device) === uuid);
}

function requireManagedDevice(uuid) {
  const device = getManagedDeviceByUuid(uuid);
  if (!device) {
    throw new Error(`Managed Sonos device not found: ${uuid}`);
  }
  return device;
}

function parseBool(value) {
  return value === true || value === '1' || value === 1 || value === 'true';
}

function parseTrack(metadata) {
  if (!metadata || typeof metadata !== 'string') return null;
  const read = tag => {
    const match = metadata.match(new RegExp(`<[^>]*${tag}[^>]*>(.*?)</[^>]*${tag}>`, 'i'));
    return match?.[1]?.replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>') ?? '';
  };
  const title = read('title');
  const artist = read('creator') || read('artist');
  const album = read('album');
  return title || artist || album ? { title, artist, album } : null;
}

async function getTransportState(device) {
  try {
    const result = await device.Coordinator.AVTransportService.GetTransportInfo();
    return result.CurrentTransportState ?? device.CurrentTransportStateSimple ?? 'UNKNOWN';
  } catch {
    return device.CurrentTransportStateSimple ?? 'UNKNOWN';
  }
}

async function getTrack(device) {
  try {
    const result = await device.Coordinator.AVTransportService.GetPositionInfo();
    return parseTrack(result.TrackMetaData);
  } catch {
    return null;
  }
}

export function managedModelNames() {
  return [...managedModels];
}

export function allPlayers() {
  const players = managedDevices().map(device => {
    const uuid = uuidOf(device);
    const coordUuid = uuidOf(device.Coordinator);
    const meta = deviceMeta.get(uuid);
    return {
      room: device.Name,
      uuid,
      coordinator: coordUuid,
      isCoordinator: coordUuid === uuid,
      groupName: device.GroupName ?? device.Name,
      model: meta?.modelName ?? 'Unknown',
      displayName: meta?.displayName ?? 'Unknown',
      host: meta?.host ?? device.Host
    };
  });

  console.log(`Reporting ${players.length} managed Sonos players.`);
  return players.sort((a, b) => a.room.localeCompare(b.room));
}

export function allGroups() {
  const groups = {};

  managedDevices().forEach(device => {
    const uuid = uuidOf(device);
    const coordUuid = uuidOf(device.Coordinator);
    const key = coordUuid || uuid;

    if (!groups[key]) {
      groups[key] = {
        coordinator: key,
        name: device.GroupName ?? device.Coordinator?.Name ?? device.Name,
        members: []
      };
    }

    groups[key].members.push({
      uuid,
      room: device.Name,
      model: deviceMeta.get(uuid)?.modelName ?? 'Unknown',
      isCoordinator: key === uuid
    });
  });

  return Object.values(groups)
    .map(group => ({
      ...group,
      members: group.members.sort((a, b) => a.room.localeCompare(b.room))
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function playerState(uuid) {
  const device = requireManagedDevice(uuid);
  const [volume, mute, transportState, track] = await Promise.all([
    getVolume(uuid),
    device.RenderingControlService.GetMute({ InstanceID: 0, Channel: 'Master' }).then(res => parseBool(res.CurrentMute)).catch(() => device.Muted ?? false),
    getTransportState(device),
    getTrack(device)
  ]);

  return {
    uuid,
    volume,
    muted: mute,
    state: transportState,
    track
  };
}

export async function getVolume(uuid) {
  const device = requireManagedDevice(uuid);
  const res = await device.RenderingControlService.GetVolume({
    InstanceID: 0,
    Channel: 'Master'
  });
  return parseInt(res.CurrentVolume ?? res.CurrentVolume?.[0] ?? 0, 10);
}

export async function setVolume(uuid, vol) {
  const device = requireManagedDevice(uuid);
  await device.RenderingControlService.SetVolume({
    InstanceID: 0,
    Channel: 'Master',
    DesiredVolume: Math.max(0, Math.min(100, Number(vol)))
  });
}

export async function play(uuid) {
  await requireManagedDevice(uuid).Play();
}

export async function pause(uuid) {
  await requireManagedDevice(uuid).Pause();
}

export async function join(uuid, targetUuid) {
  const device = requireManagedDevice(uuid);
  const target = requireManagedDevice(targetUuid);
  const coordinatorUuid = uuidOf(target.Coordinator);

  if (!coordinatorUuid || coordinatorUuid === uuidOf(device.Coordinator)) return false;

  await device.AVTransportService.SetAVTransportURI({
    InstanceID: 0,
    CurrentURI: `x-rincon:${coordinatorUuid}`,
    CurrentURIMetaData: ''
  });

  return true;
}

export async function unjoin(uuid) {
  const device = requireManagedDevice(uuid);
  await device.AVTransportService.BecomeCoordinatorOfStandaloneGroup({ InstanceID: 0 });
}

export function initializeSonosEvents(broadcast) {
  console.log('Subscribing to managed Sonos events.');

  const eventMap = [
    { event: SonosEvents.Volume, type: 'volume', map: value => ({ volume: Number(value) }) },
    { event: SonosEvents.Mute, type: 'muted', map: value => ({ muted: parseBool(value) }) },
    { event: SonosEvents.CurrentTrackMetadata, type: 'track', map: value => ({ track: parseTrack(value) }) },
    { event: SonosEvents.CurrentTransportState, type: 'state', map: value => ({ state: value }) },
    { event: SonosEvents.CurrentTransportStateSimple, type: 'state', map: value => ({ state: value }) }
  ];

  managedDevices().forEach(device => {
    const uuid = uuidOf(device);

    eventMap.forEach(({ event, type, map }) => {
      device.Events.on(event, payload => {
        broadcast(type, { uuid, ...map(payload) });
      });
    });

    device.Events.on(SonosEvents.Coordinator, () => {
      broadcast('groups', { groups: allGroups() });
      broadcast('players', { players: allPlayers() });
    });

    device.Events.on(SonosEvents.GroupName, () => {
      broadcast('groups', { groups: allGroups() });
      broadcast('players', { players: allPlayers() });
    });
  });
}
