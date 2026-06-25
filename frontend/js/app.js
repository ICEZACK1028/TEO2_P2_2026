// Con Docker+Nginx, las llamadas a /api/ se proxean automáticamente al backend
const API = '/api';

let currentUser = null;
let selectedRating = 0;
let ratingDeliveryId = null;
let previousPage = null; // para saber a qué dashboard volver desde el perfil
let adminStatusChart = null;
let adminDriversChart = null;

// ── UTILS ──────────────────────────────────────────────────────
function getToken() { return localStorage.getItem('fd_token'); }
function setToken(t) { localStorage.setItem('fd_token', t); }
function clearToken() { localStorage.removeItem('fd_token'); }

function toast(msg, type = 'default') {
  const typeMap = {
    success: { icon: 'success', title: 'Éxito' },
    error: { icon: 'error', title: 'Error' },
    default: { icon: 'info', title: 'Información' }
  };
  const config = typeMap[type] || typeMap['default'];
  Swal.fire({
    icon: config.icon,
    title: config.title,
    text: msg,
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 3000,
    timerProgressBar: true
  });
}

async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (getToken()) headers['Authorization'] = `Bearer ${getToken()}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error de servidor');
  return data;
}

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function statusHTML(status) {
  const labels = { pendiente: 'Pendiente', en_camino: 'En camino', entregado: 'Entregado' };
  const colors = { pendiente: '#f59e0b', en_camino: '#3b82f6', entregado: '#10b981' };
  return `<span class="status-badge status-${status}" style="background:${colors[status] || '#6b7280'};color:white;padding:4px 12px;border-radius:4px;font-size:0.8rem;font-weight:600">${labels[status] || status}</span>`;
}

function starsHTML(rating) {
  if (!rating) return '';
  return '<span style="color: #f59e0b; letter-spacing: 2px;">★</span>'.repeat(rating) + '<span style="color: #d1d5db; letter-spacing: 2px;">☆</span>'.repeat(5 - rating);
}

function formatDate(d) {
  return new Date(d).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' });
}

// Muestra la foto de perfil en el avatar de la navbar/dashboard
function renderAvatarPhoto(avatarEl, photoUrl, fallbackLetter) {
  const src = photoUrl || 'img/default-avatar.png';
  avatarEl.innerHTML = `<img src="${src}" alt="Foto" style="width:100%;height:100%;border-radius:50%;object-fit:cover" />`;
}

// ── INIT ───────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const token = getToken();
  if (token) {
    try {
      const data = await apiFetch('/auth/me');
      currentUser = data.user;
      enterApp();
    } catch {
      clearToken();
      showPage('page-login');
    }
  } else {
    showPage('page-login');
  }

  // Estrellas
  document.querySelectorAll('.star-btn').forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      const v = parseInt(btn.dataset.value);
      document.querySelectorAll('.star-btn').forEach(s =>
        s.classList.toggle('active', parseInt(s.dataset.value) <= v));
    });
    btn.addEventListener('mouseleave', () => {
      document.querySelectorAll('.star-btn').forEach(s =>
        s.classList.toggle('active', parseInt(s.dataset.value) <= selectedRating));
    });
    btn.addEventListener('click', () => {
      selectedRating = parseInt(btn.dataset.value);
      document.querySelectorAll('.star-btn').forEach(s =>
        s.classList.toggle('active', parseInt(s.dataset.value) <= selectedRating));
    });
  });

  document.getElementById('input-km')?.addEventListener('input', updatePricePreview);
});

function updatePricePreview() {
  const km = parseFloat(document.getElementById('input-km').value) || 0;
  document.getElementById('price-amount').textContent = `Q ${(km * 5).toFixed(2)}`;
  document.getElementById('price-formula').textContent = `${km} km × Q5.00`;
}

// ── AUTH ───────────────────────────────────────────────────────
window.switchAuthTab = function (tab) {
  document.getElementById('login-form-container').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('register-form-container').style.display = tab === 'register' ? 'block' : 'none';
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
};

window.toggleVehicle = function () {
  document.getElementById('vehicle-group').style.display =
    document.getElementById('reg-role').value === 'repartidor' ? 'block' : 'none';
};

// Vista previa de foto en el formulario de registro
window.previewRegisterPhoto = function (input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('reg-photo-img').src = e.target.result;
    document.getElementById('reg-photo-name').textContent = file.name;
    document.getElementById('reg-photo-preview').style.display = 'block';
  };
  reader.readAsDataURL(file);
};

window.login = async function () {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('btn-login');
  if (!email || !password) return toast('Completa todos los campos', 'error');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Ingresando...';
  try {
    const data = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    setToken(data.token);
    currentUser = data.user;
    toast(`¡Bienvenido, ${currentUser.name}!`, 'success');
    enterApp();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Iniciar Sesión';
  }
};

// Register usa FormData porque envía imagen
window.register = async function () {
  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const role = document.getElementById('reg-role').value;
  const vehicle = document.getElementById('reg-vehicle').value.trim();
  const photo = document.getElementById('reg-photo').files[0];
  const btn = document.getElementById('btn-register');

  if (!name || !email || !password) return toast('Completa todos los campos', 'error');
  if (role === 'repartidor' && !vehicle) return toast('Ingresa tu tipo de vehículo', 'error');

  const formData = new FormData();
  formData.append('name', name);
  formData.append('email', email);
  formData.append('password', password);
  formData.append('role', role);
  if (vehicle) formData.append('vehicle', vehicle);
  if (photo) formData.append('photo', photo);

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Registrando...';
  try {
    // Sin Content-Type: el browser lo asigna automáticamente con el boundary correcto
    const res = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Authorization': getToken() ? `Bearer ${getToken()}` : '' },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error de servidor');
    setToken(data.token);
    currentUser = data.user;
    toast(`¡Cuenta creada! Bienvenido, ${currentUser.name}!`, 'success');
    enterApp();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Crear Cuenta';
  }
};

window.logout = function () {
  clearToken(); currentUser = null;
  showPage('page-login');
  toast('Sesión cerrada');
};

// ── APP ENTRY ──────────────────────────────────────────────────
function enterApp() {
  if (currentUser.role === 'admin') showAdminDashboard();
  else if (currentUser.role === 'cliente') showClientDashboard();
  else showDriverDashboard();
}

// ── CLIENTE ────────────────────────────────────────────────────
async function showClientDashboard() {
  showPage('page-client');
  previousPage = 'page-client';
  document.getElementById('client-name').textContent = currentUser.name;
  document.getElementById('client-email').textContent = currentUser.email;
  const avatarEl = document.getElementById('client-avatar');
  renderAvatarPhoto(avatarEl, currentUser.photo_url, currentUser.name[0].toUpperCase());
  await loadClientDeliveries();
}

async function loadClientDeliveries() {
  const list = document.getElementById('client-deliveries-list');
  list.innerHTML = '<p style="color:var(--gray);text-align:center;padding:20px">Cargando...</p>';
  try {
    const data = await apiFetch('/deliveries');
    renderClientDeliveries(data.deliveries);
  } catch (err) { toast(err.message, 'error'); }
}

function renderClientDeliveries(deliveries) {
  const list = document.getElementById('client-deliveries-list');
  if (!deliveries.length) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon"></span><h3>Sin envíos aún</h3><p>Crea tu primer envío arriba.</p></div>`;
    return;
  }
  list.innerHTML = deliveries.map(d => `
    <div class="card">
      <div class="card-header">
        <div>
          <span class="card-id">#${d.id}</span>
          <span style="font-size:0.8rem;color:var(--gray);margin-left:8px">${formatDate(d.created_at)}</span>
        </div>
        ${statusHTML(d.status)}
      </div>
      <div class="delivery-route">
        <div class="route-point"><div class="label">Origen</div><div class="value">${d.origin}</div></div>
        <div class="route-arrow">→</div>
        <div class="route-point"><div class="label">Destino</div><div class="value">${d.destination}</div></div>
      </div>
      <div class="delivery-meta">
        <div class="meta-item"><span class="meta-label">Paquete</span><span class="meta-value">${d.description}</span></div>
        <div class="meta-item"><span class="meta-label">Distancia</span><span class="meta-value">${d.distance_km} km</span></div>
        <div class="meta-item"><span class="meta-label">Tarifa</span><span class="meta-value price">Q ${parseFloat(d.price).toFixed(2)}</span></div>
        ${d.driver_name ? `<div class="meta-item"><span class="meta-label">Repartidor</span><span class="meta-value">${d.driver_name}</span></div>` : ''}
        ${d.rating ? `<div class="meta-item"><span class="meta-label">Calificación</span><span class="meta-value star-display">${starsHTML(d.rating)}</span></div>` : ''}
      </div>
      ${d.status === 'entregado' && !d.rating ? `
      <div class="card-actions">
        <button class="btn btn-sm" style="background:var(--yellow);color:white" onclick="openRatingModal(${d.id})">Calificar servicio</button>
      </div>` : ''}
    </div>
  `).join('');
}

