# Cube Core IDE

Web-based IDE for editing Cube Core cube/view YAML files with hot reload.

## Features

- **Visual File Tree**: Auto-categorizes files into Cubes, Views, and Others
- **Monaco Editor**: Full-featured YAML editor with syntax highlighting
- **Hot Reload**: Watches the model directory for external changes and live-updates the editor via WebSocket
- **YAML Validation**: Saves are validated server-side before writing to disk
- **CRUD Operations**: Create, read, update, and delete YAML files directly from the browser

## Architecture

```
cube-core-ide/
├── server/          # Express + WebSocket backend (port 4001)
│   └── index.ts
├── client/          # Vite + React + Monaco frontend (port 5173)
│   └── src/
└── demo-models/     # Sample cube/view YAML files
```

## Quick Start

### 1. Install dependencies

```bash
cd /Users/lute/code/cube-core-ide
npm run install:all
```

### 2. Start dev server

```bash
npm run dev
```

This starts both:
- **Backend** on `http://localhost:4001`
- **Frontend** on `http://localhost:5173`

### 3. Open in browser

Navigate to: **http://localhost:5173**

## Hot Reload Directory

By default, the server watches `/Users/lute/code/cube-core-ide/demo-models`. To use your own Cube model directory:

```bash
CUBE_HOT_RELOAD_DIR=/path/to/your/models npm run dev
```

Or modify the `dev:server` script in `package.json`.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/files` | List all YAML files with type detection |
| GET | `/api/files/:path` | Read a file |
| POST | `/api/files/:path` | Write a file (with YAML validation) |
| DELETE | `/api/files/:path` | Delete a file |
| WS | `/ws` | WebSocket for file change notifications |

## Usage Example

1. Open `http://localhost:5173`
2. Click on **active_users_by_device.yml** in the left sidebar
3. Edit the `ai_context` or add new measures in the Monaco editor
4. Click **保存** to write back to disk
5. If you edit the same file externally (e.g., in VS Code), the browser editor will auto-reload

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start both server and client in dev mode |
| `npm run dev:server` | Start backend only |
| `npm run dev:client` | Start frontend only |
| `npm run build` | Build frontend for production |

## License

MIT
