import YAML from 'yaml';

export const YAML_PRINT_OPTIONS = { indent: 2, lineWidth: 0 } as const;

export function stringifyDoc(doc: unknown): string {
  return YAML.stringify(doc, YAML_PRINT_OPTIONS);
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