window.openRatingModal = function (id) {
  ratingDeliveryId = id; selectedRating = 0;
  document.querySelectorAll('.star-btn').forEach(s => s.classList.remove('active'));
  document.getElementById('modal-rating').classList.add('open');
};
window.closeRatingModal = function () {
  document.getElementById('modal-rating').classList.remove('open');
  ratingDeliveryId = null; selectedRating = 0;
};
window.submitRating = async function () {
  if (!selectedRating) return toast('Selecciona una calificación', 'error');
  const btn = document.getElementById('btn-submit-rating');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    await apiFetch(`/deliveries/${ratingDeliveryId}/rate`, { method: 'PATCH', body: JSON.stringify({ rating: selectedRating }) });
    toast('¡Gracias por calificar!', 'success');
    closeRatingModal();
    await loadClientDeliveries();
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = 'Enviar calificación'; }
};

window.createDelivery = async function () {
  const origin = document.getElementById('input-origin').value.trim();
  const destination = document.getElementById('input-destination').value.trim();
  const description = document.getElementById('input-description').value.trim();
  const distance_km = document.getElementById('input-km').value;
  const btn = document.getElementById('btn-create-delivery');

  if (!origin || !destination || !description || !distance_km) return toast('Completa todos los campos', 'error');
  if (parseFloat(distance_km) <= 0) return toast('La distancia debe ser mayor a 0', 'error');

  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Creando...';
  try {
    await apiFetch('/deliveries', { method: 'POST', body: JSON.stringify({ origin, destination, description, distance_km }) });
    toast('¡Envío creado!', 'success');
    ['input-origin', 'input-destination', 'input-description', 'input-km'].forEach(id => document.getElementById(id).value = '');
    updatePricePreview();
    await loadClientDeliveries();
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = 'Solicitar Envío'; }
};

