import YAML, { Scalar, isScalar } from 'yaml';

export const YAML_PRINT_OPTIONS = { indent: 2, lineWidth: 0 } as const;

/**
 * 递归把含换行的字符串转换为 YAML 的块文本（`|`），
 * 以便生成的 YAML 与 CubeCore 示例一致、更易读。
 */
function toBlockLiterals(v: unknown): unknown {
  if (typeof v === 'string') {
    if (v.includes('\n')) {
      const s = new Scalar(v);
      s.type = Scalar.BLOCK_LITERAL;
      return s;
    }
    return v;
  }
  if (Array.isArray(v)) return v.map(toBlockLiterals);
  if (v && typeof v === 'object' && !isScalar(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = toBlockLiterals(val);
    }
    return out;
  }
  return v;
}

export function stringifyDoc(doc: unknown): string {
  return YAML.stringify(toBlockLiterals(doc), YAML_PRINT_OPTIONS);
}

/**
 * Read AI 说明文案：优先 `meta.ai_context`（CubeCore 标准，多行字符串），
 * 兼容旧的顶层 `ai_context`（数组或字符串）。
 */
export function metaAiContextToFormString(record: Record<string, unknown>): string {
  const meta = record.meta;
  if (meta && typeof meta === 'object') {
    const ac = (meta as Record<string, unknown>).ai_context;
    if (typeof ac === 'string') return ac;
    if (ac != null) return String(ac);
  }
  const top = record.ai_context;
  if (typeof top === 'string') return top;
  if (Array.isArray(top)) {
    try {
      return YAML.stringify(top).trim();
    } catch {
      return '';
    }
  }
  return '';
}

/** 写入 `meta.ai_context` 并移除顶层 `ai_context`（可视化保存时迁移到新结构） */
export function applyMetaAiContextString(
  old: Record<string, unknown>,
  text: string
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...old };
  const oldMeta =
    next.meta && typeof next.meta === 'object'
      ? { ...(next.meta as Record<string, unknown>) }
      : ({} as Record<string, unknown>);
  const trimmed = text.trim();
  if (trimmed) {
    oldMeta.ai_context = text;
    next.meta = oldMeta;
  } else {
    delete oldMeta.ai_context;
    if (Object.keys(oldMeta).length) next.meta = oldMeta;
    else delete next.meta;
  }
  delete next.ai_context;
  return next;
}

// ——— Cube file ———

