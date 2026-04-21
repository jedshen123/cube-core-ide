import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import { ExpandableTextarea } from './ExpandableTextarea';
import { ResizableColumnTable } from './ResizableColumnTable';
import type {
  CatalogResponse,
  CubeCatalogEntry,
  TableCatalogEntry,
  ViewCatalogEntry,
} from '../api';

export type CatalogSection = 'cube' | 'view' | 'table';

type Props = {
  catalog: CatalogResponse | null;
  loading: boolean;
  error: string | null;
  section: CatalogSection;
  onSectionChange: (s: CatalogSection) => void;
  onOpenCube: (entry: CubeCatalogEntry) => void;
  onOpenView: (entry: ViewCatalogEntry) => void;
  onOpenTable: (entry: TableCatalogEntry) => void;
  onRefresh: () => void;
  onSyncTables?: () => void;
  syncing?: boolean;
  /** Tables 列表内联保存 title / description（血缘仅在详情中编辑） */
  onSaveTableMeta?: (entry: TableCatalogEntry, next: { title: string; description: string }) => Promise<void>;
  savingTablePath?: string | null;
};

function matches(
  entry: { name: string; title: string; description: string; path: string; lineage?: string },
  q: string
) {
  if (!q) return true;
  const needle = q.toLowerCase();
  const lineage = (entry.lineage ?? '').toLowerCase();
  return (
    entry.name.toLowerCase().includes(needle) ||
    entry.title.toLowerCase().includes(needle) ||
    entry.description.toLowerCase().includes(needle) ||
    lineage.includes(needle) ||
    entry.path.toLowerCase().includes(needle)
  );
}

function dash(v: string) {
  return v && v.trim() ? v : '—';
}

function stopRowNav(e: SyntheticEvent) {
  e.stopPropagation();
}

