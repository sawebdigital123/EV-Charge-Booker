// Simple front-end SPA for EV Charging Slot Booking
// Data is persisted in localStorage. This is NOT production security.

// ----------------------- Utilities -----------------------
const qs = (sel, el = document) => el.querySelector(sel);
const qsa = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const byId = (id) => document.getElementById(id);

const Storage = {
  read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  },
  write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
};

const uid = () => Math.random().toString(36).slice(2, 10);

// ----------------------- Data Models -----------------------
// users: { id, name, email, passwordHash, role: 'user' | 'admin' }
// stations: { id, name, address, phone, lat, lng, power, slots: { total, durationMins }, live: { occupied } }

const KEYS = {
  users: 'ev_users',
  stations: 'ev_stations',
  session: 'ev_session'
};

function initSeedData() {
  const users = Storage.read(KEYS.users, []);
  if (!users.length) {
    users.push({ id: uid(), name: 'Admin', email: 'admin@ev.app', passwordHash: 'admin123', role: 'admin' });
    users.push({ id: uid(), name: 'Jane EV', email: 'user@ev.app', passwordHash: 'user1234', role: 'user' });
    Storage.write(KEYS.users, users);
  }
  const stations = Storage.read(KEYS.stations, []);
  if (!stations.length) {
    const demo = [
      { id: uid(), name: 'VoltHub Central', address: '12 Main St, Downtown', phone: '+1 555 100 100', lat: 12.9716, lng: 77.5946, power: 'fast', slots: { total: 6, durationMins: 60 }, live: { occupied: 2 } },
      { id: uid(), name: 'GreenCharge West', address: '45 Lake Rd, Westside', phone: '+1 555 200 200', lat: 12.9352, lng: 77.6245, power: 'slow', slots: { total: 4, durationMins: 45 }, live: { occupied: 1 } },
      { id: uid(), name: 'UltraSpark East', address: '99 Tech Park, East', phone: '+1 555 300 300', lat: 12.9141, lng: 77.6387, power: 'ultra', slots: { total: 8, durationMins: 30 }, live: { occupied: 5 } }
    ];
    Storage.write(KEYS.stations, demo);
  }
}

// ----------------------- Auth -----------------------
function getSession() {
  return Storage.read(KEYS.session, null);
}
function setSession(session) {
  Storage.write(KEYS.session, session);
}
function logout() {
  Storage.write(KEYS.session, null);
}

function registerUser({ name, email, password, role }) {
  const users = Storage.read(KEYS.users, []);
  if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    throw new Error('Email already registered');
  }
  const user = { id: uid(), name, email, passwordHash: password, role };
  users.push(user);
  Storage.write(KEYS.users, users);
  return user;
}

function loginUser({ email, password, role }) {
  const users = Storage.read(KEYS.users, []);
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.passwordHash === password && u.role === role);
  if (!user) throw new Error('Invalid credentials');
  setSession({ id: user.id, name: user.name, role: user.role });
  return user;
}

// ----------------------- Stations & Slots -----------------------
function listStations() { return Storage.read(KEYS.stations, []); }
function saveStations(stations) { Storage.write(KEYS.stations, stations); }

function upsertStation(payload) {
  const stations = listStations();
  if (payload.id) {
    const idx = stations.findIndex(s => s.id === payload.id);
    if (idx >= 0) stations[idx] = { ...stations[idx], ...payload };
  } else {
    stations.push({ id: uid(), live: { occupied: 0 }, slots: { total: 4, durationMins: 60 }, ...payload });
  }
  saveStations(stations);
}

function deleteStation(id) {
  const stations = listStations().filter(s => s.id !== id);
  saveStations(stations);
}

function saveSlotConfig(stationId, { total, durationMins }) {
  const stations = listStations();
  const idx = stations.findIndex(s => s.id === stationId);
  if (idx < 0) throw new Error('Station not found');
  stations[idx].slots = { total: Number(total), durationMins: Number(durationMins) };
  stations[idx].live = stations[idx].live || { occupied: 0 };
  // Ensure occupied <= total
  stations[idx].live.occupied = Math.min(stations[idx].live.occupied || 0, stations[idx].slots.total);
  saveStations(stations);
}

function vacancyOf(station) {
  const occupied = station.live?.occupied || 0;
  return Math.max(0, (station.slots?.total || 0) - occupied);
}

// ----------------------- UI Wiring -----------------------
let map, miniMap, mapMarkers = [];
let userPosition = null;