export function parseCubeFile(content: string):
  | { ok: true; doc: Record<string, unknown>; cubes: Record<string, unknown>[] }
  | { ok: false; error: string } {
  try {
    const doc = YAML.parse(content) as Record<string, unknown> | null;
    if (!doc || typeof doc !== 'object') return { ok: false, error: '根节点不是对象' };
    const cubes = doc.cubes;
    if (!Array.isArray(cubes)) return { ok: false, error: '缺少 cubes 数组' };
    return { ok: true, doc, cubes: cubes as Record<string, unknown>[] };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function parseViewFile(content: string):
  | { ok: true; doc: Record<string, unknown>; views: Record<string, unknown>[] }
  | { ok: false; error: string } {
  try {
    const doc = YAML.parse(content) as Record<string, unknown> | null;
    if (!doc || typeof doc !== 'object') return { ok: false, error: '根节点不是对象' };
    const views = doc.views;
    if (!Array.isArray(views)) return { ok: false, error: '缺少 views 数组' };
    return { ok: true, doc, views: views as Record<string, unknown>[] };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function setCubeAt(doc: Record<string, unknown>, index: number, cube: Record<string, unknown>): void {
  const cubes = [...((doc.cubes as Record<string, unknown>[]) || [])];
  cubes[index] = cube;
  doc.cubes = cubes;
}

export function setViewAt(doc: Record<string, unknown>, index: number, view: Record<string, unknown>): void {
  const views = [...((doc.views as Record<string, unknown>[]) || [])];
  views[index] = view;
  doc.views = views;
}

// ——— Table file ———
// Canonical shape: `{ table: { name, title, description, ..., fields: [...] } }`
// (one table per file). Import tolerates `{ tables: [ ... ] }` (array).

export function parseTableFile(content: string):
  | { ok: true; doc: Record<string, unknown>; table: Record<string, unknown> }
  | { ok: false; error: string } {
  try {
    const doc = YAML.parse(content) as Record<string, unknown> | null;
    if (!doc || typeof doc !== 'object') return { ok: false, error: '根节点不是对象' };
    if (doc.table && typeof doc.table === 'object' && !Array.isArray(doc.table)) {
      return { ok: true, doc, table: doc.table as Record<string, unknown> };
    }
    if (Array.isArray(doc.tables) && doc.tables[0] && typeof doc.tables[0] === 'object') {
      return { ok: true, doc, table: doc.tables[0] as Record<string, unknown> };
    }
    return { ok: false, error: '缺少 table/tables 字段' };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function setTable(doc: Record<string, unknown>, table: Record<string, unknown>): void {
  if (Array.isArray(doc.tables)) {
    const tables = [...(doc.tables as Record<string, unknown>[])];
    tables[0] = table;
    doc.tables = tables;
  } else {
    doc.table = table;
  }
}

// ——— Import / Export helpers ———

/** 从任意 YAML 文本中提取 cube 条目（支持 `cubes:` 数组或单个 cube 对象）。 */
export function extractCubesFromText(text: string):
  | { ok: true; cubes: Record<string, unknown>[] }
  | { ok: false; error: string } {
  try {
    const doc = YAML.parse(text);
    if (!doc || typeof doc !== 'object') return { ok: false, error: 'YAML 根节点不是对象' };
    const d = doc as Record<string, unknown>;
    if (Array.isArray(d.cubes)) {
      return { ok: true, cubes: (d.cubes as unknown[]).filter((x) => x && typeof x === 'object') as Record<string, unknown>[] };
    }
    if (d.cube && typeof d.cube === 'object') {
      return { ok: true, cubes: [d.cube as Record<string, unknown>] };
    }
    if (typeof d.name === 'string') {
      return { ok: true, cubes: [d] };
    }
    return { ok: false, error: '未找到 cubes/cube 字段' };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 从任意 YAML 文本中提取 table 条目（支持 `table:` 对象 / `tables:` 数组）。 */
export function extractTablesFromText(text: string):
  | { ok: true; tables: Record<string, unknown>[] }
  | { ok: false; error: string } {
  try {
    const doc = YAML.parse(text);
    if (!doc || typeof doc !== 'object') return { ok: false, error: 'YAML 根节点不是对象' };
    const d = doc as Record<string, unknown>;
    if (Array.isArray(d.tables)) {
      return {
        ok: true,
        tables: (d.tables as unknown[]).filter((x) => x && typeof x === 'object') as Record<string, unknown>[],
      };
    }
    if (d.table && typeof d.table === 'object') {
      return { ok: true, tables: [d.table as Record<string, unknown>] };
    }
    // bare root with name+fields
    if (typeof d.name === 'string' && Array.isArray(d.fields)) {
      return { ok: true, tables: [d] };
    }
    return { ok: false, error: '未找到 table/tables 字段' };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 从任意 YAML 文本中提取 view 条目（支持 `views:` 数组或单个 view 对象）。 */
export function extractViewsFromText(text: string):
  | { ok: true; views: Record<string, unknown>[] }
  | { ok: false; error: string } {
  try {
    const doc = YAML.parse(text);
    if (!doc || typeof doc !== 'object') return { ok: false, error: 'YAML 根节点不是对象' };
    const d = doc as Record<string, unknown>;
    if (Array.isArray(d.views)) {
      return { ok: true, views: (d.views as unknown[]).filter((x) => x && typeof x === 'object') as Record<string, unknown>[] };
    }
    if (d.view && typeof d.view === 'object') {
      return { ok: true, views: [d.view as Record<string, unknown>] };
    }
    if (typeof d.name === 'string' && Array.isArray(d.cubes)) {
      return { ok: true, views: [d] };
    }
    return { ok: false, error: '未找到 views/view 字段' };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type ImportSplitWrite = {
  path: string;
  yaml: string;
  kind: 'cube' | 'view' | 'table';
};

function importItemName(rec: Record<string, unknown>, i: number, kind: 'cube' | 'view' | 'table'): string {
  const raw = rec.name;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return `${kind}_${i + 1}`;
}

/**
 * 从单份 YAML 中解析 cubes / views / table(s)，按每条记录的 `name` 拆成多文件
 *（cubes/、views/、tables/ 下各一个 .yml）。同一次导入内重名会自动加 _2、_3。
 * 同一条目若被多种解析同时命中（如根节点同时符合 table 与宽松 cube），优先保留为 table，再 view，再 cube。
 */
export function buildImportSplitWrites(text: string): ImportSplitWrite[] | { error: string } {
  const cubesR = extractCubesFromText(text);
  const viewsR = extractViewsFromText(text);
  const tablesR = extractTablesFromText(text);

  const claimed = new WeakSet<Record<string, unknown>>();
  const usedPaths = new Set<string>();
  const writes: ImportSplitWrite[] = [];

  const allocPath = (dir: 'cubes' | 'views' | 'tables', baseName: string, fallback: string) => {
    let stem = sanitizeFilename(baseName, fallback);
    let rel = `${dir}/${stem}.yml`;
    if (!usedPaths.has(rel)) {
      usedPaths.add(rel);
      return rel;
    }
    let n = 2;
    while (usedPaths.has(`${dir}/${stem}_${n}.yml`)) n += 1;
    rel = `${dir}/${stem}_${n}.yml`;
    usedPaths.add(rel);
    return rel;
  };

  const tables = tablesR.ok ? tablesR.tables : [];
  const views = viewsR.ok ? viewsR.views : [];
  const cubes = cubesR.ok ? cubesR.cubes : [];

  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    claimed.add(table);
    const path = allocPath('tables', importItemName(table, i, 'table'), 'table');
    writes.push({ kind: 'table', path, yaml: stringifyDoc({ table }) });
  }

  for (let i = 0; i < views.length; i++) {
    const view = views[i];
    if (claimed.has(view)) continue;
    claimed.add(view);
    const path = allocPath('views', importItemName(view, i, 'view'), 'view');
    writes.push({ kind: 'view', path, yaml: stringifyDoc({ views: [view] }) });
  }

  for (let i = 0; i < cubes.length; i++) {
    const cube = cubes[i];
    if (claimed.has(cube)) continue;
    claimed.add(cube);
    const path = allocPath('cubes', importItemName(cube, i, 'cube'), 'cube');
    writes.push({ kind: 'cube', path, yaml: stringifyDoc({ cubes: [cube] }) });
  }

  if (writes.length > 0) return writes;

  const parts: string[] = [];
  if (!cubesR.ok) parts.push(`cube: ${cubesR.error}`);
  if (!viewsR.ok) parts.push(`view: ${viewsR.error}`);
  if (!tablesR.ok) parts.push(`table: ${tablesR.error}`);
  return {
    error:
      parts.length > 0
        ? `未能解析出可导入内容（${parts.join('；')}）`
        : '未在文件中发现 cubes、views 或 table(s) 定义',
  };
}

/** 按目录列表顺序去重 path（保留首次出现顺序）。 */
export function uniquePathsInOrder(entries: { path: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of entries) {
    if (!seen.has(e.path)) {
      seen.add(e.path);
      out.push(e.path);
    }
  }
  return out;
}

/** 从已解析的根对象中取出 cube 条目（`cubes` 数组或单个 `cube`）。 */
export function collectCubeRecordsFromYamlRoot(doc: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(doc.cubes)) {
    return (doc.cubes as unknown[])
      .filter((x) => x && typeof x === 'object')
      .map((x) => x as Record<string, unknown>);
  }
  if (doc.cube && typeof doc.cube === 'object' && !Array.isArray(doc.cube)) {
    return [doc.cube as Record<string, unknown>];
  }
  return [];
}

/** 从已解析的根对象中取出 view 条目（`views` 数组或单个 `view`）。 */
export function collectViewRecordsFromYamlRoot(doc: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(doc.views)) {
    return (doc.views as unknown[])
      .filter((x) => x && typeof x === 'object')
      .map((x) => x as Record<string, unknown>);
  }
  if (doc.view && typeof doc.view === 'object' && !Array.isArray(doc.view)) {
    return [doc.view as Record<string, unknown>];
  }
  return [];
}

/** 从已解析的根对象中取出 table 条目（`tables` 数组或单个 `table`）。 */
export function collectTableRecordsFromYamlRoot(doc: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (Array.isArray(doc.tables)) {
    for (const t of doc.tables) {
      if (t && typeof t === 'object') out.push(t as Record<string, unknown>);
    }
  } else if (doc.table && typeof doc.table === 'object' && !Array.isArray(doc.table)) {
    out.push(doc.table as Record<string, unknown>);
  }
  return out;
}

/** 合并为一份可被 buildImportSplitWrites 再拆分的根文档。 */
export function stringifyExportBundle(parts: {
  cubes: Record<string, unknown>[];
  views: Record<string, unknown>[];
  tables: Record<string, unknown>[];
}): string {
  const root: Record<string, unknown> = {};
  if (parts.cubes.length) root.cubes = parts.cubes;
  if (parts.views.length) root.views = parts.views;
  if (parts.tables.length) root.tables = parts.tables;
  return stringifyDoc(root);
}

/** 触发浏览器下载一段文本到本地。 */
export function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/yaml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** 让用户选择本地 YAML 文件，返回文本内容。 */
export function pickYamlFile(): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.yml,.yaml,text/yaml';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onload = () => {
        const text = typeof reader.result === 'string' ? reader.result : '';
        resolve({ name: file.name, text });
      };
      reader.readAsText(file);
    };
    input.click();
  });
}

export function sanitizeFilename(name: string, fallback: string): string {
  const base = name.trim().replace(/[^A-Za-z0-9_\-.]+/g, '_').replace(/^_+|_+$/g, '');
  return base || fallback;
}
