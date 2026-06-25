# ⚡ Flash Delivery MVP
**Proyecto #2 — Metodología Ágil | Teoría de Sistemas 2**

## Correr con Docker

### Requisito único
Instala **Docker Desktop**: https://www.docker.com/products/docker-desktop/

### Pasos para levantar el proyecto

```bash
docker compose up --build
```

| Servicio | URL |
|----------|-----|
| **App Web (Frontend)** | http://localhost:8080 |
| **API Backend** | http://localhost:3000/api |
| **Health check** | http://localhost:3000/api/health |

---

## 🏗️ Arquitectura

```
flash-delivery-docker/
├── docker-compose.yml         ← Orquesta los 2 contenedores
├── backend/
│   ├── Dockerfile             ← node:20-alpine
│   ├── package.json
│   └── server.js              ← API REST (Express + SQLite + Multer)
└── frontend/
    ├── Dockerfile             ← nginx:alpine
    ├── nginx.conf             ← Sirve archivos + proxy /api y /uploads → backend
    ├── index.html
    ├── css/styles.css
    ├── img/
    │   └── default-avatar.png ← Foto de perfil por defecto
    └── js/app.js
```

### Contenedores

| Contenedor | Imagen | Puerto | Función |
|------------|--------|--------|---------|
| `flash_backend` | node:20-alpine | 3000 | API REST + SQLite + uploads |
| `flash_frontend` | nginx:alpine | 8080 | Archivos estáticos + proxy |

---

## 📡 API Endpoints

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | `/api/auth/register` | No | Registrar usuario (multipart/form-data) |
| POST | `/api/auth/login` | No | Iniciar sesión |
| GET | `/api/auth/me` | JWT | Perfil del usuario |
| PATCH | `/api/auth/profile` | JWT | Actualizar foto de perfil |
| POST | `/api/deliveries` | JWT (cliente) | Crear envío |
| GET | `/api/deliveries` | JWT | Listar envíos |
| PATCH | `/api/deliveries/:id/accept` | JWT (repartidor) | Aceptar pedido |
| PATCH | `/api/deliveries/:id/deliver` | JWT (repartidor) | Marcar entregado |
| PATCH | `/api/deliveries/:id/rate` | JWT (cliente) | Calificar 1-5 ⭐ |
| GET | `/api/admin/stats` | JWT (admin) | KPIs generales |
| GET | `/api/admin/top-drivers` | JWT (admin) | Top repartidores |
| GET | `/api/admin/top-clients` | JWT (admin) | Top clientes |
| GET | `/api/health` | No | Health check |

---

## 👤 Usuario Admin

Al iniciar el servidor se crea automáticamente un usuario administrador:

| Campo | Valor |
|-------|-------|
| Email | `admin@flashdelivery.com` |
| Contraseña | `admin1234` |

---

## ✅ Épicas Implementadas

### Épica A — Gestión de Usuarios
- Registro de Clientes y Repartidores con contraseñas hasheadas (bcryptjs)
- Inicio de sesión con JWT (válido 24h)
- Perfil básico: nombre, email, vehículo para repartidor
- **Foto de perfil**: subida real de imagen (Multer, límite 2MB) con foto por defecto
- **Vista de perfil**: página dedicada con edición de foto desde el dashboard

### Épica B — Solicitud de Envío
- Cliente crea solicitud: Origen, Destino, Descripción, Distancia
- Cálculo automático: **Km × Q5.00** con preview en tiempo real

### Épica C — El "Match"
- Repartidor ve lista de pedidos disponibles en su zona
- Acepta un pedido → estado cambia a "En camino"
- **Restricción**: un repartidor solo puede tener un pedido activo a la vez

### Épica D — Finalización
- Repartidor marca "Entregado"
- Cliente califica el servicio con 1-5 estrellas

### Extra — Panel de Administración
- Dashboard exclusivo para el rol `admin`
- **KPIs**: total de clientes, repartidores, pedidos por estado, ingresos y km totales
- **Gráfica de dona**: distribución de pedidos por estado (Chart.js)
- **Gráfica de barras**: top repartidores por pedidos completados (Chart.js)
- **Tabla de repartidores**: pedidos completados, km totales y calificación promedio
- **Tabla de clientes**: pedidos realizados y gasto total

---

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js 20 + Express.js |
| Base de datos | SQLite (better-sqlite3) |
| Autenticación | JWT + bcryptjs |
| Subida de archivos | Multer |
| Frontend | HTML5 + CSS3 + JavaScript vanilla |
| Gráficas | Chart.js |
| Servidor web | Nginx (Alpine) |
| Contenedores | Docker + Docker Compose |