function init() {
  initSeedData();
  bindTopLevelTabs();
  bindAuthCards();
  bindAdminPanels();
  bindUserApp();
  bindModal();
  restoreSessionUI();
  renderAdminStationTable();
  refreshSlotStationSelect();
  renderUserStations();
  startRealtimeTicker();
}

// Tabs (User/Admin)
function bindTopLevelTabs() {
  qsa('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      qsa('.tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      qsa('.panel').forEach(p => p.classList.remove('active'));
      byId(btn.dataset.tab).classList.add('active');
    });
  });
}

// Auth card switching
function bindAuthCards() {
  // switchers (User)
  const toUserRegister = byId('toUserRegister');
  const toUserLogin = byId('toUserLogin');
  if (toUserRegister) toUserRegister.addEventListener('click', () => {
    byId('userLoginCard').classList.add('hidden');
    byId('userRegisterCard').classList.remove('hidden');
  });
  if (toUserLogin) toUserLogin.addEventListener('click', () => {
    byId('userRegisterCard').classList.add('hidden');
    byId('userLoginCard').classList.remove('hidden');
  });

  byId('userRegisterForm').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      registerUser({
        name: byId('userRegisterName').value.trim(),
        email: byId('userRegisterEmail').value.trim(),
        password: byId('userRegisterPassword').value,
        role: 'user'
      });
      alert('User registered. You can login now.');
      // navigate back to login
      byId('userRegisterCard').classList.add('hidden');
      byId('userLoginCard').classList.remove('hidden');
    } catch (err) { alert(err.message); }
  });
  byId('userLoginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      loginUser({
        email: byId('userLoginEmail').value.trim(),
        password: byId('userLoginPassword').value,
        role: 'user'
      });
      restoreSessionUI();
      showToast('Login Successful');
    } catch (err) { alert(err.message); }
  });
  byId('userLogout').addEventListener('click', () => { logout(); restoreSessionUI(); });

  // switchers (Admin)
  const toAdminRegister = byId('toAdminRegister');
  const toAdminLogin = byId('toAdminLogin');
  if (toAdminRegister) toAdminRegister.addEventListener('click', () => {
    byId('adminLoginCard').classList.add('hidden');
    byId('adminRegisterCard').classList.remove('hidden');
  });
  if (toAdminLogin) toAdminLogin.addEventListener('click', () => {
    byId('adminRegisterCard').classList.add('hidden');
    byId('adminLoginCard').classList.remove('hidden');
  });

  byId('adminRegisterForm').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      registerUser({
        name: byId('adminRegisterName').value.trim(),
        email: byId('adminRegisterEmail').value.trim(),
        password: byId('adminRegisterPassword').value,
        role: 'admin'
      });
      alert('Admin registered. You can login now.');
      byId('adminRegisterCard').classList.add('hidden');
      byId('adminLoginCard').classList.remove('hidden');
    } catch (err) { alert(err.message); }
  });
  byId('adminLoginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      loginUser({
        email: byId('adminLoginEmail').value.trim(),
        password: byId('adminLoginPassword').value,
        role: 'admin'
      });
      restoreSessionUI();
      showToast('Login Successful');
    } catch (err) { alert(err.message); }
  });
  byId('adminLogout').addEventListener('click', () => { logout(); restoreSessionUI(); });
}

function restoreSessionUI() {
  const session = getSession();
  const isUser = session?.role === 'user';
  const isAdmin = session?.role === 'admin';
  // User section
  byId('userLoginCard').classList.toggle('hidden', !!isUser);
  byId('userRegisterCard').classList.add('hidden');
  byId('userApp').classList.toggle('hidden', !isUser);
  // Admin section
  byId('adminLoginCard').classList.toggle('hidden', !!isAdmin);
  byId('adminRegisterCard').classList.add('hidden');
  byId('adminApp').classList.toggle('hidden', !isAdmin);
}

// ----------------------- Admin Panels -----------------------
function bindAdminPanels() {
  // Subtabs
  qsa('.subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      qsa('.subtab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      qsa('.subpanel').forEach(p => p.classList.remove('active'));
      byId(btn.dataset.subtab).classList.add('active');
    });
  });

  // Station form
  byId('stationForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const payload = {
      id: byId('stationId').value || undefined,
      name: byId('stationName').value.trim(),
      address: byId('stationAddress').value.trim(),
      phone: byId('stationPhone').value.trim(),
      lat: Number(byId('stationLat').value),
      lng: Number(byId('stationLng').value),
      power: byId('stationPower').value
    };
    if (!isFinite(payload.lat) || !isFinite(payload.lng)) { alert('Invalid latitude/longitude'); return; }
    upsertStation(payload);
    e.target.reset();
    byId('stationId').value = '';
    renderAdminStationTable();
    refreshSlotStationSelect();
    renderUserStations();
  });
  byId('resetStationForm').addEventListener('click', () => {
    byId('stationForm').reset();
    byId('stationId').value = '';
  });

  // Slot form
  byId('slotForm').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      const stationId = byId('slotStationSelect').value;
      const total = Number(byId('slotCount').value);
      const durationMins = Number(byId('slotDuration').value);
      saveSlotConfig(stationId, { total, durationMins });
      renderSlotSummary();
      renderUserStations();
    } catch (err) { alert(err.message); }
  });
}

