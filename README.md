![CI](https://github.com/DavidGV-ux/Back-Reserva-Ya/actions/workflows/ci.yml/badge.svg)

# ReservaYa – Back

API de ReservaYa (Node.js + TypeScript + Express + MongoDB + Keycloak) con arquitectura hexagonal.

## Integración continua
Cada push y Pull Request hacia `main` ejecuta el workflow `.github/workflows/ci.yml`:
instala dependencias, verifica tipos (`npm run typecheck`) y corre las pruebas (`npm test`).

## Comandos
- `npm install` – instalar dependencias
- `npm run typecheck` – verificar tipos
- `npm test` – correr pruebas (requiere MongoDB como replica set)