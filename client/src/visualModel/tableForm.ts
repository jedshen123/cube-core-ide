import {
  applyMetaAiContextString,
  metaAiContextToFormString,
  parseTableFile,
  setTable,
  stringifyDoc,
} from '../modelYaml';

export type FieldFormRow = {
  name: string;
  title: string;
  description: string;
  data_type: string;
  /** 枚举可选值，写入 YAML `enum_values`（多行或逗号分隔） */
  enum_values: string;
  nullable: boolean;
  primary_key: boolean;
  /** 写入 YAML 的 `meta.ai_context`（多行字符串） */
  metaAiContext: string;
};

export type TableFormState = {
  name: string;
  title: string;
  description: string;
  schema: string;
  database: string;
  sql_table: string;
  /** 表级 `meta.ai_context` */
  tableMetaAiContext: string;
  fields: FieldFormRow[];
};

export const emptyFieldRow = (): FieldFormRow => ({
  name: '',
  title: '',
  description: '',
  data_type: '',
  enum_values: '',
  nullable: true,
  primary_key: false,
  metaAiContext: '',
});

export const emptyTableForm = (): TableFormState => ({
  name: '',
  title: '',
  description: '',
  schema: '',
  database: '',
  sql_table: '',
  tableMetaAiContext: '',
  fields: [],
});

function str(v: unknown): string {
  return typeof v === 'string' ? v : v != null ? String(v) : '';
}

function bool(v: unknown, defaultValue = false): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return defaultValue;
}

function fieldToFormRow(f: Record<string, unknown>): FieldFormRow {
  return {
    name: str(f.name),
    title: str(f.title),
    description: str(f.description),
    data_type: str(f.data_type ?? f.type),
    enum_values: str(f.enum_values ?? f.enum),
    nullable: bool(f.nullable, true),
    primary_key: bool(f.primary_key, false),
    metaAiContext: metaAiContextToFormString(f),
  };
}

export function tableToFormState(table: Record<string, unknown>): TableFormState {
  return {
    name: str(table.name),
    title: str(table.title),
    description: str(table.description),
    schema: str(table.schema),
    database: str(table.database),
    sql_table: str(table.sql_table),
    tableMetaAiContext: metaAiContextToFormString(table),
    fields: Array.isArray(table.fields)
      ? (table.fields as Record<string, unknown>[]).map(fieldToFormRow)
      : [],
  };
}

function optString(s: string): string | undefined {
  const t = s.trim();
  return t ? t : undefined;
}

function mergeField(old: Record<string, unknown> | undefined, row: FieldFormRow): Record<string, unknown> {
  let next: Record<string, unknown> = { ...(old || {}) };
  next.name = row.name.trim();
  const title = optString(row.title);
  const description = optString(row.description);
  const data_type = optString(row.data_type);
  const enum_values = optString(row.enum_values);
  if (title) next.title = title;
  else delete next.title;
  if (description) next.description = description;
  else delete next.description;
  if (data_type) next.data_type = data_type;
  else delete next.data_type;
  if (enum_values) next.enum_values = enum_values;
  else {
    delete next.enum_values;
    delete next.enum;
  }
  // `nullable` 默认视为 true，非默认值才写入
  if (row.nullable === false) next.nullable = false;
  else delete next.nullable;
  if (row.primary_key) next.primary_key = true;
  else delete next.primary_key;
  next = applyMetaAiContextString(next, row.metaAiContext);
  return next;
}

export function formStateToTable(
  oldTable: Record<string, unknown> | undefined,
  form: TableFormState
): Record<string, unknown> {
  let next: Record<string, unknown> = { ...(oldTable || {}) };
  next.name = form.name.trim();
  const title = optString(form.title);
  const description = optString(form.description);
  const schema = optString(form.schema);
  const database = optString(form.database);
  const sql_table = optString(form.sql_table);
  if (title) next.title = title;
  else delete next.title;
  if (description) next.description = description;
  else delete next.description;
  if (schema) next.schema = schema;
  else delete next.schema;
  if (database) next.database = database;
  else delete next.database;
  if (sql_table) next.sql_table = sql_table;
  else delete next.sql_table;

  const oldFields = (oldTable?.fields as Record<string, unknown>[] | undefined) || [];
  next.fields = form.fields.map((row, i) => mergeField(oldFields[i], row));

  next = applyMetaAiContextString(next, form.tableMetaAiContext);
  return next;
}

export function applyTableFormToContent(
  content: string,
  form: TableFormState
): { ok: true; yaml: string } | { ok: false; error: string } {
  const parsed = parseTableFile(content);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const merged = formStateToTable(parsed.table, form);
  const doc = { ...parsed.doc };
  setTable(doc, merged);
  return { ok: true, yaml: stringifyDoc(doc) };
}
