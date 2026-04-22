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

The Vite dev server uses **`VITE_PORT`** (or **`CLIENT_PORT`**) for its listen port — not `PORT`, which is reserved for the API server. If `PORT` is set in your environment (e.g. `PORT=4001`), sharing it with Vite used to steal the backend port and produce **`ws proxy error … ECONNREFUSED`** until the mismatch was fixed.

### 3. Open in browser

Navigate to: **http://localhost:5173**

## Hot Reload Directory

By default, the server watches `/Users/lute/code/cube-core-ide/demo-models`. To use your own Cube model directory:

```bash
CUBE_HOT_RELOAD_DIR=/path/to/your/models npm run dev
```

Table YAML files live in a separate directory controlled by **`TABLE_HOT_RELOAD_DIR`** (defaults to `<CUBE_HOT_RELOAD_DIR>/tables` when unset). The HTTP API still exposes them under the virtual path prefix `tables/` so the client does not need to change.

```bash
CUBE_HOT_RELOAD_DIR=/path/to/your/models \
TABLE_HOT_RELOAD_DIR=/path/to/your/table-yaml npm run dev
```

Or modify the `dev:server` script in `package.json`.

## StarRocks 同步

在 Tables 页面右上角点击 **同步数据**，后端会读取配置的 StarRocks 数据库元信息，为所有在本地尚未配置的物理表自动生成 `tables/<name>.yml`（包含 `name`、`title`、`description` 取自表 comment，字段列表取自 `information_schema.columns`）。

通过环境变量配置 StarRocks 连接：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `STARROCKS_HOST` | `127.0.0.1` | StarRocks FE 主机 |
| `STARROCKS_PORT` | `9030` | MySQL 协议端口 |
| `STARROCKS_USER` | `root` | 用户名 |
| `STARROCKS_PASSWORD` | `` | 密码 |
| `STARROCKS_DATABASE` | `` | **必填**，要同步的数据库名 |

示例：

```bash
STARROCKS_HOST=10.0.0.12 \
STARROCKS_PORT=9030 \
STARROCKS_USER=analytics \
STARROCKS_PASSWORD=secret \
STARROCKS_DATABASE=dwd \
npm run dev
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/files` | List all YAML files with type detection |
| GET | `/api/files/:path` | Read a file |
| POST | `/api/files/:path` | Write a file (with YAML validation) |
| DELETE | `/api/files/:path` | Delete a file |
| GET | `/api/starrocks/config` | StarRocks 连接信息（不含密码） |
| POST | `/api/starrocks/sync` | 同步 StarRocks 元信息到本地 `tables/*.yml` |
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
