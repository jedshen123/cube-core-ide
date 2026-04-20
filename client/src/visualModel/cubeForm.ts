import {
  applyMetaAiContextString,
  metaAiContextToFormString,
  parseCubeFile,
  setCubeAt,
  stringifyDoc,
} from '../modelYaml';

export type MeasureFilterForm = {
  sql: string;
};

export type MeasureFormRow = {
  name: string;
  title: string;
  description: string;
  type: string;
  sql: string;
  /** 对应 YAML：`filters`，数组项 `{ sql: string }` */
  filters: MeasureFilterForm[];
  /** 对应 YAML：`meta.ai_context`（多行字符串，CubeCore 标准） */
  metaAiContext: string;
};

export type DimensionFormRow = {
  name: string;
  title: string;
  description: string;
  type: string;
  sql: string;
  primary_key: boolean;
  metaAiContext: string;
};

export type JoinFormRow = {
  name: string;
  relationship: string;
  sql: string;
};

export type CubeFormState = {
  name: string;
  title: string;
  description: string;
  sql_table: string;
  sql: string;
  /** Cube 级 `meta.ai_context` */
  cubeMetaAiContext: string;
  measures: MeasureFormRow[];
  dimensions: DimensionFormRow[];
  joins: JoinFormRow[];
};

export const emptyCubeForm = (): CubeFormState => ({
  name: '',
  title: '',
  description: '',
  sql_table: '',
  sql: '',
  cubeMetaAiContext: '',
  measures: [],
  dimensions: [],
  joins: [],
});

function str(v: unknown): string {
  return typeof v === 'string' ? v : v != null ? String(v) : '';
}

function bool(v: unknown): boolean {
  return v === true || v === 'true';
}

export function cubeToFormState(cube: Record<string, unknown>): CubeFormState {
  return {
    name: str(cube.name),
    title: str(cube.title),
    description: str(cube.description),
    sql_table: str(cube.sql_table),
    sql: str(cube.sql),
    cubeMetaAiContext: metaAiContextToFormString(cube),
    measures: Array.isArray(cube.measures)
      ? (cube.measures as Record<string, unknown>[]).map(measureToFormRow)
      : [],
    dimensions: Array.isArray(cube.dimensions)
      ? (cube.dimensions as Record<string, unknown>[]).map(dimensionToFormRow)
      : [],
    joins: Array.isArray(cube.joins)
      ? (cube.joins as Record<string, unknown>[]).map(joinToFormRow)
      : [],
  };
}

function measureToFormRow(m: Record<string, unknown>): MeasureFormRow {
  const rawFilters = Array.isArray(m.filters) ? (m.filters as unknown[]) : [];
  const filters: MeasureFilterForm[] = rawFilters.map((f) => {
    if (f && typeof f === 'object' && 'sql' in (f as Record<string, unknown>)) {
      return { sql: str((f as Record<string, unknown>).sql) };
    }
    if (typeof f === 'string') return { sql: f };
    return { sql: '' };
  });
  return {
    name: str(m.name),
    title: str(m.title),
    description: str(m.description),
    type: str(m.type),
    sql: str(m.sql),
    filters,
    metaAiContext: metaAiContextToFormString(m),
  };
}

function dimensionToFormRow(d: Record<string, unknown>): DimensionFormRow {
  return {
    name: str(d.name),
    title: str(d.title),
    description: str(d.description),
    type: str(d.type),
    sql: str(d.sql),
    primary_key: bool(d.primary_key),
    metaAiContext: metaAiContextToFormString(d),
  };
}

function joinToFormRow(j: Record<string, unknown>): JoinFormRow {
  return {
    name: str(j.name),
    relationship: str(j.relationship),
    sql: str(j.sql),
  };
}

function optString(s: string): string | undefined {
  const t = s.trim();
  return t ? t : undefined;
}

