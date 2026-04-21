import express from "express";
import cors from "cors";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { WebSocketServer } from "ws";
import chokidar from "chokidar";
import YAML from "yaml";
import { createServer } from "http";
import mysql from "mysql2/promise";

const PORT = Number(process.env.PORT) || 4001;
const HOST = process.env.HOST || "0.0.0.0";
const HOT_RELOAD_DIR = process.env.CUBE_HOT_RELOAD_DIR || path.resolve(process.cwd(), "../demo-models");

// StarRocks connection config (read from env at request time so that
// dotenv / runtime changes are picked up without restart).
interface StarRocksConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

function getStarRocksConfig(): StarRocksConfig {
  return {
    host: process.env.STARROCKS_HOST || "127.0.0.1",
    port: Number(process.env.STARROCKS_PORT) || 9030,
    user: process.env.STARROCKS_USER || "root",
    password: process.env.STARROCKS_PASSWORD || "",
    database: process.env.STARROCKS_DATABASE || "",
  };
}

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

app.use(cors());
app.use(express.json({ limit: "10mb" }));

interface FileInfo {
  path: string;
  name: string;
  type: "cube" | "view" | "table" | "unknown";
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
  // Path-based hint takes precedence for empty / work-in-progress files
  const rel = toRelative(filePath).replace(/\\/g, "/");
  const pathHint: FileInfo["type"] | null = rel.startsWith("cubes/")
    ? "cube"
    : rel.startsWith("views/")
    ? "view"
    : rel.startsWith("tables/")
    ? "table"
    : null;

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const doc = YAML.parse(content);
    if (doc && typeof doc === "object") {
      if ("cubes" in doc || "cube" in doc) return "cube";
      if ("views" in doc || "view" in doc) return "view";
      if ("tables" in doc || "table" in doc) return "table";
    }
  } catch {
    // ignore
  }
  return pathHint ?? "unknown";
}

function toRelative(filePath: string) {
  return path.relative(HOT_RELOAD_DIR, filePath);
}

function fromRelative(rel: string) {
  const safe = rel.replace(/\.\./g, "").replace(/\\/g, "/");
  return path.resolve(HOT_RELOAD_DIR, safe);
}

// Ensure hot reload dir exists, pre-create conventional sub-folders
if (!fsSync.existsSync(HOT_RELOAD_DIR)) {
  fsSync.mkdirSync(HOT_RELOAD_DIR, { recursive: true });
}
for (const sub of ["cubes", "views", "tables"]) {
  const p = path.join(HOT_RELOAD_DIR, sub);
  if (!fsSync.existsSync(p)) fsSync.mkdirSync(p, { recursive: true });
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

// ---- Catalog helpers ----

interface CubeCatalogEntry {
  path: string;
  fileName: string;
  index: number;
  name: string;
  title: string;
  description: string;
  sql_table: string;
  extends: string;
}

interface ViewCatalogEntry {
  path: string;
  fileName: string;
  index: number;
  name: string;
  title: string;
  description: string;
  cubes: string[];
}

interface TableCatalogEntry {
  path: string;
  fileName: string;
  name: string;
  title: string;
  description: string;
  lineage: string;
  sql_table: string;
  schema: string;
  database: string;
  fieldCount: number;
}

interface CatalogResponse {
  cubes: CubeCatalogEntry[];
  views: ViewCatalogEntry[];
  tables: TableCatalogEntry[];
  errors: { path: string; error: string }[];
}

function asString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  return String(v);
}

