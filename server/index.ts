import express from "express";
import cors from "cors";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { WebSocketServer } from "ws";
import chokidar from "chokidar";
import YAML from "yaml";
import { createServer } from "http";

const PORT = Number(process.env.PORT) || 4001;
const HOST = process.env.HOST || "0.0.0.0";
const HOT_RELOAD_DIR = process.env.CUBE_HOT_RELOAD_DIR || path.resolve(process.cwd(), "../demo-models");

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

app.use(cors());
app.use(express.json({ limit: "10mb" }));

interface FileInfo {
  path: string;
  name: string;
  type: "cube" | "view" | "unknown";
}

async function scanYamlFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(current: string) {
    let entries: fsSync.Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml"))) {
        results.push(fullPath);
      }
    }
  }
  await walk(dir);
  return results.sort();
}

async function detectFileType(filePath: string): Promise<FileInfo["type"]> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const doc = YAML.parse(content);
    if (doc && typeof doc === "object") {
      if ("cubes" in doc || "cube" in doc) return "cube";
      if ("views" in doc || "view" in doc) return "view";
    }
  } catch {
    // ignore
  }
  return "unknown";
}

function toRelative(filePath: string) {
  return path.relative(HOT_RELOAD_DIR, filePath);
}

function fromRelative(rel: string) {
  const safe = rel.replace(/\.\./g, "").replace(/\\/g, "/");
  return path.resolve(HOT_RELOAD_DIR, safe);
}

// Ensure hot reload dir exists
if (!fsSync.existsSync(HOT_RELOAD_DIR)) {
  fsSync.mkdirSync(HOT_RELOAD_DIR, { recursive: true });
}

// API: list files
app.get("/api/files", async (_req, res) => {
  const files = await scanYamlFiles(HOT_RELOAD_DIR);
  const infos: FileInfo[] = await Promise.all(
    files.map(async (f) => ({
      path: toRelative(f),
      name: path.basename(f),
      type: await detectFileType(f),
    }))
  );
  res.json(infos);
});

// API: read file
app.get("/api/files/*", async (req, res) => {
  const rel = (req.params as Record<string, string>)[0];
  const filePath = fromRelative(rel);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    res.json({ content, path: rel });
  } catch (e: any) {
    res.status(404).json({ error: e.message });
  }
});

// API: write file
app.post("/api/files/*", async (req, res) => {
  const rel = (req.params as Record<string, string>)[0];
  const filePath = fromRelative(rel);
  const { content, validate = true } = req.body;

  if (validate) {
    try {
      YAML.parse(content);
    } catch (e: any) {
      res.status(400).json({ error: `YAML validation failed: ${e.message}` });
      return;
    }
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
  res.json({ success: true, path: rel });
});

// API: delete file
app.delete("/api/files/*", async (req, res) => {
  const rel = (req.params as Record<string, string>)[0];
  const filePath = fromRelative(rel);
  try {
    await fs.unlink(filePath);
    res.json({ success: true, path: rel });
  } catch (e: any) {
    res.status(404).json({ error: e.message });
  }
});

// File watcher + WebSocket broadcast
const watcher = chokidar.watch([`${HOT_RELOAD_DIR}/**/*.yml`, `${HOT_RELOAD_DIR}/**/*.yaml`], {
  ignored: /node_modules/,
  persistent: true,
  ignoreInitial: true,
});

function broadcast(event: string, filePath: string) {
  const rel = toRelative(filePath);
  const msg = JSON.stringify({ event, path: rel });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(msg);
    }
  });
}

watcher
  .on("change", (filePath) => broadcast("file:changed", filePath))
  .on("add", (filePath) => broadcast("file:added", filePath))
  .on("unlink", (filePath) => broadcast("file:deleted", filePath));

httpServer.listen(PORT, HOST, () => {
  console.log(`Cube Core IDE server listening on http://${HOST}:${PORT}`);
  console.log(`Hot reload dir: ${HOT_RELOAD_DIR}`);
});
