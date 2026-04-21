import { useEffect, useRef, useState, type LegacyRef, type ReactNode } from 'react';
import { useResizableGridWeights } from '../hooks/useResizableGridWeights';
import { parseTableFile } from '../modelYaml';
import {
  applyTableFormToContent,
  emptyFieldRow,
  emptyTableForm,
  tableToFormState,
  type TableFormState,
} from '../visualModel/tableForm';
import { ExpandableTextarea } from './ExpandableTextarea';

/** 与 Sql 字段一致：纵向 resize、聚焦展开高度（ExpandableTextarea + visual-input--sql） */
const SQL_TEXTAREA = 'visual-input visual-input--mono visual-input--sql';
const SQL_TEXTAREA_SUMMARY = `${SQL_TEXTAREA} visual-input--compact`;

type Props = {
  content: string;
  onChange: (yaml: string) => void;
  activePath: string | null;
};

export function VisualTableEditor({ content, onChange, activePath }: Props) {
  const [form, setForm] = useState<TableFormState>(emptyTableForm);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fieldExpanded, setFieldExpanded] = useState<boolean[]>([]);
  const skipSync = useRef(false);
  const contentRef = useRef(content);
  contentRef.current = content;

  const tableFieldsGrid = useResizableGridWeights('cube-core-ide.visual.table.fields', [
    1, 1, 0.85, 1.1, 1,
  ]);

  const ensureSize = (arr: boolean[], size: number): boolean[] => {
    if (arr.length === size) return arr;
    if (arr.length < size) return [...arr, ...Array(size - arr.length).fill(false)];
    return arr.slice(0, size);
  };

  useEffect(() => {
    if (skipSync.current) {
      skipSync.current = false;
      return;
    }
    const p = parseTableFile(content);
    if (!p.ok) {
      setParseError(p.error);
      setForm(emptyTableForm());
      return;
    }
    setParseError(null);
    const nextForm = tableToFormState(p.table);
    setForm(nextForm);
    setFieldExpanded((arr) => ensureSize(arr, nextForm.fields.length));
  }, [content, activePath]);

  const patch = (next: TableFormState) => {
    setForm(next);
    const p = parseTableFile(contentRef.current);
    if (!p.ok) return;
    const result = applyTableFormToContent(contentRef.current, next);
    if (result.ok) {
      skipSync.current = true;
      onChange(result.yaml);
    }
  };

  const parsed = parseTableFile(content);
  if (parseError || !parsed.ok) {
    return (
      <div className="visual-parse-error">
        <strong>无法解析为 Table 文件</strong>
        <pre>{parseError || (!parsed.ok ? parsed.error : '')}</pre>
        <p className="visual-hint">
          请切换到「源码」修正 YAML，或确保根节点为 <code>table:</code>（单表）或 <code>tables:</code>（数组）。
        </p>
      </div>
    );
  }

  return (
    <div className="visual-editor visual-editor--table">
      <section className="visual-section">
        <h3 className="visual-section-title">基础信息</h3>
        <div className="visual-grid">
          <Field label="表英文名">
            <input
              className="visual-input"
              value={form.name}
              onChange={(e) => patch({ ...form, name: e.target.value })}
              placeholder="物理表的逻辑名，文件唯一 key"
            />
          </Field>
          <Field label="表中文名">
            <input
              className="visual-input"
              value={form.title}
              onChange={(e) => patch({ ...form, title: e.target.value })}
            />
          </Field>
          <Field label="描述" className="visual-grid-span2">
            <ExpandableTextarea
              className={SQL_TEXTAREA}
              value={form.description}
              onChange={(v) => patch({ ...form, description: v })}
              minRowsFocused={4}
              spellCheck
            />
          </Field>
          <Field label="血缘" className="visual-grid-span2">
            <ExpandableTextarea
              className={SQL_TEXTAREA}
              value={form.lineage}
              onChange={(v) => patch({ ...form, lineage: v })}
              minRowsFocused={4}
              spellCheck
            />
          </Field>
        </div>
      </section>

      <section className="visual-section">
        <div className="visual-section-title-row">
          <h3 className="visual-section-title">字段列表</h3>
          <span className="visual-muted" style={{ fontSize: 12 }}>
            共 {form.fields.length} 个字段
          </span>
        </div>
        {form.fields.length > 0 && (
          <ListHeader
            columns={['字段ID', '字段名称', '字段类型', '字段描述', '枚举值']}
            grid={tableFieldsGrid}
          />
        )}

        {form.fields.map((row, i) => {
          const expanded = !!fieldExpanded[i];
          const toggle = () =>
            setFieldExpanded((arr) => {
              const next = ensureSize([...arr], form.fields.length);
              next[i] = !next[i];
              return next;
            });
          return (
            <div key={i} className={`visual-card visual-card--list ${expanded ? 'is-expanded' : 'is-collapsed'}`}>
              <div className="visual-card-summary">
                <button
                  type="button"
                  className="visual-card-toggle"
                  onClick={toggle}
                  aria-label={expanded ? '折叠' : '展开'}
                >
                  <span className="visual-card-chevron">{expanded ? '▾' : '▸'}</span>
                  <span className="visual-card-index">{i + 1}</span>
                </button>
                <div
                  className="visual-card-summary-fields visual-resizable-fields-grid"
                  style={{ gridTemplateColumns: tableFieldsGrid.gridTemplateColumns }}
                >
                  <input
                    className="visual-input visual-input--compact"
                    placeholder="ID"
                    value={row.name}
                    onChange={(e) => {
                      const d = [...form.fields];
                      d[i] = { ...row, name: e.target.value };
                      patch({ ...form, fields: d });
                    }}
                  />
                  <input
                    className="visual-input visual-input--compact"
                    placeholder="名称"
                    value={row.title}
                    onChange={(e) => {
                      const d = [...form.fields];
                      d[i] = { ...row, title: e.target.value };
                      patch({ ...form, fields: d });
                    }}
                  />
                  <input
                    className="visual-input visual-input--compact"
                    placeholder="类型"
                    value={row.data_type}
                    onChange={(e) => {
                      const d = [...form.fields];
                      d[i] = { ...row, data_type: e.target.value };
                      patch({ ...form, fields: d });
                    }}
                  />
                  <ExpandableTextarea
                    className={SQL_TEXTAREA_SUMMARY}
                    placeholder="描述"
                    value={row.description}
                    onChange={(v) => {
                      const d = [...form.fields];
                      d[i] = { ...row, description: v };
                      patch({ ...form, fields: d });
                    }}
                    minRowsFocused={4}
                    spellCheck
                  />
                  <ExpandableTextarea
                    className={SQL_TEXTAREA_SUMMARY}
                    placeholder="枚举值"
                    value={row.enum_values}
                    onChange={(v) => {
                      const d = [...form.fields];
                      d[i] = { ...row, enum_values: v };
                      patch({ ...form, fields: d });
                    }}
                    minRowsFocused={4}
                    spellCheck={false}
                  />
                </div>
                <button
                  type="button"
                  className="visual-btn-danger"
                  onClick={() => {
                    patch({ ...form, fields: form.fields.filter((_, j) => j !== i) });
                    setFieldExpanded((arr) => arr.filter((_, j) => j !== i));
                  }}
                >
                  删除
                </button>
              </div>
              {expanded && (
                <div className="visual-card-body">
                  <div className="visual-grid">
                    <Field label="nullable">
                      <label className="visual-check">
                        <input
                          type="checkbox"
                          checked={row.nullable}
                          onChange={(e) => {
                            const d = [...form.fields];
                            d[i] = { ...row, nullable: e.target.checked };
                            patch({ ...form, fields: d });
                          }}
                        />
                        允许为空（未勾选时写入 <code>nullable: false</code>）
                      </label>
                    </Field>
                    <Field label="primary_key">
                      <label className="visual-check">
                        <input
                          type="checkbox"
                          checked={row.primary_key}
                          onChange={(e) => {
                            const d = [...form.fields];
                            d[i] = { ...row, primary_key: e.target.checked };
                            patch({ ...form, fields: d });
                          }}
                        />
                        主键
                      </label>
                    </Field>
                    <Field label="字段描述" className="visual-grid-span2">
                      <ExpandableTextarea
                        className={SQL_TEXTAREA}
                        value={row.description}
                        onChange={(v) => {
                          const d = [...form.fields];
                          d[i] = { ...row, description: v };
                          patch({ ...form, fields: d });
                        }}
                        minRowsFocused={5}
                        spellCheck
                      />
                    </Field>
                    <Field label="枚举值" className="visual-grid-span2">
                      <ExpandableTextarea
                        className={SQL_TEXTAREA}
                        value={row.enum_values}
                        onChange={(v) => {
                          const d = [...form.fields];
                          d[i] = { ...row, enum_values: v };
                          patch({ ...form, fields: d });
                        }}
                        minRowsFocused={5}
                        spellCheck={false}
                      />
                    </Field>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <button
          type="button"
          className="visual-btn-add"
          onClick={() => {
            patch({ ...form, fields: [...form.fields, emptyFieldRow()] });
            setFieldExpanded((arr) => [...arr, true]);
          }}
        >
          + 添加字段
        </button>
      </section>
    </div>
  );
}

type GridApi = ReturnType<typeof useResizableGridWeights>;

function ListHeader({ columns, grid }: { columns: string[]; grid: GridApi }) {
  const showHandles = columns.length > 1;
  return (
    <div className="visual-list-header">
      <span className="visual-list-header-index">序号</span>
      <div
        ref={grid.gridRef as LegacyRef<HTMLDivElement>}
        className="visual-list-header-fields visual-card-summary-fields visual-resizable-fields-grid"
        style={{ gridTemplateColumns: grid.gridTemplateColumns }}
      >
        {columns.map((c, i) => (
          <span
            key={c}
            className={`visual-list-header-cell ${showHandles ? 'visual-list-header-cell--resizable' : ''}`}
          >
            {c}
            {showHandles && i < columns.length - 1 && (
              <span
                className="resizable-col-handle resizable-col-handle--grid"
                onPointerDown={grid.onResizePointerDown(i)}
                aria-hidden
              />
            )}
          </span>
        ))}
      </div>
      <span className="visual-list-header-action" aria-hidden />
    </div>
  );
}

function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`visual-field ${className}`}>
      <label className="visual-label">{label}</label>
      {children}
    </div>
  );
}
