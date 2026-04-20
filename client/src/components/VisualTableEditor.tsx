import { useEffect, useRef, useState, type ReactNode } from 'react';
import { parseTableFile } from '../modelYaml';
import {
  applyTableFormToContent,
  emptyFieldRow,
  emptyTableForm,
  tableToFormState,
  type TableFormState,
} from '../visualModel/tableForm';

type Props = {
  content: string;
  onChange: (yaml: string) => void;
  activePath: string | null;
};

function MetaAiField({
  label,
  hint,
  value,
  onChange,
  rows = 4,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <div className="visual-meta-ai">
      <label className="visual-label">{label}</label>
      {hint && <p className="visual-meta-ai-hint">{hint}</p>}
      <textarea
        className="visual-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        spellCheck={false}
      />
    </div>
  );
}

export function VisualTableEditor({ content, onChange, activePath }: Props) {
  const [form, setForm] = useState<TableFormState>(emptyTableForm);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fieldExpanded, setFieldExpanded] = useState<boolean[]>([]);
  const skipSync = useRef(false);
  const contentRef = useRef(content);
  contentRef.current = content;

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
      <p className="visual-doc-hint">
        每个文件存储<strong>一张物理表</strong>的元数据：根节点 <code>table:</code> 包含表属性与 <code>fields</code> 列表；
        支持 <code>meta.ai_context</code>（多行字符串）在表级与字段级描述语义。
      </p>

      <section className="visual-section">
        <h3 className="visual-section-title">基础信息</h3>
        <div className="visual-grid">
          <Field label="name">
            <input
              className="visual-input"
              value={form.name}
              onChange={(e) => patch({ ...form, name: e.target.value })}
              placeholder="物理表的逻辑名，文件唯一 key"
            />
          </Field>
          <Field label="title（可选）">
            <input
              className="visual-input"
              value={form.title}
              onChange={(e) => patch({ ...form, title: e.target.value })}
            />
          </Field>
          <Field label="database（可选）">
            <input
              className="visual-input"
              value={form.database}
              onChange={(e) => patch({ ...form, database: e.target.value })}
              placeholder="例如 analytics"
            />
          </Field>
          <Field label="schema（可选）">
            <input
              className="visual-input"
              value={form.schema}
              onChange={(e) => patch({ ...form, schema: e.target.value })}
              placeholder="例如 public"
            />
          </Field>
          <Field label="sql_table（可选，全名）" className="visual-grid-span2">
            <input
              className="visual-input"
              value={form.sql_table}
              onChange={(e) => patch({ ...form, sql_table: e.target.value })}
              placeholder="schema.table，例如 public.orders"
            />
          </Field>
          <Field label="description" className="visual-grid-span2">
            <textarea
              className="visual-textarea"
              value={form.description}
              onChange={(e) => patch({ ...form, description: e.target.value })}
              rows={3}
            />
          </Field>
          <div className="visual-grid-span2">
            <MetaAiField
              label="meta.ai_context（表级）"
              hint="对应 YAML 路径 meta.ai_context，供 AI 助手理解该表语义。"
              value={form.tableMetaAiContext}
              onChange={(v) => patch({ ...form, tableMetaAiContext: v })}
              rows={6}
            />
          </div>
        </div>
      </section>

      <section className="visual-section">
        <div className="visual-section-title-row">
          <h3 className="visual-section-title">字段列表（Fields）</h3>
          <span className="visual-muted" style={{ fontSize: 12 }}>
            共 {form.fields.length} 个字段
          </span>
        </div>
        <p className="visual-section-hint">
          点击行展开可编辑 <code>description</code>、<code>nullable</code>、<code>primary_key</code> 与{' '}
          <code>meta.ai_context</code>。未在表单里编辑的字段（例如自定义键）会从原 YAML 保留。
        </p>

        {form.fields.length > 0 && (
          <ListHeader columns={['name', 'title', 'data_type', 'description']} />
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
                  <span className="visual-card-index">#{i + 1}</span>
                </button>
                <div className="visual-card-summary-fields visual-card-summary-fields--four">
                  <input
                    className="visual-input visual-input--compact"
                    placeholder="name"
                    value={row.name}
                    onChange={(e) => {
                      const d = [...form.fields];
                      d[i] = { ...row, name: e.target.value };
                      patch({ ...form, fields: d });
                    }}
                  />
                  <input
                    className="visual-input visual-input--compact"
                    placeholder="title"
                    value={row.title}
                    onChange={(e) => {
                      const d = [...form.fields];
                      d[i] = { ...row, title: e.target.value };
                      patch({ ...form, fields: d });
                    }}
                  />
                  <input
                    className="visual-input visual-input--compact"
                    placeholder="data_type"
                    value={row.data_type}
                    onChange={(e) => {
                      const d = [...form.fields];
                      d[i] = { ...row, data_type: e.target.value };
                      patch({ ...form, fields: d });
                    }}
                  />
                  <input
                    className="visual-input visual-input--compact"
                    placeholder="description"
                    value={row.description}
                    onChange={(e) => {
                      const d = [...form.fields];
                      d[i] = { ...row, description: e.target.value };
                      patch({ ...form, fields: d });
                    }}
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
                    <Field label="description" className="visual-grid-span2">
                      <textarea
                        className="visual-textarea visual-textarea--sm"
                        value={row.description}
                        onChange={(e) => {
                          const d = [...form.fields];
                          d[i] = { ...row, description: e.target.value };
                          patch({ ...form, fields: d });
                        }}
                        rows={2}
                      />
                    </Field>
                  </div>
                  <MetaAiField
                    label="meta.ai_context"
                    hint="字段级 AI 说明，写入 YAML 的 meta.ai_context。"
                    value={row.metaAiContext}
                    onChange={(v) => {
                      const d = [...form.fields];
                      d[i] = { ...row, metaAiContext: v };
                      patch({ ...form, fields: d });
                    }}
                    rows={3}
                  />
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

function ListHeader({ columns }: { columns: string[] }) {
  return (
    <div className="visual-list-header">
      <span className="visual-list-header-index">#</span>
      <div className="visual-list-header-fields visual-card-summary-fields visual-card-summary-fields--four">
        {columns.map((c) => (
          <span key={c} className="visual-list-header-cell">
            {c}
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