function renderAdminStationTable() {
  const table = byId('stationTable');
  const stations = listStations();
  if (!stations.length) { table.innerHTML = '<div class="card">No stations yet.</div>'; return; }
  const frag = document.createDocumentFragment();
  const header = document.createElement('div');
  header.className = 'row';
  header.innerHTML = '<div class="cell"><b>Name</b></div><div class="cell"><b>Address</b></div><div class="cell"><b>Mobile</b></div><div class="cell"><b>Power</b></div><div class="cell"><b>Actions</b></div>';
  frag.appendChild(header);
  const tpl = byId('stationRowTemplate');
  stations.forEach(st => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = st.id;
    node.querySelector('.name').textContent = st.name;
    node.querySelector('.addr').textContent = st.address;
    node.querySelector('.phone').textContent = st.phone;
    node.querySelector('.power').textContent = st.power;
    node.addEventListener('click', (e) => {
      const action = e.target?.dataset?.action;
      if (action === 'edit') {
        byId('stationId').value = st.id;
        byId('stationName').value = st.name;
        byId('stationAddress').value = st.address;
        byId('stationPhone').value = st.phone;
        byId('stationLat').value = st.lat;
        byId('stationLng').value = st.lng;
        byId('stationPower').value = st.power;
      } else if (action === 'delete') {
        if (confirm('Delete this station?')) {
          deleteStation(st.id);
          renderAdminStationTable();
          refreshSlotStationSelect();
          renderUserStations();
        }
      }
    });
    frag.appendChild(node);
  });
  table.innerHTML = '';
  table.appendChild(frag);
}

function refreshSlotStationSelect() {
  const select = byId('slotStationSelect');
  const stations = listStations();
  select.innerHTML = '<option value="" disabled selected>Select station</option>' + stations.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  renderSlotSummary();
}

function renderSlotSummary() {
  const wrap = byId('slotSummary');
  const stations = listStations();
  wrap.innerHTML = stations.map(s => {
    const vacancies = vacancyOf(s);
    return `<div class="card">
      <div class="row"><div><b>${s.name}</b></div><div><span class="badge ${vacancies ? 'success' : 'danger'}">${vacancies ? vacancies + ' free' : 'Full'}</span></div></div>
      <div class="row"><div>Slots: ${s.slots.total}</div><div>Duration: ${s.slots.durationMins} mins</div></div>
    </div>`;
  }).join('');
}

// ----------------------- User App -----------------------
function bindUserApp() {
  byId('useMyLocation').addEventListener('click', () => {
    if (!navigator.geolocation) { alert('Geolocation not supported'); return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      userPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      centerMap(userPosition);
      renderUserStations();
    }, () => alert('Unable to get location'));
  });
  byId('searchInput').addEventListener('input', () => renderUserStations());
  byId('powerFilter').addEventListener('change', () => renderUserStations());
}

function renderUserStations() {
  const listEl = byId('stationList');
  const query = byId('searchInput').value.trim().toLowerCase();
  const pfilter = byId('powerFilter').value;
  const stations = listStations().filter(s => {
    const inText = `${s.name} ${s.address}`.toLowerCase().includes(query);
    const inPower = !pfilter || s.power === pfilter;
    return inText && inPower;
  });
  listEl.innerHTML = stations.map(st => renderStationCard(st)).join('');
  refreshMapMarkers(stations);
}

function renderStationCard(st) {
  const v = vacancyOf(st);
  const badgeCls = v ? 'success' : 'danger';
  const distanceText = userPosition ? ` • ${fmtKm(distanceKm(userPosition, { lat: st.lat, lng: st.lng }))}` : '';
  return `<div class="card" data-id="${st.id}">
    <div class="row"><div><b>${st.name}</b><span class="badge" style="margin-left:8px;">${st.power}</span></div><div><span class="badge ${badgeCls}">${v ? v + ' free' : 'Full'}</span></div></div>
    <div class="row"><div>${st.address}${distanceText}</div><div>${st.phone}</div></div>
    <div class="row"><div></div><div><button class="btn xs" data-action="details">Details</button></div></div>
  </div>`;
}

