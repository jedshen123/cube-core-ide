import { useEffect, useRef, useState, type ReactNode } from 'react';
import { parseCubeFile } from '../modelYaml';
import {
  applyCubeFormToContent,
  cubeToFormState,
  emptyCubeForm,
  type CubeFormState,
  type DimensionFormRow,
  type JoinFormRow,
  type MeasureFormRow,
} from '../visualModel/cubeForm';

type Props = {
  content: string;
  cubeIndex: number;
  onCubeIndexChange: (i: number) => void;
  onChange: (yaml: string) => void;
  activePath: string | null;
};

const emptyMeasure = (): MeasureFormRow => ({
  name: '',
  title: '',
  description: '',
  type: '',
  sql: '',
  metaAiContext: '',
});

const emptyDimension = (): DimensionFormRow => ({
  name: '',
  title: '',
  description: '',
  type: '',
  sql: '',
  primary_key: false,
  metaAiContext: '',
});

const emptyJoin = (): JoinFormRow => ({
  name: '',
  relationship: '',
  sql: '',
});

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

export function VisualCubeEditor({ content, cubeIndex, onCubeIndexChange, onChange, activePath }: Props) {
  const [form, setForm] = useState<CubeFormState>(emptyCubeForm);
  const [parseError, setParseError] = useState<string | null>(null);
  const [dimExpanded, setDimExpanded] = useState<boolean[]>([]);
  const [measureExpanded, setMeasureExpanded] = useState<boolean[]>([]);
  const [joinExpanded, setJoinExpanded] = useState<boolean[]>([]);
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
    const p = parseCubeFile(content);
    if (!p.ok) {
      setParseError(p.error);
      setForm(emptyCubeForm());
      return;
    }
    setParseError(null);
    if (p.cubes.length === 0) {
      setForm(emptyCubeForm());
      return;
    }
    const idx = Math.min(Math.max(0, cubeIndex), p.cubes.length - 1);
    if (idx !== cubeIndex) onCubeIndexChange(idx);
    const cube = p.cubes[idx] || {};
    const nextForm = cubeToFormState(cube);
    setForm(nextForm);
    setDimExpanded((arr) => ensureSize(arr, nextForm.dimensions.length));
    setMeasureExpanded((arr) => ensureSize(arr, nextForm.measures.length));
    setJoinExpanded((arr) => ensureSize(arr, nextForm.joins.length));
  }, [content, cubeIndex, activePath, onCubeIndexChange]);

  const patch = (next: CubeFormState) => {
    setForm(next);
    const p = parseCubeFile(contentRef.current);
    if (!p.ok) return;
    if (p.cubes.length === 0) return;
    const idx = Math.min(Math.max(0, cubeIndex), p.cubes.length - 1);
    const result = applyCubeFormToContent(contentRef.current, idx, next);
    if (result.ok) {
      skipSync.current = true;
      onChange(result.yaml);
    }
  };

  const parsed = parseCubeFile(content);
  if (parseError || !parsed.ok) {
    return (
      <div className="visual-parse-error">
        <strong>无法解析为 Cube 文件</strong>
        <pre>{parseError || (!parsed.ok ? parsed.error : '')}</pre>
        <p className="visual-hint">请切换到「源码」修正 YAML，或确保根节点包含 cubes 数组。</p>
      </div>
    );
  }

  if (parsed.cubes.length === 0) {
    return (
      <div className="visual-parse-error visual-parse-error--soft">
        <strong>暂无 cube 定义</strong>
        <p className="visual-hint">请在「源码」中为 <code>cubes:</code> 添加至少一项后再使用可视化编辑。</p>
      </div>
    );
  }

  const cubeNames = parsed.cubes.map((c, i) => (typeof c.name === 'string' && c.name ? c.name : `cube_${i + 1}`));

  return (
    <div className="visual-editor visual-editor--cube">
      {parsed.cubes.length > 1 && (
        <div className="visual-field-row visual-field-row--selector">
          <label className="visual-label">编辑对象</label>
          <select
            className="visual-select"
            value={Math.min(cubeIndex, parsed.cubes.length - 1)}
            onChange={(e) => onCubeIndexChange(Number(e.target.value))}
          >
            {parsed.cubes.map((_, i) => (
              <option key={i} value={i}>
                {cubeNames[i]}
              </option>
            ))}
          </select>
        </div>
      )}
      <p className="visual-doc-hint">
        结构对齐 CubeCore：<strong>基础信息</strong>含 <code>description</code> 与 Cube 级 <code>meta.ai_context</code>；其下为{' '}
        <code>dimensions</code> → <code>measures</code> → <code>joins</code>；列表项默认折叠，只显示概要字段。
      </p>

      <section className="visual-section">
        <h3 className="visual-section-title">基础信息</h3>
        <div className="visual-grid">
          <Field label="name">
            <input className="visual-input" value={form.name} onChange={(e) => patch({ ...form, name: e.target.value })} />
          </Field>
          <Field label="title（可选）">
            <input className="visual-input" value={form.title} onChange={(e) => patch({ ...form, title: e.target.value })} />
          </Field>
          <Field label="sql_table">
            <input
              className="visual-input"
              value={form.sql_table}
              onChange={(e) => patch({ ...form, sql_table: e.target.value })}
              placeholder="物理表名"
            />
          </Field>
          <Field label="sql（可选）">
            <input
              className="visual-input"
              value={form.sql}
              onChange={(e) => patch({ ...form, sql: e.target.value })}
              placeholder="与 sql_table 二选一或留空"
            />
          </Field>
          <Field label="description" className="visual-grid-span2">
            <textarea
              className="visual-textarea"
              value={form.description}
              onChange={(e) => patch({ ...form, description: e.target.value })}
              rows={4}
            />
          </Field>
          <div className="visual-grid-span2">
            <MetaAiField
              label="meta.ai_context（Cube 级）"
              hint="对应 YAML 路径 meta.ai_context，多行字符串。"
              value={form.cubeMetaAiContext}
              onChange={(v) => patch({ ...form, cubeMetaAiContext: v })}
              rows={6}
            />
          </div>
        </div>
      </section>

      <section className="visual-section">
        <h3 className="visual-section-title">Dimensions</h3>
        {form.dimensions.map((row, i) => {
          const expanded = !!dimExpanded[i];
          const toggle = () =>
            setDimExpanded((arr) => {
              const next = ensureSize([...arr], form.dimensions.length);
              next[i] = !next[i];
              return next;
            });
          return (
            <div key={i} className={`visual-card visual-card--list ${expanded ? 'is-expanded' : 'is-collapsed'}`}>
              <div className="visual-card-summary">
                <button type="button" className="visual-card-toggle" onClick={toggle} aria-label={expanded ? '折叠' : '展开'}>
                  <span className="visual-card-chevron">{expanded ? '▾' : '▸'}</span>
                  <span className="visual-card-index">#{i + 1}</span>
                </button>
                <div className="visual-card-summary-fields">
                  <input
                    className="visual-input visual-input--compact"
                    placeholder="name"
                    value={row.name}
                    onChange={(e) => {
                      const d = [...form.dimensions];
                      d[i] = { ...row, name: e.target.value };
                      patch({ ...form, dimensions: d });
                    }}
                  />
                  <input
                    className="visual-input visual-input--compact"
                    placeholder="title"
                    value={row.title}
                    onChange={(e) => {
                      const d = [...form.dimensions];
                      d[i] = { ...row, title: e.target.value };
                      patch({ ...form, dimensions: d });
                    }}
                  />
                  <input
                    className="visual-input visual-input--compact"
                    placeholder="type"
                    value={row.type}
                    onChange={(e) => {
                      const d = [...form.dimensions];
                      d[i] = { ...row, type: e.target.value };
                      patch({ ...form, dimensions: d });
                    }}
                  />
                </div>
                <button
                  type="button"
                  className="visual-btn-danger"
                  onClick={() => {
                    patch({ ...form, dimensions: form.dimensions.filter((_, j) => j !== i) });
                    setDimExpanded((arr) => arr.filter((_, j) => j !== i));
                  }}
                >
                  删除
                </button>
              </div>
              {expanded && (
                <div className="visual-card-body">
                  <div className="visual-grid">
                    <Field label="sql">
                      <input
                        className="visual-input"
                        value={row.sql}
                        onChange={(e) => {
                          const d = [...form.dimensions];
                          d[i] = { ...row, sql: e.target.value };
                          patch({ ...form, dimensions: d });
                        }}
                      />
                    </Field>
                    <Field label="primary_key">
                      <label className="visual-check">
                        <input
                          type="checkbox"
                          checked={row.primary_key}
                          onChange={(e) => {
                            const d = [...form.dimensions];
                            d[i] = { ...row, primary_key: e.target.checked };
                            patch({ ...form, dimensions: d });
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
                          const d = [...form.dimensions];
                          d[i] = { ...row, description: e.target.value };
                          patch({ ...form, dimensions: d });
                        }}
                        rows={2}
                      />
                    </Field>
                  </div>
                  <MetaAiField
                    label="meta.ai_context"
                    hint="维度级 AI 说明，写入 YAML 的 meta.ai_context。"
                    value={row.metaAiContext}
                    onChange={(v) => {
                      const d = [...form.dimensions];
                      d[i] = { ...row, metaAiContext: v };
                      patch({ ...form, dimensions: d });
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
            patch({ ...form, dimensions: [...form.dimensions, emptyDimension()] });
            setDimExpanded((arr) => [...arr, true]);
          }}
        >
          + 添加 dimension
        </button>
      </section>

      <section className="visual-section">
        <h3 className="visual-section-title">Measures</h3>
        <p className="visual-section-hint">
          未在表单中编辑的字段（如 <code>filters</code>、<code>meta</code> 中除 <code>ai_context</code> 外的键）会从原 YAML 保留。
        </p>
        {form.measures.map((row, i) => {
          const expanded = !!measureExpanded[i];
          const toggle = () =>
            setMeasureExpanded((arr) => {
              const next = ensureSize([...arr], form.measures.length);
              next[i] = !next[i];
              return next;
            });
          return (
            <div key={i} className={`visual-card visual-card--list ${expanded ? 'is-expanded' : 'is-collapsed'}`}>
              <div className="visual-card-summary">
                <button type="button" className="visual-card-toggle" onClick={toggle} aria-label={expanded ? '折叠' : '展开'}>
                  <span className="visual-card-chevron">{expanded ? '▾' : '▸'}</span>
                  <span className="visual-card-index">#{i + 1}</span>
                </button>
                <div className="visual-card-summary-fields">
                  <input
                    className="visual-input visual-input--compact"
                    placeholder="name"
                    value={row.name}
                    onChange={(e) => {
                      const m = [...form.measures];
                      m[i] = { ...row, name: e.target.value };
                      patch({ ...form, measures: m });
                    }}
                  />
                  <input
                    className="visual-input visual-input--compact"
                    placeholder="title"
                    value={row.title}
                    onChange={(e) => {
                      const m = [...form.measures];
                      m[i] = { ...row, title: e.target.value };
                      patch({ ...form, measures: m });
                    }}
                  />
                  <input
                    className="visual-input visual-input--compact"
                    placeholder="type（count_distinct、sum…）"
                    value={row.type}
                    onChange={(e) => {
                      const m = [...form.measures];
                      m[i] = { ...row, type: e.target.value };
                      patch({ ...form, measures: m });
                    }}
                  />
                </div>
                <button
                  type="button"
                  className="visual-btn-danger"
                  onClick={() => {
                    patch({ ...form, measures: form.measures.filter((_, j) => j !== i) });
                    setMeasureExpanded((arr) => arr.filter((_, j) => j !== i));
                  }}
                >
                  删除
                </button>
              </div>
              {expanded && (
                <div className="visual-card-body">
                  <div className="visual-grid">
                    <Field label="sql" className="visual-grid-span2">
                      <input
                        className="visual-input"
                        value={row.sql}
                        onChange={(e) => {
                          const m = [...form.measures];
                          m[i] = { ...row, sql: e.target.value };
                          patch({ ...form, measures: m });
                        }}
                      />
                    </Field>
                    <Field label="description" className="visual-grid-span2">
                      <textarea
                        className="visual-textarea visual-textarea--sm"
                        value={row.description}
                        onChange={(e) => {
                          const m = [...form.measures];
                          m[i] = { ...row, description: e.target.value };
                          patch({ ...form, measures: m });
                        }}
                        rows={2}
                      />
                    </Field>
                  </div>
                  <MetaAiField
                    label="meta.ai_context"
                    hint="指标级 AI 说明；与 filters 等同层存在时分别保留。"
                    value={row.metaAiContext}
                    onChange={(v) => {
                      const m = [...form.measures];
                      m[i] = { ...row, metaAiContext: v };
                      patch({ ...form, measures: m });
                    }}
                    rows={4}
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
            patch({ ...form, measures: [...form.measures, emptyMeasure()] });
            setMeasureExpanded((arr) => [...arr, true]);
          }}
        >
          + 添加 measure
        </button>
      </section>

      <section className="visual-section">
        <h3 className="visual-section-title">Joins</h3>
        {form.joins.map((row, i) => {
          const expanded = !!joinExpanded[i];
          const toggle = () =>
            setJoinExpanded((arr) => {
              const next = ensureSize([...arr], form.joins.length);
              next[i] = !next[i];
              return next;
            });
          return (
            <div key={i} className={`visual-card visual-card--list ${expanded ? 'is-expanded' : 'is-collapsed'}`}>
              <div className="visual-card-summary">
                <button type="button" className="visual-card-toggle" onClick={toggle} aria-label={expanded ? '折叠' : '展开'}>
                  <span className="visual-card-chevron">{expanded ? '▾' : '▸'}</span>
                  <span className="visual-card-index">#{i + 1}</span>
                </button>
                <div className="visual-card-summary-fields visual-card-summary-fields--two">
                  <input
                    className="visual-input visual-input--compact"
                    placeholder="name（被 join 的 cube 名）"
                    value={row.name}
                    onChange={(e) => {
                      const j = [...form.joins];
                      j[i] = { ...row, name: e.target.value };
                      patch({ ...form, joins: j });
                    }}
                  />
                  <input
                    className="visual-input visual-input--compact"
                    placeholder="relationship（one_to_many、many_to_one…）"
                    value={row.relationship}
                    onChange={(e) => {
                      const j = [...form.joins];
                      j[i] = { ...row, relationship: e.target.value };
                      patch({ ...form, joins: j });
                    }}
                  />
                </div>
                <button
                  type="button"
                  className="visual-btn-danger"
                  onClick={() => {
                    patch({ ...form, joins: form.joins.filter((_, j) => j !== i) });
                    setJoinExpanded((arr) => arr.filter((_, j) => j !== i));
                  }}
                >
                  删除
                </button>
              </div>
              {expanded && (
                <div className="visual-card-body">
                  <div className="visual-grid">
                    <Field label="sql" className="visual-grid-span2">
                      <textarea
                        className="visual-textarea visual-textarea--sm"
                        value={row.sql}
                        onChange={(e) => {
                          const j = [...form.joins];
                          j[i] = { ...row, sql: e.target.value };
                          patch({ ...form, joins: j });
                        }}
                        rows={3}
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
            patch({ ...form, joins: [...form.joins, emptyJoin()] });
            setJoinExpanded((arr) => [...arr, true]);
          }}
        >
          + 添加 join
        </button>
      </section>
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