// ── REPARTIDOR ─────────────────────────────────────────────────
async function showDriverDashboard() {
  showPage('page-driver');
  previousPage = 'page-driver';
  document.getElementById('driver-name').textContent = currentUser.name;
  document.getElementById('driver-email').textContent = currentUser.email + (currentUser.vehicle ? ` · ${currentUser.vehicle}` : '');
  const avatarEl = document.getElementById('driver-avatar');
  renderAvatarPhoto(avatarEl, currentUser.photo_url, currentUser.name[0].toUpperCase());
  await loadDriverDeliveries();
}

async function loadDriverDeliveries() {
  const list = document.getElementById('driver-deliveries-list');
  list.innerHTML = '<p style="color:var(--gray);text-align:center;padding:20px">Cargando pedidos...</p>';
  try {
    const data = await apiFetch('/deliveries');
    renderDriverDeliveries(data.deliveries);
  } catch (err) { toast(err.message, 'error'); }
}

function renderDriverDeliveries(deliveries) {
  const list = document.getElementById('driver-deliveries-list');
  if (!deliveries.length) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">📦</span><h3>Sin pedidos disponibles</h3><p>Refresca para ver nuevos pedidos.</p></div>`;
    return;
  }
  const mine = deliveries.filter(d => d.driver_id == currentUser.id);
  const available = deliveries.filter(d => d.status === 'pendiente');
  let html = '';

  if (mine.length) {
    html += `<h4 style="font-size:0.85rem;font-weight:700;color:var(--gray);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Mis pedidos activos</h4>`;
    html += mine.map(d => driverCard(d)).join('');
  }
  if (available.length) {
    if (mine.length) html += `<hr class="divider">`;
    html += `<h4 style="font-size:0.85rem;font-weight:700;color:var(--gray);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Pedidos disponibles en tu zona</h4>`;
    html += available.map(d => driverCard(d)).join('');
  }
  list.innerHTML = html;
}

