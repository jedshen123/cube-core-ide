const API_BASE = '/api';

export interface FileInfo {
  path: string;
  name: string;
  type: 'cube' | 'view' | 'table' | 'unknown';
}

export interface CubeCatalogEntry {
  path: string;
  fileName: string;
  index: number;
  name: string;
  title: string;
  description: string;
  sql_table: string;
  extends: string;
}

export interface ViewCatalogEntry {
  path: string;
  fileName: string;
  index: number;
  name: string;
  title: string;
  description: string;
  cubes: string[];
}

export interface TableCatalogEntry {
  path: string;
  fileName: string;
  name: string;
  title: string;
  description: string;
  /** 数据血缘说明（多行） */
  lineage: string;
  sql_table: string;
  schema: string;
  database: string;
  fieldCount: number;
}

export interface MeasureCatalogEntry {
  path: string;
  cubeIndex: number;
  cubeName: string;
  name: string;
  title: string;
  type: string;
}

export interface CatalogResponse {
  cubes: CubeCatalogEntry[];
  views: ViewCatalogEntry[];
  tables: TableCatalogEntry[];
  measures: MeasureCatalogEntry[];
  errors: { path: string; error: string }[];
}

export async function listFiles(): Promise<FileInfo[]> {
  const res = await fetch(`${API_BASE}/files`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listCatalog(): Promise<CatalogResponse> {
  const res = await fetch(`${API_BASE}/catalog`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function readFile(path: string): Promise<{ content: string; path: string }> {
  const res = await fetch(`${API_BASE}/files/${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function writeFile(path: string, content: string): Promise<void> {
  const res = await fetch(`${API_BASE}/files/${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Save failed');
  }
}

export async function deleteFile(path: string): Promise<void> {
  const res = await fetch(`${API_BASE}/files/${encodeURIComponent(path)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(await res.text());
}

export interface StarRocksConfigInfo {
  host: string;
  port: number;
  user: string;
  database: string;
  hasPassword: boolean;
}

export interface StarRocksSyncResult {
  added: { name: string; path: string; fields: number }[];
  skipped: { name: string; reason: string }[];
  total: number;
  database: string;
}

export async function getStarRocksConfig(): Promise<StarRocksConfigInfo> {
  const res = await fetch(`${API_BASE}/starrocks/config`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function syncStarRocksTables(): Promise<StarRocksSyncResult> {
  const res = await fetch(`${API_BASE}/starrocks/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    let msg = '同步失败';
    try {
      const data = await res.json();
      msg = data.error || msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return res.json();
}
