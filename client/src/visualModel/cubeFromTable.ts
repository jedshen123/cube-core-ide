import type { CubeCatalogEntry } from '../api';
import { parseTableFile, stringifyDoc } from '../modelYaml';
import { tableToFormState } from './tableForm';

function inferCubeDimensionType(dataType: string): string {
  const t = dataType.trim().toLowerCase();
  if (!t) return 'string';
  if (t.includes('time') || t.includes('date') || t === 'timestamp') return 'time';
  if (
    t.includes('int') ||
    t.includes('decimal') ||
    t.includes('float') ||
    t.includes('double') ||
    t.includes('number') ||
    t.includes('bigint')
  ) {
    return 'number';
  }
  if (t.includes('bool')) return 'boolean';
  return 'string';
}

/**
 * 根据当前 Table YAML 生成一份单 Cube 的初始 YAML（用于「从表创建 Cube」预填）。
 * name / sql_table 使用表英文名；title 为表中文名；dimensions 来自字段列表。
 */
export function buildCubeYamlFromTableContent(tableContent: string):
  | { ok: true; yaml: string; tableEnName: string }
  | { ok: false; error: string } {
  const parsed = parseTableFile(tableContent);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const form = tableToFormState(parsed.table);
  const enName = form.name.trim();
  if (!enName) return { ok: false, error: '表英文名为空，无法生成 Cube' };

  const tableDesc = form.description.trim();

  const dimensions = form.fields
    .filter((f) => f.name.trim())
    .map((f) => {
      const col = f.name.trim();
      const dim: Record<string, unknown> = {
        name: col,
        type: inferCubeDimensionType(f.data_type),
        sql: col,
      };
      const title = f.title.trim();
      if (title) dim.title = title;
      const desc = f.description.trim();
      if (desc) dim.description = desc;
      if (f.primary_key) dim.primary_key = true;
      return dim;
    });

  const numberFields = form.fields.filter(
    (f) => f.name.trim() && inferCubeDimensionType(f.data_type) === 'number'
  );
  const measures = numberFields.map((f) => {
    const col = f.name.trim();
    const measure: Record<string, unknown> = {
      name: col,
      type: 'sum',
      sql: `{CUBE}.${col}`,
    };
    const title = f.title.trim();
    if (title) measure.title = title;
    const fieldDesc = f.description.trim();
    if (fieldDesc) {
      measure.description = fieldDesc;
      measure.meta = { ai_context: fieldDesc };
    }
    return measure;
  });

  const cube: Record<string, unknown> = {
    name: enName,
    title: form.title.trim() || enName,
    sql_table: enName,
  };
  if (tableDesc) cube.description = tableDesc;
  cube.dimensions = dimensions;
  if (measures.length > 0) cube.measures = measures;

  return { ok: true, yaml: stringifyDoc({ cubes: [cube] }), tableEnName: enName };
}

/** 表英文名是否与已有 Cube 的 sql_table 或 name 一致（用于从 Table 创建 Cube 前去重） */
export function findCubeMatchingTableEnglishName(
  tableEnName: string,
  cubes: CubeCatalogEntry[]
): CubeCatalogEntry | undefined {
  const t = tableEnName.trim();
  if (!t) return undefined;
  return cubes.find((c) => {
    const st = (c.sql_table || '').trim();
    const nm = (c.name || '').trim();
    return st === t || nm === t;
  });
}
