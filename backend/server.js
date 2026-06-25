const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'flash_delivery_secret_2026';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'flash_delivery.db');
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/uploads';

app.use(cors());
app.use(express.json());

// ─── UPLOADS ──────────────────────────────────────────────────────────────────
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use('/uploads', express.static(UPLOADS_DIR));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo se permiten imágenes'));
  }
});

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
    role      TEXT    NOT NULL CHECK(role IN ('cliente','repartidor','admin')),
    vehicle   TEXT,
    photo_url TEXT,
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

// ─── ADMIN SEED ───────────────────────────────────────────────────────────────
(async () => {
  const existing = db.prepare("SELECT id FROM users WHERE email = 'admin@flashdelivery.com'").get();
  if (!existing) {
    const hashed = await bcrypt.hash('admin1234', 10);
    db.prepare("INSERT INTO users (name, email, password, role) VALUES (?,?,?,?)")
      .run('Administrador', 'admin@flashdelivery.com', hashed, 'admin');
    console.log('Usuario admin creado: admin@flashdelivery.com / admin1234');
  }
})();

console.log('Base de datos inicializada en', DB_PATH);

// ─── MIDDLEWARES ──────────────────────────────────────────────────────────
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

function isAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acceso denegado' });
  next();
}

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────

// POST /api/auth/register  (multipart/form-data)
app.post('/api/auth/register', upload.single('photo'), async (req, res) => {
  try {
    const { name, email, password, role, vehicle } = req.body;
    if (!name || !email || !password || !role)
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    if (!['cliente', 'repartidor'].includes(role))
      return res.status(400).json({ error: 'Rol inválido' });

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return res.status(409).json({ error: 'El email ya está registrado' });

    const hashed = await bcrypt.hash(password, 10);
    const photo_url = req.file ? `/uploads/${req.file.filename}` : null;

    const result = db.prepare(
      'INSERT INTO users (name, email, password, role, vehicle, photo_url) VALUES (?,?,?,?,?,?)'
    ).run(name, email, hashed, role, vehicle || null, photo_url);

    const user = db.prepare(
      'SELECT id, name, email, role, vehicle, photo_url, created_at FROM users WHERE id = ?'
    ).get(result.lastInsertRowid);
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
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        vehicle: user.vehicle,
        photo_url: user.photo_url,
        created_at: user.created_at
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', auth, (req, res) => {
  const user = db.prepare('SELECT id, name, email, role, vehicle, photo_url, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ user });
});

// PATCH /api/auth/profile  (actualizar datos y/o foto de perfil)
app.patch('/api/auth/profile', auth, upload.single('photo'), (req, res) => {
  try {
    const { name, email, vehicle } = req.body;
    const current = db.prepare('SELECT id, role, photo_url, email FROM users WHERE id = ?').get(req.user.id);
    if (!current) return res.status(404).json({ error: 'Usuario no encontrado' });

    const updates = [];
    const values = [];

    if (name !== undefined) {
      const trimmedName = String(name).trim();
      if (!trimmedName) return res.status(400).json({ error: 'El nombre no puede estar vacío' });
      updates.push('name = ?');
      values.push(trimmedName);
    }

    if (email !== undefined) {
      const trimmedEmail = String(email).trim().toLowerCase();
      if (!trimmedEmail) return res.status(400).json({ error: 'El correo no puede estar vacío' });
      const emailTaken = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(trimmedEmail, req.user.id);
      if (emailTaken) return res.status(409).json({ error: 'El email ya está registrado' });
      updates.push('email = ?');
      values.push(trimmedEmail);
    }

    if (vehicle !== undefined) {
      if (current.role !== 'repartidor') {
        updates.push('vehicle = NULL');
      } else {
        const trimmedVehicle = String(vehicle).trim();
        updates.push('vehicle = ?');
        values.push(trimmedVehicle || null);
      }
    }

    if (req.file) {
      // Eliminar foto anterior si existe
      if (current.photo_url) {
        const oldPath = path.join(UPLOADS_DIR, path.basename(current.photo_url));
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }

      updates.push('photo_url = ?');
      values.push(`/uploads/${req.file.filename}`);
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'No se recibieron cambios para actualizar' });
    }

    values.push(req.user.id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const user = db.prepare('SELECT id, name, email, role, vehicle, photo_url, created_at FROM users WHERE id = ?').get(req.user.id);
    res.json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
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

    // Verificar que el repartidor no tenga ya un pedido activo
    const active = db.prepare("SELECT id FROM deliveries WHERE driver_id = ? AND status = 'en_camino'").get(req.user.id);
    if (active) return res.status(400).json({ error: 'Ya tienes un pedido en camino. Entrega el pedido actual primero.' });

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

// ─── ADMIN ROUTES ─────────────────────────────────────────────────────────────

// GET /api/admin/stats — KPIs generales
app.get('/api/admin/stats', auth, isAdmin, (req, res) => {
  try {
    const totalClientes   = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'cliente'").get().count;
    const totalRepartidores = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'repartidor'").get().count;
    const pedidosPendientes = db.prepare("SELECT COUNT(*) AS count FROM deliveries WHERE status = 'pendiente'").get().count;
    const pedidosEnCamino  = db.prepare("SELECT COUNT(*) AS count FROM deliveries WHERE status = 'en_camino'").get().count;
    const pedidosEntregados = db.prepare("SELECT COUNT(*) AS count FROM deliveries WHERE status = 'entregado'").get().count;
    const totalIngresos    = db.prepare("SELECT COALESCE(SUM(price), 0) AS total FROM deliveries WHERE status = 'entregado'").get().total;
    const totalKm          = db.prepare("SELECT COALESCE(SUM(distance_km), 0) AS total FROM deliveries WHERE status = 'entregado'").get().total;

    res.json({
      totalClientes,
      totalRepartidores,
      pedidosPendientes,
      pedidosEnCamino,
      pedidosEntregados,
      totalIngresos,
      totalKm
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/admin/top-drivers — top repartidores
app.get('/api/admin/top-drivers', auth, isAdmin, (req, res) => {
  try {
    const drivers = db.prepare(`
      SELECT u.name,
             u.vehicle,
             u.photo_url,
             COUNT(d.id)                          AS pedidos_completados,
             COALESCE(SUM(d.distance_km), 0)      AS km_totales,
             COALESCE(AVG(d.rating), 0)            AS calificacion_promedio
      FROM users u
      LEFT JOIN deliveries d ON d.driver_id = u.id AND d.status = 'entregado'
      WHERE u.role = 'repartidor'
      GROUP BY u.id
      ORDER BY pedidos_completados DESC
      LIMIT 10
    `).all();
    res.json({ drivers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/admin/top-clients — top clientes
app.get('/api/admin/top-clients', auth, isAdmin, (req, res) => {
  try {
    const clients = db.prepare(`
      SELECT u.name,
             u.photo_url,
             COUNT(d.id)                     AS pedidos_realizados,
             COALESCE(SUM(d.price), 0)       AS gasto_total,
             COALESCE(SUM(d.distance_km), 0) AS km_totales
      FROM users u
      LEFT JOIN deliveries d ON d.client_id = u.id
      WHERE u.role = 'cliente'
      GROUP BY u.id
      ORDER BY pedidos_realizados DESC
      LIMIT 10
    `).all();
    res.json({ clients });
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