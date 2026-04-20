import { useMemo, useState } from 'react';
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
};

function matches(entry: { name: string; title: string; description: string; path: string }, q: string) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    entry.name.toLowerCase().includes(needle) ||
    entry.title.toLowerCase().includes(needle) ||
    entry.description.toLowerCase().includes(needle) ||
    entry.path.toLowerCase().includes(needle)
  );
}

function dash(v: string) {
  return v && v.trim() ? v : '—';
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
    <div className="catalog-table-wrapper">
      <table className="catalog-table">
        <thead>
          <tr>
            <th style={{ width: '18%' }}>Name</th>
            <th style={{ width: '18%' }}>Title</th>
            <th>Description</th>
            <th style={{ width: '18%' }}>SQL Table</th>
            <th style={{ width: '18%' }}>File</th>
          </tr>
        </thead>
        <tbody>
          {filteredCubes.map((c) => (
            <tr
              key={`${c.path}#${c.index}`}
              className="catalog-row"
              onClick={() => onOpenCube(c)}
              title="点击查看详情"
            >
              <td>
                <span className="catalog-name">
                  <span className="catalog-icon">🧊</span>
                  {dash(c.name)}
                </span>
              </td>
              <td>{dash(c.title)}</td>
              <td className="catalog-desc">{dash(c.description)}</td>
              <td className="mono">{dash(c.sql_table || c.extends)}</td>
              <td className="mono catalog-path">{c.path}</td>
            </tr>
          ))}
          {filteredCubes.length === 0 && (
            <tr>
              <td colSpan={5} className="catalog-empty">
                {cubes.length === 0 ? '当前目录下没有 cube' : '没有匹配的 cube'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const renderViews = () => (
    <div className="catalog-table-wrapper">
      <table className="catalog-table">
        <thead>
          <tr>
            <th style={{ width: '18%' }}>Name</th>
            <th style={{ width: '18%' }}>Title</th>
            <th>Description</th>
            <th style={{ width: '20%' }}>Cubes</th>
            <th style={{ width: '18%' }}>File</th>
          </tr>
        </thead>
        <tbody>
          {filteredViews.map((v) => (
            <tr
              key={`${v.path}#${v.index}`}
              className="catalog-row"
              onClick={() => onOpenView(v)}
              title="点击查看详情"
            >
              <td>
                <span className="catalog-name">
                  <span className="catalog-icon">👁</span>
                  {dash(v.name)}
                </span>
              </td>
              <td>{dash(v.title)}</td>
              <td className="catalog-desc">{dash(v.description)}</td>
              <td className="catalog-tags">
                {v.cubes.length === 0 ? (
                  <span className="catalog-dim">—</span>
                ) : (
                  v.cubes.map((n) => (
                    <span key={n} className="catalog-tag">
                      {n}
                    </span>
                  ))
                )}
              </td>
              <td className="mono catalog-path">{v.path}</td>
            </tr>
          ))}
          {filteredViews.length === 0 && (
            <tr>
              <td colSpan={5} className="catalog-empty">
                {views.length === 0 ? '当前目录下没有 view' : '没有匹配的 view'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const renderTables = () => (
    <div className="catalog-table-wrapper">
      <table className="catalog-table">
        <thead>
          <tr>
            <th style={{ width: '16%' }}>Name</th>
            <th style={{ width: '16%' }}>Title</th>
            <th>Description</th>
            <th style={{ width: '18%' }}>SQL Table</th>
            <th style={{ width: '8%' }}>Fields</th>
            <th style={{ width: '18%' }}>File</th>
          </tr>
        </thead>
        <tbody>
          {filteredTables.map((t) => (
            <tr
              key={`${t.path}#${t.name}`}
              className="catalog-row"
              onClick={() => onOpenTable(t)}
              title="点击查看详情"
            >
              <td>
                <span className="catalog-name">
                  <span className="catalog-icon">🗄</span>
                  {dash(t.name)}
                </span>
              </td>
              <td>{dash(t.title)}</td>
              <td className="catalog-desc">{dash(t.description)}</td>
              <td className="mono">{dash(t.sql_table)}</td>
              <td className="num">{t.fieldCount}</td>
              <td className="mono catalog-path">{t.path}</td>
            </tr>
          ))}
          {filteredTables.length === 0 && (
            <tr>
              <td colSpan={6} className="catalog-empty">
                {tables.length === 0 ? '当前目录下没有 table' : '没有匹配的 table'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
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
