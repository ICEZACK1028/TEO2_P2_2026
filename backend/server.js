const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'flash_delivery_secret_2026';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'flash_delivery.db');

app.use(cors());
app.use(express.json());

// ─── DATABASE SETUP ───────────────────────────────────────────────────────────
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT    NOT NULL,
    email     TEXT    UNIQUE NOT NULL,
    password  TEXT    NOT NULL,
    role      TEXT    NOT NULL CHECK(role IN ('cliente','repartidor')),
    vehicle   TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS deliveries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id   INTEGER NOT NULL,
    driver_id   INTEGER,
    origin      TEXT    NOT NULL,
    destination TEXT    NOT NULL,
    description TEXT    NOT NULL,
    distance_km REAL    NOT NULL,
    price       REAL    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'pendiente'
                CHECK(status IN ('pendiente','en_camino','entregado')),
    rating      INTEGER CHECK(rating BETWEEN 1 AND 5),
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(client_id)  REFERENCES users(id),
    FOREIGN KEY(driver_id)  REFERENCES users(id)
  );
`);

console.log('Base de datos inicializada en', DB_PATH);

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.user = jwt.verify(header.split(' ')[1], JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role, vehicle } = req.body;
    if (!name || !email || !password || !role)
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    if (!['cliente', 'repartidor'].includes(role))
      return res.status(400).json({ error: 'Rol inválido' });

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return res.status(409).json({ error: 'El email ya está registrado' });

    const hashed = await bcrypt.hash(password, 10);
    const result = db.prepare(
      'INSERT INTO users (name, email, password, role, vehicle) VALUES (?,?,?,?,?)'
    ).run(name, email, hashed, role, vehicle || null);

    const user = { id: result.lastInsertRowid, name, email, role, vehicle: vehicle || null };
    const token = jwt.sign({ id: user.id, name, email, role }, JWT_SECRET, { expiresIn: '24h' });
    res.status(201).json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email y contraseña requeridos' });

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Credenciales incorrectas' });

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, vehicle: user.vehicle } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', auth, (req, res) => {
  const user = db.prepare('SELECT id, name, email, role, vehicle FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ user });
});

// ─── DELIVERY ROUTES ──────────────────────────────────────────────────────────

const deliveryQuery = `
  SELECT d.*,
         u.name  AS client_name,
         dr.name AS driver_name,
         dr.vehicle AS driver_vehicle
  FROM deliveries d
  JOIN  users u  ON d.client_id = u.id
  LEFT JOIN users dr ON d.driver_id  = dr.id
`;

// POST /api/deliveries
app.post('/api/deliveries', auth, (req, res) => {
  try {
    if (req.user.role !== 'cliente')
      return res.status(403).json({ error: 'Solo los clientes pueden crear envíos' });

    const { origin, destination, description, distance_km } = req.body;
    if (!origin || !destination || !description || !distance_km)
      return res.status(400).json({ error: 'Todos los campos son requeridos' });

    const km = parseFloat(distance_km);
    if (isNaN(km) || km <= 0) return res.status(400).json({ error: 'Distancia inválida' });

    const price = Math.round(km * 5.0 * 100) / 100;
    const result = db.prepare(
      'INSERT INTO deliveries (client_id, origin, destination, description, distance_km, price) VALUES (?,?,?,?,?,?)'
    ).run(req.user.id, origin, destination, description, km, price);

    const delivery = db.prepare(`${deliveryQuery} WHERE d.id = ?`).get(result.lastInsertRowid);
    res.status(201).json({ delivery });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/deliveries
app.get('/api/deliveries', auth, (req, res) => {
  try {
    let deliveries;
    if (req.user.role === 'cliente') {
      deliveries = db.prepare(`${deliveryQuery} WHERE d.client_id = ? ORDER BY d.created_at DESC`).all(req.user.id);
    } else {
      deliveries = db.prepare(`${deliveryQuery} WHERE d.status = 'pendiente' OR d.driver_id = ? ORDER BY d.created_at DESC`).all(req.user.id);
    }
    res.json({ deliveries });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PATCH /api/deliveries/:id/accept
app.patch('/api/deliveries/:id/accept', auth, (req, res) => {
  try {
    if (req.user.role !== 'repartidor')
      return res.status(403).json({ error: 'Solo los repartidores pueden aceptar envíos' });

    const delivery = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(req.params.id);
    if (!delivery) return res.status(404).json({ error: 'Envío no encontrado' });
    if (delivery.status !== 'pendiente') return res.status(400).json({ error: 'Este envío ya no está disponible' });

    db.prepare('UPDATE deliveries SET driver_id = ?, status = ? WHERE id = ?')
      .run(req.user.id, 'en_camino', req.params.id);

    const updated = db.prepare(`${deliveryQuery} WHERE d.id = ?`).get(req.params.id);
    res.json({ delivery: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PATCH /api/deliveries/:id/deliver
app.patch('/api/deliveries/:id/deliver', auth, (req, res) => {
  try {
    if (req.user.role !== 'repartidor')
      return res.status(403).json({ error: 'Solo los repartidores pueden marcar como entregado' });

    const delivery = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(req.params.id);
    if (!delivery) return res.status(404).json({ error: 'Envío no encontrado' });
    if (delivery.driver_id != req.user.id) return res.status(403).json({ error: 'No eres el repartidor de este envío' });
    if (delivery.status !== 'en_camino') return res.status(400).json({ error: 'El envío no está en camino' });

    db.prepare('UPDATE deliveries SET status = ? WHERE id = ?').run('entregado', req.params.id);

    const updated = db.prepare(`${deliveryQuery} WHERE d.id = ?`).get(req.params.id);
    res.json({ delivery: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PATCH /api/deliveries/:id/rate
app.patch('/api/deliveries/:id/rate', auth, (req, res) => {
  try {
    if (req.user.role !== 'cliente')
      return res.status(403).json({ error: 'Solo los clientes pueden calificar' });

    const { rating } = req.body;
    if (!rating || rating < 1 || rating > 5)
      return res.status(400).json({ error: 'La calificación debe ser entre 1 y 5' });

    const delivery = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(req.params.id);
    if (!delivery) return res.status(404).json({ error: 'Envío no encontrado' });
    if (delivery.client_id != req.user.id) return res.status(403).json({ error: 'No eres el cliente de este envío' });
    if (delivery.status !== 'entregado') return res.status(400).json({ error: 'El envío aún no fue entregado' });
    if (delivery.rating) return res.status(400).json({ error: 'Ya calificaste este envío' });

    db.prepare('UPDATE deliveries SET rating = ? WHERE id = ?').run(rating, req.params.id);

    const updated = db.prepare(`${deliveryQuery} WHERE d.id = ?`).get(req.params.id);
    res.json({ delivery: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/health
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'Flash Delivery API' }));

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Flash Delivery API en http://localhost:${PORT}`);
});