function mergeMeasure(old: Record<string, unknown> | undefined, row: MeasureFormRow): Record<string, unknown> {
  let next: Record<string, unknown> = { ...(old || {}) };
  next.name = row.name.trim();
  const title = optString(row.title);
  const description = optString(row.description);
  const type = optString(row.type);
  const sql = optString(row.sql);
  if (title) next.title = title;
  else delete next.title;
  if (description) next.description = description;
  else delete next.description;
  if (type) next.type = type;
  else delete next.type;
  if (sql) next.sql = sql;
  else delete next.sql;

  const oldFilters = Array.isArray(old?.filters) ? (old!.filters as unknown[]) : [];
  const filters: Record<string, unknown>[] = [];
  row.filters.forEach((f, i) => {
    const sqlText = f.sql.trim();
    if (!sqlText) return;
    const prev = oldFilters[i];
    const base: Record<string, unknown> =
      prev && typeof prev === 'object' && !Array.isArray(prev) ? { ...(prev as Record<string, unknown>) } : {};
    base.sql = f.sql;
    filters.push(base);
  });
  if (filters.length > 0) next.filters = filters;
  else delete next.filters;

  next = applyMetaAiContextString(next, row.metaAiContext);
  return next;
}

function mergeDimension(old: Record<string, unknown> | undefined, row: DimensionFormRow): Record<string, unknown> {
  let next: Record<string, unknown> = { ...(old || {}) };
  next.name = row.name.trim();
  const title = optString(row.title);
  const description = optString(row.description);
  const type = optString(row.type);
  const sql = optString(row.sql);
  if (title) next.title = title;
  else delete next.title;
  if (description) next.description = description;
  else delete next.description;
  if (type) next.type = type;
  else delete next.type;
  if (sql) next.sql = sql;
  else delete next.sql;
  if (row.primary_key) next.primary_key = true;
  else delete next.primary_key;
  next = applyMetaAiContextString(next, row.metaAiContext);
  return next;
}

function mergeJoin(old: Record<string, unknown> | undefined, row: JoinFormRow): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(old || {}) };
  next.name = row.name.trim();
  const rel = optString(row.relationship);
  const sql = row.sql;
  if (rel) next.relationship = rel;
  else delete next.relationship;
  if (sql.trim()) next.sql = sql;
  else delete next.sql;
  return next;
}

export function formStateToCube(oldCube: Record<string, unknown> | undefined, form: CubeFormState): Record<string, unknown> {
  let next: Record<string, unknown> = { ...(oldCube || {}) };
  next.name = form.name.trim();
  const title = optString(form.title);
  const description = optString(form.description);
  const sql_table = optString(form.sql_table);
  const sql = optString(form.sql);
  if (title) next.title = title;
  else delete next.title;
  if (description) next.description = description;
  else delete next.description;
  if (sql_table) next.sql_table = sql_table;
  else delete next.sql_table;
  if (sql) next.sql = sql;
  else delete next.sql;

  const oldMeasures = (oldCube?.measures as Record<string, unknown>[] | undefined) || [];
  next.measures = form.measures.map((row, i) => mergeMeasure(oldMeasures[i], row));

  const oldDims = (oldCube?.dimensions as Record<string, unknown>[] | undefined) || [];
  next.dimensions = form.dimensions.map((row, i) => mergeDimension(oldDims[i], row));

  const oldJoins = (oldCube?.joins as Record<string, unknown>[] | undefined) || [];
  next.joins = form.joins.map((row, i) => mergeJoin(oldJoins[i], row));

  next = applyMetaAiContextString(next, form.cubeMetaAiContext);
  return next;
}

export function applyCubeFormToContent(
  content: string,
  cubeIndex: number,
  form: CubeFormState
): { ok: true; yaml: string } | { ok: false; error: string } {
  const parsed = parseCubeFile(content);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (cubeIndex < 0 || cubeIndex >= parsed.cubes.length) {
    return { ok: false, error: 'Cube 索引无效' };
  }
  const oldCube = parsed.cubes[cubeIndex];
  const merged = formStateToCube(oldCube, form);
  const doc = { ...parsed.doc };
  setCubeAt(doc, cubeIndex, merged);
  return { ok: true, yaml: stringifyDoc(doc) };
}