function driverCard(d) {
  return `
    <div class="card">
      <div class="card-header">
        <div>
          <span class="card-id">#${d.id}</span>
          <span style="font-size:0.8rem;color:var(--gray);margin-left:8px">${formatDate(d.created_at)}</span>
        </div>
        ${statusHTML(d.status)}
      </div>
      <div class="delivery-route">
        <div class="route-point"><div class="label">Origen</div><div class="value">${d.origin}</div></div>
        <div class="route-arrow">→</div>
        <div class="route-point"><div class="label">Destino</div><div class="value">${d.destination}</div></div>
      </div>
      <div class="delivery-meta">
        <div class="meta-item"><span class="meta-label">Paquete</span><span class="meta-value">${d.description}</span></div>
        <div class="meta-item"><span class="meta-label">Cliente</span><span class="meta-value">${d.client_name}</span></div>
        <div class="meta-item"><span class="meta-label">Distancia</span><span class="meta-value">${d.distance_km} km</span></div>
        <div class="meta-item"><span class="meta-label">Ganancia</span><span class="meta-value price">Q ${parseFloat(d.price).toFixed(2)}</span></div>
        ${d.rating ? `<div class="meta-item"><span class="meta-label">Calificación recibida</span><span class="meta-value star-display">${starsHTML(d.rating)}</span></div>` : ''}
      </div>
      <div class="card-actions">
        ${d.status === 'pendiente' ? `<button class="btn btn-primary btn-sm" style="width:auto" onclick="acceptDelivery(${d.id})">Aceptar pedido</button>` : ''}
        ${d.status === 'en_camino' && d.driver_id == currentUser.id ? `<button class="btn btn-success btn-sm" onclick="markDelivered(${d.id})">Marcar como Entregado</button>` : ''}
        ${d.status === 'entregado' ? `<span style="color:var(--green);font-weight:700;font-size:0.85rem">Completado</span>` : ''}
      </div>
    </div>
  `;
}

window.acceptDelivery = async function (id) {
  try {
    await apiFetch(`/deliveries/${id}/accept`, { method: 'PATCH' });
    toast('¡Pedido aceptado! En camino.', 'success');
    await loadDriverDeliveries();
  } catch (err) { toast(err.message, 'error'); }
};

window.markDelivered = async function (id) {
  try {
    await apiFetch(`/deliveries/${id}/deliver`, { method: 'PATCH' });
    toast('¡Marcado como entregado!', 'success');
    await loadDriverDeliveries();
  } catch (err) { toast(err.message, 'error'); }
};

window.refreshDeliveries = async function () {
  if (currentUser.role === 'cliente') await loadClientDeliveries();
  else await loadDriverDeliveries();
  toast('Lista actualizada', 'success');
};

// ── ADMIN ──────────────────────────────────────────────────────
async function showAdminDashboard() {
  showPage('page-admin');
  previousPage = 'page-admin';
  document.getElementById('admin-name-chip').textContent = currentUser.name;
  await loadAdminDashboard();
}

async function loadAdminDashboard() {
  const kpisEl = document.getElementById('admin-kpis');
  const driversTableEl = document.getElementById('admin-drivers-table');
  const clientsTableEl = document.getElementById('admin-clients-table');

  kpisEl.innerHTML = '<p style="color:var(--gray);text-align:center;padding:20px">Cargando métricas...</p>';
  driversTableEl.innerHTML = '<p style="color:var(--gray);text-align:center;padding:20px">Cargando repartidores...</p>';
  clientsTableEl.innerHTML = '<p style="color:var(--gray);text-align:center;padding:20px">Cargando clientes...</p>';

  try {
    const [stats, topDrivers, topClients] = await Promise.all([
      apiFetch('/admin/stats'),
      apiFetch('/admin/top-drivers'),
      apiFetch('/admin/top-clients')
    ]);

    renderAdminKpis(stats);
    renderAdminCharts(stats, topDrivers.drivers || []);
    renderAdminDriversTable(topDrivers.drivers || []);
    renderAdminClientsTable(topClients.clients || []);
  } catch (err) {
    kpisEl.innerHTML = '';
    driversTableEl.innerHTML = '';
    clientsTableEl.innerHTML = '';
    toast(err.message, 'error');
  }
}

