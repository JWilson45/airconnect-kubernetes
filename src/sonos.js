// src/sonos.js
import { SonosManager, SonosEvents } from '@svrooij/sonos';

const manager = new SonosManager();

await manager.InitializeWithDiscovery(); // SSDP discovery
// await manager.SubscribeToAll();
console.log(`Discovered ${manager.Devices.length} Sonos devices.`); // Log number of discovered devices
// Helper to find a device by its UUID
function getDeviceByUuid(uuid) {
  console.log(`Looking up device with UUID: ${uuid}`); // Log lookup attempt
  return manager.Devices.find(d => d.uuid === uuid);
}

// ─── Volume helpers ───────────────────────────────────────────────────────────
export async function getVolume(uuid) {
  console.log(`Getting volume for device ${uuid}`); // Log volume get request
  const device = getDeviceByUuid(uuid);
  if (!device) return null;
  const res = await device.RenderingControlService.GetVolume({
    InstanceID: 0,
    Channel: 'Master'
  });
  return parseInt(res.CurrentVolume ?? res.CurrentVolume[0] ?? 0, 10);
}

export async function setVolume(uuid, vol) {
  console.log(`Setting volume for device ${uuid} to ${vol}`); // Log volume set request
  const device = getDeviceByUuid(uuid);
  if (device) {
    await device.RenderingControlService.SetVolume({
      InstanceID: 0,
      Channel: 'Master',
      DesiredVolume: Math.max(0, Math.min(100, Number(vol)))
    });
  }
}
// ──────────────────────────────────────────────────────────────────────────────

export function allPlayers() {
  const players = manager.Devices.map(d => ({
    room: d.Name,
    uuid: d.uuid,
    coordinator: d.Group?.Coordinator?.uuid || null
  }));
  console.log(`Reporting ${players.length} players`); // Log number of players reported
  return players;
}

// Add this function to return current groups
// Build a fresh snapshot of all current Sonos groups
export function allGroups() {
  const groups = {};

  manager.Devices.forEach(d => {
    // Every device has a .Coordinator getter that returns the group coordinator
    const coord = d.Coordinator;
    const coordUuid = coord?.Uuid;
    if (!coordUuid) return; // safety guard

    // Initialise group entry on first encounter of the coordinator
    if (!groups[coordUuid]) {
      groups[coordUuid] = {
        coordinator: coordUuid,
        name: coord.GroupName ?? 'Unnamed Group',
        members: []
      };
    }

    // Add current device as a member of its coordinator group
    groups[coordUuid].members.push({
      uuid: d.Uuid,
      room: d.Name
    });
  });

  console.log(`Reporting ${Object.keys(groups).length} groups`); // Log number of groups reported
  return Object.values(groups);
}

export async function play(uuid) {
  console.log(`Playing device ${uuid}`); // Log play action
  const device = getDeviceByUuid(uuid);
  await device?.Play();
}
export async function pause(uuid) {
  console.log(`Pausing device ${uuid}`); // Log pause action
  const device = getDeviceByUuid(uuid);
  await device?.Pause();
}
export async function join(uuid, targetUuid) {
  console.log(`Joining ${uuid} to ${targetUuid}`); // Log join action
  const device = getDeviceByUuid(uuid);
  const target = getDeviceByUuid(targetUuid);
  await device?.JoinGroup(target.Name);
}
export async function unjoin(uuid) {
  console.log(`Unjoining device ${uuid}`); // Log unjoin action
  const device = getDeviceByUuid(uuid);
  // Leave current group and become standalone coordinator
  await device.AVTransportService.BecomeCoordinatorOfStandaloneGroup({ InstanceID: 0 });
}

export function initializeSonosEvents(broadcast) {
  console.log('Subscribing to Sonos events');

  const eventMap = [
    { event: SonosEvents.Volume, type: 'volume' },
    { event: SonosEvents.Muted, type: 'muted' },
    { event: SonosEvents.CurrentTrackChanged, type: 'track' },
    { event: SonosEvents.TransportState, type: 'state' },
    { event: SonosEvents.GroupName, type: 'groupName' },
    { event: SonosEvents.ZoneGroupTopology, type: 'groups', getPayload: () => allGroups() }
  ];

  manager.Devices.forEach(dev => {
    eventMap.forEach(({ event, type, getPayload }) => {
      dev.Events.on(event, payload => {
        if (type === 'groups') {
          console.log(`[${dev.Name}] Topology changed`);
          broadcast(type, { groups: getPayload() });
        } else {
          console.log(`[${dev.Name}] ${type} changed:`, payload);
          broadcast(type, { uuid: dev.uuid, [type]: getPayload ? getPayload() : payload });
        }
      });
    });
  });
}
