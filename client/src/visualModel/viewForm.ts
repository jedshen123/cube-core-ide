import {
  applyMetaAiContextString,
  metaAiContextToFormString,
  parseViewFile,
  setViewAt,
  stringifyDoc,
} from '../modelYaml';

export type ViewCubeRefForm = {
  join_path: string;
  includesText: string;
  /** 对应 YAML：`prefix: true`（多 join 路径时区分列名前缀） */
  prefix: boolean;
};

export type ViewFormState = {
  name: string;
  title: string;
  description: string;
  /** View 级 `meta.ai_context` */
  viewMetaAiContext: string;
  cubes: ViewCubeRefForm[];
};

export const emptyViewForm = (): ViewFormState => ({
  name: '',
  title: '',
  description: '',
  viewMetaAiContext: '',
  cubes: [],
});

function str(v: unknown): string {
  return typeof v === 'string' ? v : v != null ? String(v) : '';
}

function bool(v: unknown): boolean {
  return v === true || v === 'true';
}

function includesToText(raw: unknown): string {
  if (!Array.isArray(raw)) return '';
  return raw.map((x) => String(x).trim()).filter(Boolean).join(', ');
}

export function viewToFormState(view: Record<string, unknown>): ViewFormState {
  const cubesRaw = Array.isArray(view.cubes) ? (view.cubes as Record<string, unknown>[]) : [];
  return {
    name: str(view.name),
    title: str(view.title),
    description: str(view.description),
    viewMetaAiContext: metaAiContextToFormString(view),
    cubes: cubesRaw.map((c) => ({
      join_path: str(c.join_path),
      includesText: includesToText(c.includes),
      prefix: bool(c.prefix),
    })),
  };
}

function optString(s: string): string | undefined {
  const t = s.trim();
  return t ? t : undefined;
}

export function formStateToView(oldView: Record<string, unknown> | undefined, form: ViewFormState): Record<string, unknown> {
  let next: Record<string, unknown> = { ...(oldView || {}) };
  next.name = form.name.trim();
  const title = optString(form.title);
  const description = optString(form.description);
  if (title) next.title = title;
  else delete next.title;
  if (description) next.description = description;
  else delete next.description;

  const oldCubes = (oldView?.cubes as Record<string, unknown>[] | undefined) || [];
  next.cubes = form.cubes.map((row, i) => {
    const base: Record<string, unknown> = { ...(oldCubes[i] || {}) };
    const jp = optString(row.join_path);
    if (jp) base.join_path = jp;
    else delete base.join_path;
    const parts = row.includesText
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length) base.includes = parts;
    else delete base.includes;
    if (row.prefix) base.prefix = true;
    else delete base.prefix;
    return base;
  });

  next = applyMetaAiContextString(next, form.viewMetaAiContext);
  return next;
}

export function applyViewFormToContent(
  content: string,
  viewIndex: number,
  form: ViewFormState
): { ok: true; yaml: string } | { ok: false; error: string } {
  const parsed = parseViewFile(content);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (viewIndex < 0 || viewIndex >= parsed.views.length) {
    return { ok: false, error: 'View 索引无效' };
  }
  const oldView = parsed.views[viewIndex];
  const merged = formStateToView(oldView, form);
  const doc = { ...parsed.doc };
  setViewAt(doc, viewIndex, merged);
  return { ok: true, yaml: stringifyDoc(doc) };
}