function CatalogTableRow({
  index,
  entry,
  disabled,
  onOpen,
  onSave,
}: {
  index: number;
  entry: TableCatalogEntry;
  disabled: boolean;
  onOpen: () => void;
  onSave: (next: { title: string; description: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState(entry.title);
  const [description, setDescription] = useState(entry.description);

  useEffect(() => {
    setTitle(entry.title);
    setDescription(entry.description);
  }, [entry.path, entry.title, entry.description]);

  const commitIfChanged = async () => {
    if (disabled) return;
    if (title === entry.title && description === entry.description) return;
    await onSave({ title, description });
  };

  return (
    <tr
      className="catalog-row catalog-row--table"
      onClick={onOpen}
      title="点击查看详情；标题与描述可悬停编辑"
    >
      <td className="catalog-td-index num">{index}</td>
      <td className="catalog-td-table-name catalog-td-name-en">
        <span className="catalog-name">
          <span className="catalog-icon">🗄</span>
          {dash(entry.name)}
        </span>
      </td>
      <td className="catalog-td-edit" onClick={stopRowNav} onPointerDown={stopRowNav}>
        <input
          type="text"
          className="catalog-inline-input"
          value={title}
          disabled={disabled}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => void commitIfChanged()}
        />
      </td>
      <td className="catalog-desc catalog-td-edit" onClick={stopRowNav} onPointerDown={stopRowNav}>
        <ExpandableTextarea
          className="visual-input visual-input--mono visual-input--sql catalog-table-desc-sql"
          value={description}
          disabled={disabled}
          minRowsFocused={4}
          spellCheck
          onChange={(v) => setDescription(v)}
          onBlur={() => void commitIfChanged()}
        />
      </td>
      <td className="num catalog-td-fields">{entry.fieldCount}</td>
    </tr>
  );
}

export function CatalogPage({
  catalog,
  loading,
  error,
  section,
  onSectionChange,
  onOpenCube,
  onOpenView,
  onOpenTable,
  onRefresh,
  onSyncTables,
  syncing = false,
  onSaveTableMeta,
  savingTablePath = null,
}: Props) {
  const [query, setQuery] = useState('');

  const cubes = catalog?.cubes ?? [];
  const views = catalog?.views ?? [];
  const tables = catalog?.tables ?? [];

  const filteredCubes = useMemo(() => cubes.filter((c) => matches(c, query)), [cubes, query]);
  const filteredViews = useMemo(() => views.filter((v) => matches(v, query)), [views, query]);
  const filteredTables = useMemo(() => tables.filter((t) => matches(t, query)), [tables, query]);

  const counts = {
    cube: cubes.length,
    view: views.length,
    table: tables.length,
  } as const;

  const renderCubes = () => (
    <ResizableColumnTable
      storageKey="cube-core-ide.catalog.cubes.v1"
      columns={[
        { id: 'idx', header: '序号', thClassName: 'catalog-th-index' },
        { id: 'name', header: 'Name' },
        { id: 'title', header: 'Title' },
        { id: 'desc', header: 'Description' },
      ]}
      defaultPercents={[6, 24, 22, 48]}
      minPercents={[4, 12, 10, 15]}
    >
      <tbody>
        {filteredCubes.map((c, displayIndex) => (
          <tr
            key={`${c.path}#${c.index}`}
            className="catalog-row"
            onClick={() => onOpenCube(c)}
            title="点击查看详情"
          >
            <td className="catalog-td-index num">{displayIndex + 1}</td>
            <td className="catalog-td-name-en">
              <span className="catalog-name">
                <span className="catalog-icon">🧊</span>
                {dash(c.name)}
              </span>
            </td>
            <td>{dash(c.title)}</td>
            <td
              className="catalog-desc"
              title={c.description?.trim() ? c.description : undefined}
            >
              <span className="catalog-desc-inner">{dash(c.description)}</span>
            </td>
          </tr>
        ))}
        {filteredCubes.length === 0 && (
          <tr>
            <td colSpan={4} className="catalog-empty">
              {cubes.length === 0 ? '当前目录下没有 cube' : '没有匹配的 cube'}
            </td>
          </tr>
        )}
      </tbody>
    </ResizableColumnTable>
  );

  const renderViews = () => (
    <ResizableColumnTable
      storageKey="cube-core-ide.catalog.views.v1"
      columns={[
        { id: 'idx', header: '序号', thClassName: 'catalog-th-index' },
        { id: 'name', header: 'Name' },
        { id: 'title', header: 'Title' },
        { id: 'desc', header: 'Description' },
      ]}
      defaultPercents={[6, 24, 22, 48]}
      minPercents={[4, 12, 10, 15]}
    >
      <tbody>
        {filteredViews.map((v, displayIndex) => (
          <tr
            key={`${v.path}#${v.index}`}
            className="catalog-row"
            onClick={() => onOpenView(v)}
            title="点击查看详情"
          >
            <td className="catalog-td-index num">{displayIndex + 1}</td>
            <td className="catalog-td-name-en">
              <span className="catalog-name">
                <span className="catalog-icon">👁</span>
                {dash(v.name)}
              </span>
            </td>
            <td>{dash(v.title)}</td>
            <td
              className="catalog-desc"
              title={v.description?.trim() ? v.description : undefined}
            >
              <span className="catalog-desc-inner">{dash(v.description)}</span>
            </td>
          </tr>
        ))}
        {filteredViews.length === 0 && (
          <tr>
            <td colSpan={4} className="catalog-empty">
              {views.length === 0 ? '当前目录下没有 view' : '没有匹配的 view'}
            </td>
          </tr>
        )}
      </tbody>
    </ResizableColumnTable>
  );

  const renderTables = () => (
    <ResizableColumnTable
      storageKey="cube-core-ide.catalog.tables.v1"
      className="catalog-table--tables"
      columns={[
        { id: 'idx', header: '序号', thClassName: 'catalog-th-index' },
        { id: 'en', header: '表英文名' },
        { id: 'cn', header: '表中文名' },
        { id: 'desc', header: '描述' },
        { id: 'fields', header: '字段数' },
      ]}
      defaultPercents={[5, 32, 18, 35, 10]}
      minPercents={[4, 16, 10, 12, 5]}
    >
      <tbody>
        {filteredTables.map((t, displayIndex) => (
          <CatalogTableRow
            key={`${t.path}#${t.name}`}
            index={displayIndex + 1}
            entry={t}
            disabled={!onSaveTableMeta || savingTablePath === t.path}
            onOpen={() => onOpenTable(t)}
            onSave={
              onSaveTableMeta
                ? (next) => onSaveTableMeta(t, next)
                : async () => {}
            }
          />
        ))}
        {filteredTables.length === 0 && (
          <tr>
            <td colSpan={5} className="catalog-empty">
              {tables.length === 0 ? '当前目录下没有 table' : '没有匹配的 table'}
            </td>
          </tr>
        )}
      </tbody>
    </ResizableColumnTable>
  );

  return (
    <div className="catalog-page">
      <div className="catalog-header">
        <div className="catalog-tabs" role="tablist" aria-label="分类">
          <button
            type="button"
            role="tab"
            aria-selected={section === 'cube'}
            className={`catalog-tab ${section === 'cube' ? 'active' : ''}`}
            onClick={() => onSectionChange('cube')}
          >
            Cubes <span className="catalog-count">{counts.cube}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === 'view'}
            className={`catalog-tab ${section === 'view' ? 'active' : ''}`}
            onClick={() => onSectionChange('view')}
          >
            Views <span className="catalog-count">{counts.view}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === 'table'}
            className={`catalog-tab ${section === 'table' ? 'active' : ''}`}
            onClick={() => onSectionChange('table')}
          >
            Tables <span className="catalog-count">{counts.table}</span>
          </button>
        </div>
        <div className="catalog-header-right">
          <input
            className="catalog-search"
            placeholder="搜索 name / title / description / 文件路径…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {section === 'table' && onSyncTables && (
            <button
              type="button"
              className="catalog-sync"
              onClick={onSyncTables}
              disabled={syncing || loading}
              title="从 StarRocks 读取元信息，为尚未配置的表创建 YAML 文件"
            >
              {syncing ? '同步中…' : '同步数据'}
            </button>
          )}
          <button type="button" className="catalog-refresh" onClick={onRefresh} disabled={loading}>
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>
      </div>

      {error && <div className="catalog-error">{error}</div>}

      <div className="catalog-body">
        {section === 'cube' && renderCubes()}
        {section === 'view' && renderViews()}
        {section === 'table' && renderTables()}
      </div>

      {catalog && catalog.errors.length > 0 && (
        <div className="catalog-parse-errors">
          <div className="catalog-parse-errors-title">以下文件解析失败（已跳过）：</div>
          <ul>
            {catalog.errors.map((e) => (
              <li key={e.path}>
                <span className="mono">{e.path}</span>
                <span className="catalog-dim"> — {e.error}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
