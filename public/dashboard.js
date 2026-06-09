// public/dashboard.js
const appState = {
  players: [],
  groups: [],
  states: new Map(),
  managedModels: [],
  pendingVolumes: new Map(),
  ws: null
};

const $ = id => document.getElementById(id);

async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body.error) message = body.error;
    } catch {}
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return response.json();
}

function setStatus(status, label) {
  const dot = $('status-dot');
  dot.className = `dot ${status}`;
  $('status-text').textContent = label;
}

function showAlert(message) {
  $('alert').innerHTML = message ? `<div class="alert">${escapeHtml(message)}</div>` : '';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeState(state) {
  return {
    uuid: state.uuid,
    volume: Number.isFinite(Number(state.volume)) ? Number(state.volume) : 0,
    muted: Boolean(state.muted),
    state: state.state || 'UNKNOWN',
    track: state.track || null
  };
}

async function load() {
  try {
    showAlert('');
    const [config, snapshot] = await Promise.all([
      api('/api/config'),
      api('/api/state')
    ]);

    appState.managedModels = config.managedModels || [];
    appState.players = snapshot.players || [];
    appState.groups = snapshot.groups || [];
    appState.states = new Map((snapshot.states || []).map(state => [state.uuid, normalizeState(state)]));

    render();
  } catch (error) {
    showAlert(error.message);
  }
}

function render() {
  $('managed-models').textContent = appState.managedModels.length
    ? `Managing ${appState.managedModels.join(', ')}`
    : 'No managed Sonos models configured';

  renderPlayers();
  renderGroups();
}

function renderPlayers() {
  const container = $('players');
  container.innerHTML = '';

  if (appState.players.length === 0) {
    container.innerHTML = '<div class="empty">No managed legacy amps found.</div>';
    return;
  }

  appState.players.forEach(player => {
    const state = appState.states.get(player.uuid) || {};
    const group = groupForPlayer(player);
    const groupSize = group?.members?.length ?? 1;
    const card = document.createElement('article');
    card.className = 'player';
    card.dataset.uuid = player.uuid;

    const trackTitle = state.track?.title || 'No track information';
    const trackMeta = [state.track?.artist, state.track?.album].filter(Boolean).join(' - ');
    const isPlaying = String(state.state || '').toUpperCase().includes('PLAY');
    const transportAction = isPlaying ? 'pause' : 'play';
    const transportLabel = `${isPlaying ? 'Pause' : 'Play'} ${groupSize > 1 ? 'group' : 'room'}`;
    const destinationGroups = appState.groups.filter(candidate => candidate.coordinator !== player.coordinator);
    const joinLabel = groupSize > 1 ? 'Move' : 'Join';
    const soloDisabled = groupSize <= 1;

    card.innerHTML = `
      <div class="player-head">
        <div class="room">
          <h3>${escapeHtml(player.room)}</h3>
          <div class="meta">${escapeHtml(player.model)} · ${escapeHtml(player.host)} · ${escapeHtml(groupLabel(group, player))}</div>
        </div>
        <span class="badge ${isPlaying ? 'playing' : ''}">${escapeHtml(formatState(state.state))}</span>
      </div>

      <div class="track">
        <strong>${escapeHtml(trackTitle)}</strong>
        <span>${escapeHtml(trackMeta)}</span>
      </div>

      <button class="primary-action ${isPlaying ? 'playing' : ''}" type="button" data-action="transport" data-transport="${transportAction}">
        ${escapeHtml(transportLabel)}
      </button>

      <div class="volume">
        <input type="range" min="0" max="100" value="${Number(state.volume ?? 0)}" data-volume aria-label="${escapeHtml(player.room)} volume">
        <span class="vol-value">${Number(state.volume ?? 0)}</span>
      </div>

      <div class="group-control">
        <select data-join-target aria-label="${escapeHtml(joinLabel)} ${escapeHtml(player.room)} to another group" ${destinationGroups.length ? '' : 'disabled'}>
          <option value="">${destinationGroups.length ? `${joinLabel} to group` : 'No other groups'}</option>
          ${destinationGroups.map(target => `<option value="${escapeHtml(target.coordinator)}">${escapeHtml(groupOptionLabel(target))}</option>`).join('')}
        </select>
        <button type="button" data-action="join" ${destinationGroups.length ? '' : 'disabled'}>${escapeHtml(joinLabel)}</button>
      </div>

      <div class="group-actions">
        <button type="button" data-action="unjoin" ${soloDisabled ? 'disabled' : ''}>Solo room</button>
        <button type="button" data-action="refresh-card">Refresh state</button>
      </div>
    `;

    card.querySelector('[data-action="transport"]').addEventListener('click', event => {
      command(player.uuid, event.currentTarget.dataset.transport);
    });
    card.querySelector('[data-action="join"]').addEventListener('click', () => join(player.uuid, card));
    card.querySelector('[data-action="unjoin"]').addEventListener('click', () => command(player.uuid, 'unjoin'));
    card.querySelector('[data-action="refresh-card"]').addEventListener('click', () => refreshPlayer(player.uuid));

    const slider = card.querySelector('[data-volume]');
    slider.addEventListener('input', event => updateVolumePreview(player.uuid, event.target.value, card));
    slider.addEventListener('change', event => setVolume(player.uuid, event.target.value));

    container.appendChild(card);
  });
}

function groupForPlayer(player) {
  return appState.groups.find(group => group.members.some(member => member.uuid === player.uuid))
    || appState.groups.find(group => group.coordinator === player.coordinator)
    || null;
}

function groupLabel(group, player) {
  if (!group || group.members.length <= 1) return 'Solo';
  const others = group.members
    .filter(member => member.uuid !== player.uuid)
    .map(member => member.room);
  return `Grouped with ${others.join(', ')}`;
}

function groupOptionLabel(group) {
  if (!group) return 'Unknown group';
  if (group.members.length <= 1) return group.members[0]?.room || group.name;
  return `${group.name} (${group.members.map(member => member.room).join(', ')})`;
}

function renderGroups() {
  const container = $('groups');
  container.innerHTML = '';
  $('group-count').textContent = `${appState.groups.length}`;

  if (appState.groups.length === 0) {
    container.innerHTML = '<div class="empty">No active groups.</div>';
    return;
  }

  appState.groups.forEach(group => {
    const section = document.createElement('section');
    section.className = 'group';
    section.innerHTML = `
      <div class="group-title">
        <h3>${escapeHtml(group.name)}</h3>
        <span class="small">${group.members.length}</span>
      </div>
      <ul class="member-list">
        ${group.members.map(member => `
          <li>
            <span>${escapeHtml(member.room)}</span>
            ${member.isCoordinator ? '<span class="small">Lead</span>' : ''}
          </li>
        `).join('')}
      </ul>
    `;
    container.appendChild(section);
  });
}

function formatState(state) {
  if (!state) return 'Unknown';
  return String(state).replaceAll('_', ' ').toLowerCase();
}

function mergePlayerState(uuid, patch) {
  const current = appState.states.get(uuid) || { uuid };
  appState.states.set(uuid, normalizeState({ ...current, ...patch, uuid }));
}

function patchPlayerCard(uuid, patch) {
  mergePlayerState(uuid, patch);
  const card = document.querySelector(`[data-uuid="${CSS.escape(uuid)}"]`);
  if (!card) {
    renderPlayers();
    return;
  }

  const state = appState.states.get(uuid);
  const player = appState.players.find(candidate => candidate.uuid === uuid);
  const group = player ? groupForPlayer(player) : null;
  const groupSize = group?.members?.length ?? 1;
  const badge = card.querySelector('.badge');
  const isPlaying = String(state.state || '').toUpperCase().includes('PLAY');
  badge.textContent = formatState(state.state);
  badge.classList.toggle('playing', isPlaying);

  const transport = card.querySelector('[data-action="transport"]');
  if (transport) {
    const action = isPlaying ? 'pause' : 'play';
    transport.dataset.transport = action;
    transport.textContent = `${isPlaying ? 'Pause' : 'Play'} ${groupSize > 1 ? 'group' : 'room'}`;
    transport.classList.toggle('playing', isPlaying);
  }

  const track = card.querySelector('.track');
  const trackTitle = state.track?.title || 'No track information';
  const trackMeta = [state.track?.artist, state.track?.album].filter(Boolean).join(' - ');
  track.innerHTML = `<strong>${escapeHtml(trackTitle)}</strong><span>${escapeHtml(trackMeta)}</span>`;

  const slider = card.querySelector('[data-volume]');
  const value = card.querySelector('.vol-value');
  if (!appState.pendingVolumes.has(uuid) && document.activeElement !== slider) {
    slider.value = state.volume;
    value.textContent = state.volume;
  }
}

function updateVolumePreview(uuid, rawValue, card) {
  const value = Math.max(0, Math.min(100, Number(rawValue)));
  appState.pendingVolumes.set(uuid, value);
  card.querySelector('.vol-value').textContent = value;

  clearTimeout(appState.pendingVolumes.get(`${uuid}:timer`));
  const timer = setTimeout(() => setVolume(uuid, value), 180);
  appState.pendingVolumes.set(`${uuid}:timer`, timer);
}

async function setVolume(uuid, rawValue) {
  const value = Math.max(0, Math.min(100, Number(rawValue)));
  clearTimeout(appState.pendingVolumes.get(`${uuid}:timer`));
  appState.pendingVolumes.delete(`${uuid}:timer`);

  try {
    await api(`/api/${encodeURIComponent(uuid)}/volume/${value}`, { method: 'POST' });
    appState.pendingVolumes.delete(uuid);
    mergePlayerState(uuid, { volume: value });
  } catch (error) {
    appState.pendingVolumes.delete(uuid);
    showAlert(error.message);
    load();
  }
}

async function command(uuid, action) {
  try {
    await api(`/api/${encodeURIComponent(uuid)}/${action}`, { method: 'POST' });
    await load();
  } catch (error) {
    showAlert(error.message);
  }
}

async function join(uuid, card) {
  const target = card.querySelector('[data-join-target]').value;
  if (!target) return;

  try {
    await api(`/api/${encodeURIComponent(uuid)}/join/${encodeURIComponent(target)}`, { method: 'POST' });
    await load();
  } catch (error) {
    showAlert(error.message);
  }
}

async function refreshPlayer(uuid) {
  try {
    const state = await api(`/api/${encodeURIComponent(uuid)}/state`);
    patchPlayerCard(uuid, state);
  } catch (error) {
    showAlert(error.message);
  }
}

function connectWebSocket() {
  if (appState.ws) appState.ws.close();

  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${protocol}://${location.host}`);
  appState.ws = ws;

  ws.addEventListener('open', () => {
    setStatus('online', 'Live');
  });

  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);

    if (message.type === 'players') {
      appState.players = message.players || [];
      render();
      return;
    }

    if (message.type === 'groups') {
      appState.groups = message.groups || [];
      render();
      return;
    }

    if (message.type === 'stateSnapshot') {
      patchPlayerCard(message.uuid, message);
      return;
    }

    if (message.type === 'volume') {
      patchPlayerCard(message.uuid, { volume: message.volume });
      return;
    }

    if (message.type === 'muted') {
      patchPlayerCard(message.uuid, { muted: message.muted });
      return;
    }

    if (message.type === 'track') {
      patchPlayerCard(message.uuid, { track: message.track });
      return;
    }

    if (message.type === 'state') {
      patchPlayerCard(message.uuid, { state: message.state });
      return;
    }

    if (message.type === 'error') {
      showAlert(message.error);
    }
  });

  ws.addEventListener('close', () => {
    if (appState.ws !== ws) return;
    setStatus('offline', 'Reconnecting');
    setTimeout(connectWebSocket, 2000);
  });

  ws.addEventListener('error', () => {
    ws.close();
  });
}

$('refresh').addEventListener('click', load);

load();
connectWebSocket();