// API: unified catalog (parsed metadata for all cubes/views/tables)
app.get("/api/catalog", async (_req, res) => {
  const files = await scanYamlFiles(HOT_RELOAD_DIR);
  const out: CatalogResponse = { cubes: [], views: [], tables: [], errors: [] };

  await Promise.all(
    files.map(async (f) => {
      const rel = toRelative(f);
      const fileName = path.basename(f);
      let content: string;
      try {
        content = await fs.readFile(f, "utf-8");
      } catch (e: any) {
        out.errors.push({ path: rel, error: e.message });
        return;
      }
      let doc: any;
      try {
        doc = YAML.parse(content);
      } catch (e: any) {
        out.errors.push({ path: rel, error: e.message });
        return;
      }
      if (!doc || typeof doc !== "object") return;

      if (Array.isArray(doc.cubes)) {
        doc.cubes.forEach((c: any, i: number) => {
          if (!c || typeof c !== "object") return;
          out.cubes.push({
            path: rel,
            fileName,
            index: i,
            name: asString(c.name),
            title: asString(c.title),
            description: asString(c.description),
            sql_table: asString(c.sql_table),
            extends: asString(c.extends),
          });
        });
      } else if (doc.cube && typeof doc.cube === "object") {
        const c = doc.cube;
        out.cubes.push({
          path: rel,
          fileName,
          index: 0,
          name: asString(c.name),
          title: asString(c.title),
          description: asString(c.description),
          sql_table: asString(c.sql_table),
          extends: asString(c.extends),
        });
      }

      if (Array.isArray(doc.views)) {
        doc.views.forEach((v: any, i: number) => {
          if (!v || typeof v !== "object") return;
          const cubeNames: string[] = Array.isArray(v.cubes)
            ? v.cubes
                .map((it: any) => asString(it && (it.join_path || it.name)))
                .filter(Boolean)
            : [];
          out.views.push({
            path: rel,
            fileName,
            index: i,
            name: asString(v.name),
            title: asString(v.title),
            description: asString(v.description),
            cubes: cubeNames,
          });
        });
      } else if (doc.view && typeof doc.view === "object") {
        const v = doc.view;
        const cubeNames: string[] = Array.isArray(v.cubes)
          ? v.cubes
              .map((it: any) => asString(it && (it.join_path || it.name)))
              .filter(Boolean)
          : [];
        out.views.push({
          path: rel,
          fileName,
          index: 0,
          name: asString(v.name),
          title: asString(v.title),
          description: asString(v.description),
          cubes: cubeNames,
        });
      }

      let tables: any[] = [];
      if (Array.isArray(doc.tables)) tables = doc.tables;
      else if (doc.table && typeof doc.table === "object") tables = [doc.table];
      tables.forEach((t: any) => {
        if (!t || typeof t !== "object") return;
        out.tables.push({
          path: rel,
          fileName,
          name: asString(t.name),
          title: asString(t.title),
          description: asString(t.description),
          lineage: asString(t.lineage),
          sql_table: asString(t.sql_table),
          schema: asString(t.schema),
          database: asString(t.database),
          fieldCount: Array.isArray(t.fields) ? t.fields.length : 0,
        });
      });
    })
  );

  const byName = <T extends { name: string; path: string }>(a: T, b: T) =>
    (a.name || a.path).localeCompare(b.name || b.path);
  out.cubes.sort(byName);
  out.views.sort(byName);
  out.tables.sort(byName);

  res.json(out);
});

// ---- StarRocks sync ----

interface StarRocksColumnInfo {
  name: string;
  comment: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
}

interface StarRocksTableInfo {
  name: string;
  comment: string;
  columns: StarRocksColumnInfo[];
}

async function fetchStarRocksTables(cfg: StarRocksConfig): Promise<StarRocksTableInfo[]> {
  if (!cfg.database) {
    throw new Error("未配置 STARROCKS_DATABASE 环境变量");
  }
  const conn = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    // StarRocks sometimes doesn't expose full MySQL SSL; keep simple.
    connectTimeout: 10_000,
  });
  try {
    const [tableRows] = await conn.query(
      "SELECT TABLE_NAME AS name, IFNULL(TABLE_COMMENT, '') AS comment " +
        "FROM information_schema.tables " +
        "WHERE TABLE_SCHEMA = ? " +
        "ORDER BY TABLE_NAME",
      [cfg.database]
    );
    const tables = tableRows as { name: string; comment: string }[];

    const [columnRows] = await conn.query(
      "SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, IFNULL(COLUMN_COMMENT, '') AS comment, " +
        "COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_KEY AS columnKey " +
        "FROM information_schema.columns " +
        "WHERE TABLE_SCHEMA = ? " +
        "ORDER BY TABLE_NAME, ORDINAL_POSITION",
      [cfg.database]
    );
    const cols = columnRows as {
      tableName: string;
      name: string;
      comment: string;
      type: string;
      nullable: string;
      columnKey: string;
    }[];

    const byTable = new Map<string, StarRocksColumnInfo[]>();
    for (const c of cols) {
      const list = byTable.get(c.tableName) || [];
      list.push({
        name: c.name,
        comment: c.comment || "",
        type: c.type || "",
        nullable: String(c.nullable).toUpperCase() !== "NO",
        primaryKey: String(c.columnKey).toUpperCase() === "PRI",
      });
      byTable.set(c.tableName, list);
    }

    return tables.map((t) => ({
      name: t.name,
      comment: t.comment || "",
      columns: byTable.get(t.name) || [],
    }));
  } finally {
    await conn.end();
  }
}

