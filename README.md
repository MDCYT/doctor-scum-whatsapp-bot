# Bot de WhatsApp: Doctor Scum

Bot en Node.js/TypeScript que rolea como Doctor Scum (Dog Man) usando OpenAI, Baileys (sin navegador) y SQLite.

## Requisitos
- Node.js 18+
- Una cuenta de OpenAI y API key

## Instalacion
```bash
npm install
cp .env.example .env
# Edita .env con tu API key y owner IDs
npm run dev
```
El primer arranque mostrara un QR en consola para vincular el numero de WhatsApp.

## Variables clave (.env)
- OPENAI_API_KEY: tu clave de OpenAI
- OPENAI_MODEL: p.ej. gpt-4.1
- OWNER_IDS: numeros separados por coma (sin +), ej: 5491111111111
- DB_PATH: ruta a la base SQLite (default data/bot.db)
- TEMPERATURE: 0-1 (default 0.7)

## Prefijo y comandos (ds.)
- ds.ayuda
- ds.estado
- ds.persona <texto> (dueños)
- ds.temp <0-1> (dueños)
- ds.autorizar <numero> / ds.desautorizar <numero> (dueños)
- ds.autorizar-grupo [aqui|id] / ds.desautorizar-grupo [aqui|id] (dueños)
- ds.listar
- ds.nueva-sesion <nombre>
- ds.usar-sesion <nombre>
- ds.cerrar-sesion
- ds.listar-sesiones
- ds.reset

## Flujo
- Usuarios/grupos deben estar autorizados (o ser owner).
- Prefijo `ds.` para comandos; resto se envia al modelo de rol.
- Sesiones guardan historial en SQLite; si pasan 1h sin uso se cierran y se pide reactivar.
- El bot resume historial cuando crece para mantener contexto.

## Despliegue
Para produccion puedes usar `npm run build` y luego `npm start`, o un supervisor tipo PM2/Docker. Asegura respaldar `data/` y `auth/` para no perder sesiones ni DB.