function renderAdminKpis(stats) {
  const container = document.getElementById('admin-kpis');
  const cards = [
    { label: 'Clientes', value: stats.totalClientes ?? 0, color: 'var(--orange)' },
    { label: 'Repartidores', value: stats.totalRepartidores ?? 0, color: 'var(--blue)' },
    { label: 'Pendientes', value: stats.pedidosPendientes ?? 0, color: 'var(--yellow)' },
    { label: 'En camino', value: stats.pedidosEnCamino ?? 0, color: 'var(--blue)' },
    { label: 'Entregados', value: stats.pedidosEntregados ?? 0, color: 'var(--green)' },
    { label: 'Ingresos', value: `Q ${Number(stats.totalIngresos || 0).toFixed(2)}`, color: 'var(--green)' },
    { label: 'Km totales', value: `${Number(stats.totalKm || 0).toFixed(1)} km`, color: 'var(--dark)' }
  ];

  container.className = 'admin-kpis';
  container.innerHTML = cards.map(card => `
    <div class="card admin-kpi-card">
      <div class="admin-kpi-label">${card.label}</div>
      <div class="admin-kpi-value" style="color:${card.color}">${card.value}</div>
    </div>
  `).join('');
}

function renderAdminCharts(stats, drivers) {
  const statusCanvas = document.getElementById('chart-status');
  const driversCanvas = document.getElementById('chart-drivers');

  if (adminStatusChart) adminStatusChart.destroy();
  if (adminDriversChart) adminDriversChart.destroy();

  adminStatusChart = new Chart(statusCanvas, {
    type: 'doughnut',
    data: {
      labels: ['Pendientes', 'En camino', 'Entregados'],
      datasets: [{
        data: [stats.pedidosPendientes || 0, stats.pedidosEnCamino || 0, stats.pedidosEntregados || 0],
        backgroundColor: ['#f59e0b', '#3b82f6', '#10b981'],
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom' }
      }
    }
  });

  const driverLabels = drivers.slice(0, 8).map(d => d.name);
  const driverValues = drivers.slice(0, 8).map(d => Number(d.pedidos_completados || 0));

  adminDriversChart = new Chart(driversCanvas, {
    type: 'bar',
    data: {
      labels: driverLabels,
      datasets: [{
        label: 'Pedidos completados',
        data: driverValues,
        backgroundColor: '#FF6B00',
        borderRadius: 8,
        maxBarThickness: 36
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0 }
        }
      }
    }
  });
}