function toTableYamlDoc(info: StarRocksTableInfo): Record<string, unknown> {
  const fields = info.columns.map((c) => {
    const f: Record<string, unknown> = { name: c.name };
    if (c.comment) {
      f.title = c.comment;
      f.description = c.comment;
    }
    if (c.type) f.data_type = c.type;
    if (c.nullable === false) f.nullable = false;
    if (c.primaryKey) f.primary_key = true;
    return f;
  });
  const table: Record<string, unknown> = { name: info.name };
  if (info.comment) {
    table.title = info.comment;
    table.description = info.comment;
  }
  table.fields = fields;
  return { table };
}

async function listExistingTableNames(): Promise<Set<string>> {
  const files = await scanYamlFiles(HOT_RELOAD_DIR);
  const names = new Set<string>();
  await Promise.all(
    files.map(async (f) => {
      try {
        const content = await fs.readFile(f, "utf-8");
        const doc = YAML.parse(content);
        if (!doc || typeof doc !== "object") return;
        const tables: any[] = [];
        if (Array.isArray((doc as any).tables)) tables.push(...(doc as any).tables);
        else if ((doc as any).table && typeof (doc as any).table === "object") tables.push((doc as any).table);
        for (const t of tables) {
          if (t && typeof t.name === "string" && t.name) names.add(t.name);
        }
      } catch {
        // ignore parse errors for this purpose
      }
    })
  );
  return names;
}

// API: StarRocks connection info (masks password)
app.get("/api/starrocks/config", (_req, res) => {
  const cfg = getStarRocksConfig();
  res.json({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    database: cfg.database,
    hasPassword: Boolean(cfg.password),
  });
});

// API: StarRocks sync — create YAML files for tables that don't exist yet
app.post("/api/starrocks/sync", async (_req, res) => {
  const cfg = getStarRocksConfig();
  let tables: StarRocksTableInfo[];
  try {
    tables = await fetchStarRocksTables(cfg);
  } catch (e: any) {
    res.status(500).json({ error: `读取 StarRocks 元信息失败：${e.message}` });
    return;
  }

  let existing: Set<string>;
  try {
    existing = await listExistingTableNames();
  } catch (e: any) {
    res.status(500).json({ error: `读取本地 table 列表失败：${e.message}` });
    return;
  }

  const tablesDir = path.join(HOT_RELOAD_DIR, "tables");
  await fs.mkdir(tablesDir, { recursive: true });

  const added: { name: string; path: string; fields: number }[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const info of tables) {
    if (!info.name) {
      skipped.push({ name: "(空)", reason: "表名为空" });
      continue;
    }
    if (info.name.toLowerCase().includes("tmp")) {
      skipped.push({ name: info.name, reason: "表名包含 tmp，已跳过同步" });
      continue;
    }
    if (existing.has(info.name)) {
      skipped.push({ name: info.name, reason: "已存在同名 table" });
      continue;
    }

    const doc = toTableYamlDoc(info);
    const yamlText = YAML.stringify(doc, { indent: 2, lineWidth: 0 });
    const fileName = `${info.name}.yml`;
    const filePath = path.join(tablesDir, fileName);

    if (fsSync.existsSync(filePath)) {
      skipped.push({ name: info.name, reason: `目标文件已存在：tables/${fileName}` });
      continue;
    }

    try {
      await fs.writeFile(filePath, yamlText, "utf-8");
      added.push({
        name: info.name,
        path: `tables/${fileName}`,
        fields: info.columns.length,
      });
    } catch (e: any) {
      skipped.push({ name: info.name, reason: `写入失败：${e.message}` });
    }
  }

  res.json({
    added,
    skipped,
    total: tables.length,
    database: cfg.database,
  });
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
