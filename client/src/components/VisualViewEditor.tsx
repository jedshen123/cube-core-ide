import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api';
import { parseCubeFile, parseViewFile } from '../modelYaml';
import {
  applyViewFormToContent,
  emptyViewForm,
  viewToFormState,
  type ViewFormState,
} from '../visualModel/viewForm';

type Props = {
  content: string;
  viewIndex: number;
  onViewIndexChange: (i: number) => void;
  onChange: (yaml: string) => void;
  activePath: string | null;
};

type CubeMembers = { dimensions: string[]; measures: string[] };

function membersOf(cube: Record<string, unknown>): CubeMembers {
  const toNames = (arr: unknown): string[] => {
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x) => {
        if (x && typeof x === 'object' && typeof (x as { name?: unknown }).name === 'string') {
          return (x as { name: string }).name;
        }
        return '';
      })
      .filter(Boolean);
  };
  return {
    dimensions: toNames(cube.dimensions),
    measures: toNames(cube.measures),
  };
}

function parseIncludesText(text: string): string[] {
  return text
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function stringifyIncludes(list: string[]): string {
  return list.join(', ');
}

export function VisualViewEditor({ content, viewIndex, onViewIndexChange, onChange, activePath }: Props) {
  const [form, setForm] = useState<ViewFormState>(emptyViewForm);
  const [parseError, setParseError] = useState<string | null>(null);
  const [cubeIndex, setCubeIndex] = useState<Record<string, CubeMembers>>({});
  const [cubeIndexLoading, setCubeIndexLoading] = useState(false);
  const [cubeRefExpanded, setCubeRefExpanded] = useState<boolean[]>([]);
  const skipSync = useRef(false);
  const contentRef = useRef(content);
  contentRef.current = content;

  const ensureSize = (arr: boolean[], size: number): boolean[] => {
    if (arr.length === size) return arr;
    if (arr.length < size) return [...arr, ...Array(size - arr.length).fill(false)];
    return arr.slice(0, size);
  };

  const loadCubeIndex = async () => {
    setCubeIndexLoading(true);
    try {
      const files = await api.listFiles();
      const cubeFiles = files.filter((f) => f.type === 'cube');
      const map: Record<string, CubeMembers> = {};
      await Promise.all(
        cubeFiles.map(async (f) => {
          try {
            const { content: text } = await api.readFile(f.path);
            const parsed = parseCubeFile(text);
            if (!parsed.ok) return;
            for (const c of parsed.cubes) {
              const name = typeof c.name === 'string' ? c.name : '';
              if (!name) continue;
              map[name] = membersOf(c);
            }
          } catch {
            // ignore
          }
        })
      );
      setCubeIndex(map);
    } finally {
      setCubeIndexLoading(false);
    }
  };

  useEffect(() => {
    loadCubeIndex();
  }, []);

  useEffect(() => {
    if (skipSync.current) {
      skipSync.current = false;
      return;
    }
    const p = parseViewFile(content);
    if (!p.ok) {
      setParseError(p.error);
      setForm(emptyViewForm());
      return;
    }
    setParseError(null);
    if (p.views.length === 0) {
      setForm(emptyViewForm());
      return;
    }
    const idx = Math.min(Math.max(0, viewIndex), p.views.length - 1);
    if (idx !== viewIndex) onViewIndexChange(idx);
    const view = p.views[idx] || {};
    const nextForm = viewToFormState(view);
    setForm(nextForm);
    setCubeRefExpanded((arr) => ensureSize(arr, nextForm.cubes.length));
  }, [content, viewIndex, activePath, onViewIndexChange]);

  const patch = (next: ViewFormState) => {
    setForm(next);
    const p = parseViewFile(contentRef.current);
    if (!p.ok) return;
    if (p.views.length === 0) return;
    const idx = Math.min(Math.max(0, viewIndex), p.views.length - 1);
    const result = applyViewFormToContent(contentRef.current, idx, next);
    if (result.ok) {
      skipSync.current = true;
      onChange(result.yaml);
    }
  };

  const parsed = parseViewFile(content);
  if (parseError || !parsed.ok) {
    return (
      <div className="visual-parse-error">
        <strong>无法解析为 View 文件</strong>
        <pre>{parseError || (!parsed.ok ? parsed.error : '')}</pre>
        <p className="visual-hint">请切换到「源码」修正 YAML，或确保根节点包含 views 数组。</p>
      </div>
    );
  }

  if (parsed.views.length === 0) {
    return (
      <div className="visual-parse-error visual-parse-error--soft">
        <strong>暂无 view 定义</strong>
        <p className="visual-hint">请在「源码」中为 <code>views:</code> 添加至少一项后再使用可视化编辑。</p>
      </div>
    );
  }

  const viewNames = parsed.views.map((v, i) => (typeof v.name === 'string' && v.name ? v.name : `view_${i + 1}`));

  return (
    <div className="visual-editor visual-editor--view">
      {parsed.views.length > 1 && (
        <div className="visual-field-row visual-field-row--selector">
          <label className="visual-label">编辑对象</label>
          <select
            className="visual-select"
            value={Math.min(viewIndex, parsed.views.length - 1)}
            onChange={(e) => onViewIndexChange(Number(e.target.value))}
          >
            {parsed.views.map((_, i) => (
              <option key={i} value={i}>
                {viewNames[i]}
              </option>
            ))}
          </select>
        </div>
      )}
      <p className="visual-doc-hint">
        结构对齐 CubeCore：<strong>基础信息</strong>含 <code>name</code>、可选 <code>title</code> / <code>description</code> 与视图级 <code>meta.ai_context</code>；其下为{' '}
        <code>cubes</code> 引用（<code>join_path</code>、<code>prefix</code>、<code>includes</code>）；列表项默认折叠，只显示 <code>join_path</code>。
      </p>

      <section className="visual-section">
        <h3 className="visual-section-title">基础信息</h3>
        <div className="visual-grid">
          <div className="visual-field">
            <label className="visual-label">name</label>
            <input className="visual-input" value={form.name} onChange={(e) => patch({ ...form, name: e.target.value })} />
          </div>
          <div className="visual-field">
            <label className="visual-label">title（可选）</label>
            <input className="visual-input" value={form.title} onChange={(e) => patch({ ...form, title: e.target.value })} />
          </div>
          <div className="visual-field visual-grid-span2">
            <label className="visual-label">description（可选）</label>
            <textarea
              className="visual-textarea visual-textarea--sm"
              value={form.description}
              onChange={(e) => patch({ ...form, description: e.target.value })}
              rows={2}
            />
          </div>
          <div className="visual-meta-ai visual-grid-span2">
            <label className="visual-label">meta.ai_context（View 级）</label>
            <p className="visual-meta-ai-hint">与 CubeCore 一致：视图业务说明写在 meta.ai_context。</p>
            <textarea
              className="visual-textarea"
              value={form.viewMetaAiContext}
              onChange={(e) => patch({ ...form, viewMetaAiContext: e.target.value })}
              rows={8}
              spellCheck={false}
            />
          </div>
        </div>
      </section>

      <section className="visual-section">
        <div className="visual-section-title-row">
          <h3 className="visual-section-title">cubes（引用路径与成员）</h3>
          <button
            type="button"
            className="visual-btn-subtle"
            onClick={loadCubeIndex}
            disabled={cubeIndexLoading}
            title="重新读取项目内所有 cube 文件，更新 includes 的候选项"
          >
            {cubeIndexLoading ? '刷新中…' : '刷新候选项'}
          </button>
        </div>
        <p className="visual-section-hint">
          <code>join_path</code> 支持链式路径（如 <code>app_user_flags.user_devices.devices</code>），末段即为目标 cube。
          <code>includes</code> 下方的标签区从该 cube 的 <code>dimensions</code> 与 <code>measures</code> 补全。
        </p>
        {form.cubes.length > 0 && (
          <ListHeader columns={['join_path']} variant="single" />
        )}
        {form.cubes.map((row, i) => (
          <CubeRefCard
            key={i}
            index={i}
            row={row}
            cubeIndex={cubeIndex}
            expanded={!!cubeRefExpanded[i]}
            onToggle={() =>
              setCubeRefExpanded((arr) => {
                const next = ensureSize([...arr], form.cubes.length);
                next[i] = !next[i];
                return next;
              })
            }
            onChange={(next) => {
              const c = [...form.cubes];
              c[i] = next;
              patch({ ...form, cubes: c });
            }}
            onDelete={() => {
              patch({ ...form, cubes: form.cubes.filter((_, j) => j !== i) });
              setCubeRefExpanded((arr) => arr.filter((_, j) => j !== i));
            }}
          />
        ))}
        <button
          type="button"
          className="visual-btn-add"
          onClick={() => {
            patch({
              ...form,
              cubes: [...form.cubes, { join_path: '', includesText: '', prefix: false }],
            });
            setCubeRefExpanded((arr) => [...arr, true]);
          }}
        >
          + 添加 cube 引用
        </button>
      </section>
    </div>
  );
}

function ListHeader({
  columns,
  variant = 'default',
}: {
  columns: string[];
  variant?: 'default' | 'two' | 'single';
}) {
  const fieldsClass = `visual-list-header-fields visual-card-summary-fields${
    variant === 'two'
      ? ' visual-card-summary-fields--two'
      : variant === 'single'
        ? ' visual-card-summary-fields--single'
        : ''
  }`;
  return (
    <div className="visual-list-header">
      <span className="visual-list-header-index">#</span>
      <div className={fieldsClass}>
        {columns.map((c) => (
          <span key={c} className="visual-list-header-cell">{c}</span>
        ))}
      </div>
      <span className="visual-list-header-action" aria-hidden />
    </div>
  );
}

type CubeRefCardProps = {
  index: number;
  row: { join_path: string; includesText: string; prefix: boolean };
  cubeIndex: Record<string, CubeMembers>;
  expanded: boolean;
  onToggle: () => void;
  onChange: (next: { join_path: string; includesText: string; prefix: boolean }) => void;
  onDelete: () => void;
};

function CubeRefCard({ index, row, cubeIndex, expanded, onToggle, onChange, onDelete }: CubeRefCardProps) {
  const resolvedCubeName = useMemo(() => {
    const parts = row.join_path.trim().split('.').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }, [row.join_path]);

  const members: CubeMembers = cubeIndex[resolvedCubeName] || { dimensions: [], measures: [] };
  const tags = useMemo(() => parseIncludesText(row.includesText), [row.includesText]);
  const tagSet = useMemo(() => new Set(tags), [tags]);

  const availableDims = members.dimensions.filter((n) => !tagSet.has(n));
  const availableMeasures = members.measures.filter((n) => !tagSet.has(n));

  const [pendingTag, setPendingTag] = useState('');
  const datalistId = `cube-ref-includes-${index}`;

  const setTags = (list: string[]) => {
    onChange({ ...row, includesText: stringifyIncludes(list) });
  };

  const addTag = (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    if (tagSet.has(name)) return;
    setTags([...tags, name]);
  };

  const removeTag = (name: string) => {
    setTags(tags.filter((t) => t !== name));
  };

  const addAll = (names: string[]) => {
    const missing = names.filter((n) => !tagSet.has(n));
    if (missing.length) setTags([...tags, ...missing]);
  };

  const categorize = (name: string): 'dimension' | 'measure' | 'unknown' => {
    if (members.dimensions.includes(name)) return 'dimension';
    if (members.measures.includes(name)) return 'measure';
    return 'unknown';
  };

  return (
    <div className={`visual-card visual-card--list ${expanded ? 'is-expanded' : 'is-collapsed'}`}>
      <div className="visual-card-summary">
        <button type="button" className="visual-card-toggle" onClick={onToggle} aria-label={expanded ? '折叠' : '展开'}>
          <span className="visual-card-chevron">{expanded ? '▾' : '▸'}</span>
          <span className="visual-card-index">#{index + 1}</span>
        </button>
        <div className="visual-card-summary-fields visual-card-summary-fields--single">
          <input
            className="visual-input visual-input--compact"
            placeholder="join_path（如 app_user_flags.user_devices.devices）"
            value={row.join_path}
            onChange={(e) => onChange({ ...row, join_path: e.target.value })}
          />
        </div>
        <button type="button" className="visual-btn-danger" onClick={onDelete}>
          删除
        </button>
      </div>
      {!expanded && resolvedCubeName && (
        <div className="visual-card-subline">
          <span className="visual-muted">目标 cube：</span>
          <code>{resolvedCubeName}</code>
          {!cubeIndex[resolvedCubeName] && (
            <span className="visual-muted"> · 未找到对应 cube 文件</span>
          )}
          {tags.length > 0 && (
            <span className="visual-muted"> · includes {tags.length} 项</span>
          )}
          {row.prefix && <span className="visual-muted"> · prefix=true</span>}
        </div>
      )}
      {expanded && (
      <div className="visual-card-body">
      <div className="visual-grid">
        <div className="visual-field visual-grid-span2">
          <p className="visual-meta-ai-hint">
            目标 cube：
            {resolvedCubeName ? (
              <code>{resolvedCubeName}</code>
            ) : (
              <span className="visual-muted">（尚未填写）</span>
            )}
            {resolvedCubeName && !cubeIndex[resolvedCubeName] && (
              <span className="visual-muted"> · 未找到对应 cube 文件，includes 将无候选项，仅支持自定义输入</span>
            )}
          </p>
        </div>
        <div className="visual-field">
          <label className="visual-check visual-check--block">
            <input
              type="checkbox"
              checked={row.prefix}
              onChange={(e) => onChange({ ...row, prefix: e.target.checked })}
            />
            prefix（为列名加路径前缀，避免冲突）
          </label>
        </div>
        <div className="visual-field visual-grid-span2">
          <label className="visual-label">includes</label>
          <div className="visual-tags">
            {tags.length === 0 && <span className="visual-muted visual-tags-empty">暂未选择任何成员</span>}
            {tags.map((tag) => {
              const cat = categorize(tag);
              return (
                <span key={tag} className={`visual-tag visual-tag--${cat}`}>
                  <span className="visual-tag-icon" aria-hidden>
                    {cat === 'dimension' ? 'D' : cat === 'measure' ? 'M' : '?'}
                  </span>
                  <span className="visual-tag-text">{tag}</span>
                  <button
                    type="button"
                    className="visual-tag-remove"
                    onClick={() => removeTag(tag)}
                    aria-label={`移除 ${tag}`}
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
          <div className="visual-tag-add">
            <input
              className="visual-input visual-input--compact"
              list={datalistId}
              placeholder={
                resolvedCubeName
                  ? `从 ${resolvedCubeName} 的维度/指标中选择，或输入后回车`
                  : '填写 join_path 后可从候选项选择，或输入后回车'
              }
              value={pendingTag}
              onChange={(e) => setPendingTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTag(pendingTag);
                  setPendingTag('');
                }
              }}
            />
            <button
              type="button"
              className="visual-btn-subtle"
              onClick={() => {
                addTag(pendingTag);
                setPendingTag('');
              }}
              disabled={!pendingTag.trim()}
            >
              添加
            </button>
            <datalist id={datalistId}>
              {availableDims.map((n) => (
                <option key={`d-${n}`} value={n}>
                  dimension
                </option>
              ))}
              {availableMeasures.map((n) => (
                <option key={`m-${n}`} value={n}>
                  measure
                </option>
              ))}
            </datalist>
          </div>
          {resolvedCubeName && (availableDims.length > 0 || availableMeasures.length > 0) && (
            <div className="visual-tag-quick">
              <button
                type="button"
                className="visual-btn-subtle"
                onClick={() => addAll(members.dimensions)}
                disabled={availableDims.length === 0}
              >
                加入全部维度（{members.dimensions.length}）
              </button>
              <button
                type="button"
                className="visual-btn-subtle"
                onClick={() => addAll(members.measures)}
                disabled={availableMeasures.length === 0}
              >
                加入全部指标（{members.measures.length}）
              </button>
            </div>
          )}
        </div>
      </div>
      </div>
      )}
    </div>
  );
}
