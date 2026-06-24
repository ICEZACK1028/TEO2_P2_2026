# ⚡ Flash Delivery MVP
**Proyecto #2 — Metodología Ágil | Teoría de Sistemas 2**

##  Correr con Docker 

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
│   └── server.js              ← API REST (Express + SQLite)
└── frontend/
    ├── Dockerfile             ← nginx:alpine
    ├── nginx.conf             ← Sirve archivos + proxy /api → backend
    ├── index.html
    ├── css/styles.css
    └── js/app.js
```

### Contenedores

| Contenedor | Imagen | Puerto | Función |
|------------|--------|--------|---------|
| `flash_backend` | node:20-alpine | 3000 | API REST + SQLite |
| `flash_frontend` | nginx:alpine | 8080 | Archivos estáticos + proxy |


---

## 📡 API Endpoints

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | `/api/auth/register` | No | Registrar usuario |
| POST | `/api/auth/login` | No | Iniciar sesión |
| GET | `/api/auth/me` | JWT | Perfil del usuario |
| POST | `/api/deliveries` | JWT (cliente) | Crear envío |
| GET | `/api/deliveries` | JWT | Listar envíos |
| PATCH | `/api/deliveries/:id/accept` | JWT (repartidor) | Aceptar pedido |
| PATCH | `/api/deliveries/:id/deliver` | JWT (repartidor) | Marcar entregado |
| PATCH | `/api/deliveries/:id/rate` | JWT (cliente) | Calificar 1-5 ⭐ |
| GET | `/api/health` | No | Health check |

---

## ✅ Épicas Implementadas

### Épica A — Gestión de Usuarios
- Registro de Clientes y Repartidores con contraseñas hasheadas (bcryptjs)
- Inicio de sesión con JWT (válido 24h)
- Perfil básico: nombre, email, vehículo para repartidor

### Épica B — Solicitud de Envío
- Cliente crea solicitud: Origen, Destino, Descripción, Distancia
- Cálculo automático: **Km × Q5.00** con preview en tiempo real

### Épica C — El "Match"
- Repartidor ve lista de pedidos disponibles en su zona
- Acepta un pedido → estado cambia a "En camino"

### Épica D — Finalización
- Repartidor marca "Entregado"
- Cliente califica el servicio con 1-5 estrellas

---

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js 20 + Express.js |
| Base de datos | SQLite (better-sqlite3) |
| Autenticación | JWT + bcryptjs |
| Frontend | HTML5 + CSS3 + JavaScript vanilla |
| Servidor web | Nginx (Alpine) |
| Contenedores | Docker + Docker Compose |
