// public/dashboard.js
const api = p => fetch(p).then(r => r.json());
const div = id => document.getElementById(id);

const debounceMap = {};
function debounceVol(uuid, value) {
  clearTimeout(debounceMap[uuid]);
  debounceMap[uuid] = setTimeout(() => setVol(uuid, value), 150);
}

const handlers = {
  volume: m => {
    console.log('WS Volume Update:', m);

    const span = document.getElementById(`vol-${m.uuid}`);
    const slider = document.getElementById(`slider-${m.uuid}`);
    if (span) span.textContent = m.volume;
    if (slider && slider !== document.activeElement) {
      console.log(`Updating slider-${m.uuid} to ${m.volume}`);
      slider.value = m.volume;
    } else if (!slider) {
      console.warn(`Slider for ${m.uuid} not found`);
    } else {
      console.log(`Skipped slider update for ${m.uuid} (user active)`);
    }
  },
  groups: m => renderGroups(m.groups),
  muted: m => {
    const el = document.getElementById(`mute-${m.uuid}`);
    if (el) el.textContent = m.muted ? '🔇' : '';
  },
  track: m => {
    const el = document.getElementById(`track-${m.uuid}`);
    if (el) el.textContent = m.track?.title ?? '';
  },
  state: m => {
    const el = document.getElementById(`state-${m.uuid}`);
    if (el) el.textContent = m.state;
  },
  groupName: () => load()
};

// realtime updates with auto-reconnect
let ws;

function connectWebSocket() {
  ws = new WebSocket(`ws://${location.host}`);

  ws.onopen = () => console.log('[WebSocket] Connected');

  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    (handlers[m.type] || (() => {}))(m);
  };

  ws.onclose = () => {
    console.warn('[WebSocket] Disconnected. Retrying in 2 seconds...');
    setTimeout(connectWebSocket, 2000);
  };

  ws.onerror = err => {
    console.error('[WebSocket] Error:', err);
    ws.close(); // triggers onclose
  };
}

connectWebSocket();

async function load() {
  const [players, groups] = await Promise.all([api('/api/players'), api('/api/groups')]);
  renderPlayers(players);
  renderGroups(groups);
}

function renderPlayers(players) {
  const container = div('players');
  container.innerHTML = '';
  players.forEach(p => {
    const row = document.createElement('div');
    row.innerHTML = `
      <strong>${p.room}</strong>
      <span id="state-${p.uuid}" class="state"></span>
      <span id="track-${p.uuid}" class="track"></span>
      <span id="mute-${p.uuid}" class="mute"></span>
      <button onclick="cmd('${p.uuid}','play')">▶︎</button>
      <button onclick="cmd('${p.uuid}','pause')">⏸︎</button>
      <input type="range" id="slider-${p.uuid}" min="0" max="100"
             oninput="debounceVol('${p.uuid}',this.value)">
      <span id="vol-${p.uuid}">--</span>
      <select id="sel-${p.uuid}">
        <option value="">— group with —</option>
        ${players.filter(x=>x.uuid!==p.uuid)
                  .map(x=>`<option value="${x.uuid}">${x.room}</option>`).join('')}
      </select>
      <button onclick="join('${p.uuid}')">Join</button>
      <button onclick="cmd('${p.uuid}','unjoin')">Ungroup</button>
    `;
    container.appendChild(row);
    fetchVolume(p.uuid);
  });
}

function renderGroups(groups) {
  const container = div('groups');
  container.innerHTML = '';
  groups.forEach(g => {
    const grp = document.createElement('div');
    grp.innerHTML = `
      <h3>${g.name}</h3>
      <ul>
        ${g.members.map(m => `<li>${m.room}
          ${m.uuid !== g.coordinator ? `<button onclick="cmd('${m.uuid}','unjoin')">Remove</button>` : ''}
        </li>`).join('')}
      </ul>
    `;
    container.appendChild(grp);
  });
}

function fetchVolume(uuid) {
  api(`/api/${uuid}/state`).then(d => {
    if (!d) return;
    const span = document.getElementById(`vol-${uuid}`);
    const slider = document.getElementById(`slider-${uuid}`);
    const state = document.getElementById(`state-${uuid}`);
    const track = document.getElementById(`track-${uuid}`);
    const mute = document.getElementById(`mute-${uuid}`);

    if (span) span.textContent = d.volume;
    if (slider) slider.value = d.volume;
    if (state) state.textContent = d.state;
    if (track) track.textContent = d.track?.title ?? '';
    if (mute) mute.textContent = d.muted ? '🔇' : '';
  });
}

async function setVol(uuid, value) {
  await fetch(`/api/${uuid}/volume/${value}`, { method: 'POST' });
}

async function cmd(uuid, action) {
  await fetch(`/api/${uuid}/${action}`,{method:'POST'});
  load();
}

async function join(uuid) {
  const to = document.getElementById(`sel-${uuid}`).value;
  if (to) {
    await fetch(`/api/${uuid}/join/${to}`,{method:'POST'});
    load();
  }
}

load();