function refreshMapMarkers(stations) {
  // If Google Maps available, draw markers. Fallback: simple placeholder box.
  const mapEl = byId('map');
  if (window.google && google.maps) {
    if (!map) initMap();
    mapMarkers.forEach(m => m.setMap(null));
    mapMarkers = stations.map(s => new google.maps.Marker({ position: { lat: s.lat, lng: s.lng }, map, title: s.name }));
  } else {
    // Render simple grid of points for demo
    mapEl.innerHTML = `<div style="padding:12px;color:#a8b3cf">Google Map not initialized. Add API key in index.html to enable full map. Showing schematic positions.</div>` +
      `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;padding:12px;">` +
      stations.map(s => `<div style="border:1px dashed #233;border-radius:10px;padding:10px;">
        <div><b>${s.name}</b></div>
        <div style="color:#a8b3cf">(${s.lat.toFixed(4)}, ${s.lng.toFixed(4)})</div>
      </div>`).join('') + `</div>`;
  }

  // Details button wiring
  qsa('[data-action="details"]', byId('stationList')).forEach(btn => {
    btn.addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      const id = card.dataset.id;
      const st = listStations().find(s => s.id === id);
      openDetailsModal(st);
    });
  });
}

// Maps init (optional if Google Maps is enabled)
window.initMap = function initMap() {
  if (!(window.google && google.maps)) return;
  map = new google.maps.Map(byId('map'), { center: userPosition || { lat: 12.9716, lng: 77.5946 }, zoom: 12, disableDefaultUI: true });
};

function centerMap(pos) {
  if (map && window.google && google.maps) {
    map.setCenter(pos);
  }
}

// ----------------------- Modal & Booking -----------------------
function bindModal() {
  byId('closeModal').addEventListener('click', closeDetailsModal);
  byId('bookSlot').addEventListener('click', () => {
    const id = byId('bookSlot').dataset.id;
    const stations = listStations();
    const idx = stations.findIndex(s => s.id === id);
    if (idx < 0) return;
    const st = stations[idx];
    if (vacancyOf(st) <= 0) { alert('No slots available'); return; }
    st.live.occupied = (st.live.occupied || 0) + 1;
    saveStations(stations);
    renderUserStations();
    renderSlotSummary();
    openDetailsModal(st);
    alert('Slot booked successfully');
  });
}

function openDetailsModal(st) {
  byId('detailsModal').classList.remove('hidden');
  byId('dName').textContent = st.name;
  byId('dAddress').textContent = st.address;
  byId('dPhone').textContent = st.phone;
  byId('dPower').textContent = st.power;
  byId('dVacancy').textContent = `${vacancyOf(st)} free / ${st.slots.total}`;
  byId('bookSlot').dataset.id = st.id;

  // mini map
  const mini = byId('miniMap');
  if (window.google && google.maps) {
    miniMap = new google.maps.Map(mini, { center: { lat: st.lat, lng: st.lng }, zoom: 14, disableDefaultUI: true });
    new google.maps.Marker({ position: { lat: st.lat, lng: st.lng }, map: miniMap, title: st.name });
  } else {
    mini.innerHTML = `<div style="padding:12px;color:#a8b3cf">(${st.lat.toFixed(4)}, ${st.lng.toFixed(4)})</div>`;
  }
}

function closeDetailsModal() {
  byId('detailsModal').classList.add('hidden');
}

// ----------------------- Toast -----------------------
let toastTimer;
function showToast(text) {
  let t = byId('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
}

// ----------------------- Realtime Simulation -----------------------
let tickerId;
function startRealtimeTicker() {
  if (tickerId) clearInterval(tickerId);
  tickerId = setInterval(() => {
    // Simulate vehicles leaving: randomly free a slot ~20% chance per station
    const stations = listStations();
    let changed = false;
    stations.forEach(s => {
      if (Math.random() < 0.2 && (s.live.occupied || 0) > 0) {
        s.live.occupied -= 1;
        changed = true;
      }
    });
    if (changed) {
      saveStations(stations);
      renderUserStations();
      renderSlotSummary();
    }
  }, 5000);
}

// ----------------------- Geo helpers -----------------------
function distanceKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const x = Math.sin(dLat/2)**2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
  return R * c;
}
function toRad(d) { return d * Math.PI / 180; }
function fmtKm(km) { return (km < 1 ? `${Math.round(km*1000)} m` : `${km.toFixed(1)} km`); }

// ----------------------- Boot -----------------------
document.addEventListener('DOMContentLoaded', init);