function renderAdminDriversTable(drivers) {
  const container = document.getElementById('admin-drivers-table');
  if (!drivers.length) {
    container.innerHTML = '<div class="empty-state"><h3>Sin datos</h3><p>No hay repartidores para mostrar.</p></div>';
    return;
  }

  container.innerHTML = `
    <div class="admin-table admin-table-drivers">
      <div class="admin-table-head admin-table-head-drivers">
        <span>Repartidor</span><span>Vehículo</span><span>Completados</span><span>Km</span><span>Promedio</span>
      </div>
      ${drivers.map(driver => `
        <div class="admin-table-row admin-table-row-drivers">
          <span>${driver.name}</span>
          <span>${driver.vehicle || '—'}</span>
          <span>${driver.pedidos_completados || 0}</span>
          <span>${Number(driver.km_totales || 0).toFixed(1)}</span>
          <span>${Number(driver.calificacion_promedio || 0).toFixed(1)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderAdminClientsTable(clients) {
  const container = document.getElementById('admin-clients-table');
  if (!clients.length) {
    container.innerHTML = '<div class="empty-state"><h3>Sin datos</h3><p>No hay clientes para mostrar.</p></div>';
    return;
  }

  container.innerHTML = `
    <div class="admin-table admin-table-clients">
      <div class="admin-table-head admin-table-head-clients">
        <span>Cliente</span><span>Pedidos</span><span>Gasto</span><span>Km</span>
      </div>
      ${clients.map(client => `
        <div class="admin-table-row admin-table-row-clients">
          <span>${client.name}</span>
          <span>${client.pedidos_realizados || 0}</span>
          <span>Q ${Number(client.gasto_total || 0).toFixed(2)}</span>
          <span>${Number(client.km_totales || 0).toFixed(1)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

// ── PERFIL ─────────────────────────────────────────────────────
window.showProfilePage = function () {
  showPage('page-profile');

  // Foto grande
  const img = document.getElementById('profile-photo-img');
  const avatarBig = document.getElementById('profile-avatar-big');
  img.src = currentUser.photo_url || '/img/default-avatar.png';
  img.style.display = 'block';
  avatarBig.style.display = 'none';

  // Datos
  document.getElementById('profile-name').value = currentUser.name || '';
  document.getElementById('profile-email').value = currentUser.email || '';
  document.getElementById('profile-role').textContent =
    currentUser.role === 'cliente' ? 'Cliente' : currentUser.role === 'repartidor' ? 'Repartidor' : 'Administrador';

  const vehicleRow = document.getElementById('profile-vehicle-row');
  if (currentUser.role === 'repartidor') {
    vehicleRow.style.display = 'grid';
    document.getElementById('profile-vehicle').value = currentUser.vehicle || '';
  } else {
    vehicleRow.style.display = 'none';
  }

  document.getElementById('profile-since').textContent =
    currentUser.created_at ? formatDate(currentUser.created_at) : '—';

  document.getElementById('profile-photo-status').textContent = '';
};

window.saveProfile = async function () {
  const name = document.getElementById('profile-name').value.trim();
  const email = document.getElementById('profile-email').value.trim();
  const vehicleInput = document.getElementById('profile-vehicle');
  const vehicle = vehicleInput ? vehicleInput.value.trim() : '';
  const btn = document.getElementById('btn-save-profile');

  if (!name || !email) return toast('Nombre y correo son obligatorios', 'error');

  const payload = { name, email };
  if (currentUser.role === 'repartidor') payload.vehicle = vehicle;

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Guardando...';
  try {
    const data = await apiFetch('/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });

    currentUser = data.user;
    toast('Perfil actualizado', 'success');
    showProfilePage();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Guardar cambios';
  }
};

window.goBackFromProfile = function () {
  if (previousPage === 'page-admin') showAdminDashboard();
  else if (previousPage === 'page-driver') showDriverDashboard();
  else showClientDashboard();
};

// Subir nueva foto de perfil
window.uploadProfilePhoto = async function (input) {
  const file = input.files[0];
  if (!file) return;

  const statusEl = document.getElementById('profile-photo-status');
  statusEl.textContent = 'Subiendo...';

  const formData = new FormData();
  formData.append('photo', file);

  try {
    const res = await fetch(`${API}/auth/profile`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${getToken()}` },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error de servidor');

    // Actualizar usuario en memoria
    currentUser = data.user;

    // Actualizar foto en la página de perfil
    const img = document.getElementById('profile-photo-img');
    const avatarBig = document.getElementById('profile-avatar-big');
    img.src = data.user.photo_url;
    img.style.display = 'block';
    avatarBig.style.display = 'none';

    // Actualizar avatar en el dashboard correspondiente
    if (currentUser.role === 'cliente') {
      renderAvatarPhoto(document.getElementById('client-avatar'), currentUser.photo_url, currentUser.name[0].toUpperCase());
    } else {
      renderAvatarPhoto(document.getElementById('driver-avatar'), currentUser.photo_url, currentUser.name[0].toUpperCase());
    }

    statusEl.textContent = 'Foto actualizada ✓';
    toast('Foto de perfil actualizada', 'success');
  } catch (err) {
    statusEl.textContent = '';
    toast(err.message, 'error');
  }
};