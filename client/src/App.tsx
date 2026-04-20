import { useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import YAML from 'yaml';
import * as api from './api';
import type {
  CatalogResponse,
  CubeCatalogEntry,
  FileInfo,
  TableCatalogEntry,
  ViewCatalogEntry,
} from './api';
import { VisualCubeEditor } from './components/VisualCubeEditor';
import { VisualTableEditor } from './components/VisualTableEditor';
import { VisualViewEditor } from './components/VisualViewEditor';
import { CatalogPage, type CatalogSection } from './components/CatalogPage';
import {
  downloadTextFile,
  extractCubesFromText,
  extractTablesFromText,
  extractViewsFromText,
  parseCubeFile,
  parseTableFile,
  parseViewFile,
  pickYamlFile,
  sanitizeFilename,
  stringifyDoc,
} from './modelYaml';
import { applyTableFormToContent, tableToFormState } from './visualModel/tableForm';
import './visual-editor.css';

function yamlPreviewFromSource(source: string): { ok: true; text: string } | { ok: false; message: string } {
  try {
    const doc = YAML.parse(source);
    const text = YAML.stringify(doc, {
      indent: 2,
      lineWidth: 0,
    });
    return { ok: true, text };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, message };
  }
}

type ViewMode = 'catalog' | 'detail';

function App() {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hotReloadEvent, setHotReloadEvent] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<'source' | 'visual'>('source');
  const [cubeIndex, setCubeIndex] = useState(0);
  const [viewIndex, setViewIndex] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState<number>(220);
  const [editorLeftPct, setEditorLeftPct] = useState<number>(50);
  const [isResizing, setIsResizing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('catalog');
  const [section, setSection] = useState<CatalogSection>('cube');
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [syncingTables, setSyncingTables] = useState(false);
  const [savingTablePath, setSavingTablePath] = useState<string | null>(null);
  const [previewCollapsed, setPreviewCollapsed] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const hotReloadTimerRef = useRef<number | null>(null);
  const editorSplitRef = useRef<HTMLDivElement>(null);

  const startSidebarDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const onMove = (ev: PointerEvent) => {
      const w = Math.max(180, Math.min(400, startWidth + ev.clientX - startX));
      setSidebarWidth(w);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setIsResizing(false);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    setIsResizing(true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startEditorSplitDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = editorSplitRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const min = 240;
    const onMove = (ev: PointerEvent) => {
      const x = Math.max(min, Math.min(rect.width - min, ev.clientX - rect.left));
      setEditorLeftPct((x / rect.width) * 100);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setIsResizing(false);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    setIsResizing(true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const activeFile = useMemo(
    () => files.find((f) => f.path === activePath),
    [files, activePath]
  );

  const effectiveFileType: FileInfo['type'] = useMemo(() => {
    if (activeFile?.type) return activeFile.type;
    const p = activePath?.replace(/\\/g, '/') ?? '';
    if (p.includes('/cubes/') || p.startsWith('cubes/')) return 'cube';
    if (p.includes('/views/') || p.startsWith('views/')) return 'view';
    if (p.includes('/tables/') || p.startsWith('tables/')) return 'table';
    return 'unknown';
  }, [activeFile?.type, activePath]);

  const showYamlPreview =
    effectiveFileType === 'cube' || effectiveFileType === 'view' || effectiveFileType === 'table';

  const yamlPreview = useMemo(() => yamlPreviewFromSource(content), [content]);

  const isUnsaved = content !== originalContent;

  const refreshFiles = async () => {
    try {
      const list = await api.listFiles();
      setFiles(list);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const refreshCatalog = async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const data = await api.listCatalog();
      setCatalog(data);
    } catch (e: any) {
      setCatalogError(e.message);
    } finally {
      setCatalogLoading(false);
    }
  };

  const activePathRef = useRef<string | null>(null);
  activePathRef.current = activePath;
  const refreshCatalogRef = useRef(refreshCatalog);
  refreshCatalogRef.current = refreshCatalog;
  const refreshFilesRef = useRef(refreshFiles);
  refreshFilesRef.current = refreshFiles;

  const syncTablesFromStarRocks = async () => {
    if (syncingTables) return;
    setSyncingTables(true);
    setError(null);
    try {
      const result = await api.syncStarRocksTables();
      await refreshFiles();
      await refreshCatalog();
      const addedCount = result.added.length;
      const skippedCount = result.skipped.length;
      const lines = [
        `同步完成（数据库：${result.database || '—'}，共 ${result.total} 张表）`,
        `新增 ${addedCount} 张：${
          addedCount ? result.added.map((a) => a.name).join(', ') : '—'
        }`,
        `跳过 ${skippedCount} 张${
          skippedCount ? `：\n${result.skipped.map((s) => `  · ${s.name}（${s.reason}）`).join('\n')}` : ''
        }`,
      ];
      alert(lines.join('\n'));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSyncingTables(false);
    }
  };

  useEffect(() => {
    refreshFiles();
    refreshCatalog();
  }, []);

  const goToCatalog = () => {
    if (isUnsaved) {
      const ok = confirm('当前文件未保存，切换将丢失修改，确认继续？');
      if (!ok) return;
    }
    setViewMode('catalog');
    setActivePath(null);
    setContent('');
    setOriginalContent('');
    refreshCatalog();
  };

  const openFile = async (path: string, opts?: { cubeIndex?: number; viewIndex?: number }) => {
    if (isUnsaved) {
      const ok = confirm('当前文件未保存，切换将丢失修改，确认继续？');
      if (!ok) return;
    }
    setLoading(true);
    try {
      const data = await api.readFile(path);
      setActivePath(path);
      setContent(data.content);
      setOriginalContent(data.content);
      const fileMeta = files.find((f) => f.path === path);
      const p = path.replace(/\\/g, '/');
      const isStructured =
        fileMeta?.type === 'cube' ||
        fileMeta?.type === 'view' ||
        fileMeta?.type === 'table' ||
        p.includes('/cubes/') ||
        p.startsWith('cubes/') ||
        p.includes('/views/') ||
        p.startsWith('views/') ||
        p.includes('/tables/') ||
        p.startsWith('tables/');
      setEditMode(isStructured ? 'visual' : 'source');
      setCubeIndex(opts?.cubeIndex ?? 0);
      setViewIndex(opts?.viewIndex ?? 0);
      setViewMode('detail');
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCube = (entry: CubeCatalogEntry) => {
    setSection('cube');
    openFile(entry.path, { cubeIndex: entry.index });
  };
  const handleOpenView = (entry: ViewCatalogEntry) => {
    setSection('view');
    openFile(entry.path, { viewIndex: entry.index });
  };
  const handleOpenTable = (entry: TableCatalogEntry) => {
    setSection('table');
    openFile(entry.path);
  };

  const handleSaveTableMeta = async (
    entry: TableCatalogEntry,
    next: { title: string; description: string }
  ) => {
    setSavingTablePath(entry.path);
    setError(null);
    try {
      const { content: yamlText } = await api.readFile(entry.path);
      const parsed = parseTableFile(yamlText);
      if (!parsed.ok) throw new Error(parsed.error);
      const form = tableToFormState(parsed.table);
      const result = applyTableFormToContent(yamlText, {
        ...form,
        title: next.title,
        description: next.description,
      });
      if (!result.ok) throw new Error(result.error);
      await api.writeFile(entry.path, result.yaml);
      if (activePath === entry.path) {
        setContent(result.yaml);
        setOriginalContent(result.yaml);
      }
      await refreshCatalog();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setSavingTablePath(null);
    }
  };

  const saveFile = async () => {
    if (!activePath) return;
    setLoading(true);
    try {
      await api.writeFile(activePath, content);
      setOriginalContent(content);
      setError(null);
      refreshCatalog();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const exportCurrent = () => {
    if (effectiveFileType === 'cube') {
      const parsed = parseCubeFile(content);
      if (!parsed.ok) {
        setError(`导出失败：${parsed.error}`);
        return;
      }
      if (parsed.cubes.length === 0) {
        setError('当前文件中没有 cube 定义');
        return;
      }
      const idx = Math.min(Math.max(0, cubeIndex), parsed.cubes.length - 1);
      const cube = parsed.cubes[idx];
      const name = typeof cube.name === 'string' && cube.name ? cube.name : `cube_${idx + 1}`;
      downloadTextFile(`${sanitizeFilename(name, 'cube')}.yml`, stringifyDoc({ cubes: [cube] }));
      return;
    }
    if (effectiveFileType === 'view') {
      const parsed = parseViewFile(content);
      if (!parsed.ok) {
        setError(`导出失败：${parsed.error}`);
        return;
      }
      if (parsed.views.length === 0) {
        setError('当前文件中没有 view 定义');
        return;
      }
      const idx = Math.min(Math.max(0, viewIndex), parsed.views.length - 1);
      const view = parsed.views[idx];
      const name = typeof view.name === 'string' && view.name ? view.name : `view_${idx + 1}`;
      downloadTextFile(`${sanitizeFilename(name, 'view')}.yml`, stringifyDoc({ views: [view] }));
      return;
    }
    if (effectiveFileType === 'table') {
      const parsed = parseTableFile(content);
      if (!parsed.ok) {
        setError(`导出失败：${parsed.error}`);
        return;
      }
      const table = parsed.table;
      const name = typeof table.name === 'string' && table.name ? table.name : 'table';
      downloadTextFile(`${sanitizeFilename(name, 'table')}.yml`, stringifyDoc({ table }));
      return;
    }
    if (!activePath) return;
    const fallbackName = (activePath.split('/').pop() || 'file').replace(/\.(ya?ml)$/i, '');
    downloadTextFile(`${sanitizeFilename(fallbackName, 'file')}.yml`, content);
  };

  const deleteActiveFile = async () => {
    if (!activePath) return;
    const ok = confirm(`确认删除 ${activePath} 吗？`);
    if (!ok) return;
    try {
      await api.deleteFile(activePath);
      setActivePath(null);
      setContent('');
      setOriginalContent('');
      await refreshFiles();
      await refreshCatalog();
      setViewMode('catalog');
    } catch (e: any) {
      setError(e.message);
    }
  };

  const createFile = () => {
    const defaultDir =
      section === 'cube' ? 'cubes/' : section === 'view' ? 'views/' : section === 'table' ? 'tables/' : '';
    const name = prompt(
      '请输入文件名（如 cubes/orders.yml、tables/orders_raw.yml）：',
      defaultDir
    );
    if (!name) return;
    const path = name.endsWith('.yml') || name.endsWith('.yaml') ? name : `${name}.yml`;
    setActivePath(path);
    const p = path.replace(/\\/g, '/');
    let defaultContent: string;
    if (p.startsWith('tables/') || p.includes('/tables/') || p.includes('table')) {
      defaultContent = `table:\n  name: \n  fields: []\n`;
    } else if (p.startsWith('views/') || p.includes('/views/') || p.includes('view')) {
      defaultContent = `views:\n  - name: \n`;
    } else {
      defaultContent = `cubes:\n  - name: \n`;
    }
    setContent(defaultContent);
    setOriginalContent('');
    const isStructured =
      p.includes('cubes/') ||
      p.includes('views/') ||
      p.includes('tables/') ||
      p.includes('view') ||
      p.includes('cube') ||
      p.includes('table');
    setEditMode(isStructured ? 'visual' : 'source');
    setCubeIndex(0);
    setViewIndex(0);
    setViewMode('detail');
  };

  const importFile = async () => {
    if (isUnsaved) {
      const ok = confirm('当前文件未保存，切换将丢失修改，确认继续？');
      if (!ok) return;
    }
    const picked = await pickYamlFile();
    if (!picked) return;

    const asCube = extractCubesFromText(picked.text);
    const asView = extractViewsFromText(picked.text);
    const asTable = extractTablesFromText(picked.text);
    const hasCube = asCube.ok && asCube.cubes.length > 0;
    const hasView = asView.ok && asView.views.length > 0;
    const hasTable = asTable.ok && asTable.tables.length > 0;
    let kind: 'cube' | 'view' | 'table' | 'unknown' = 'unknown';
    const kinds = [hasCube ? 'cube' : null, hasView ? 'view' : null, hasTable ? 'table' : null].filter(
      Boolean
    ) as ('cube' | 'view' | 'table')[];
    if (kinds.length === 1) {
      kind = kinds[0];
    } else if (kinds.length > 1) {
      const ans = prompt(
        `文件同时包含多种模型：${kinds.join(', ')}。请输入要导入的类型（cube/view/table）：`,
        kinds[0]
      );
      const normalized = (ans || '').trim().toLowerCase();
      if (normalized === 'cube' || normalized === 'view' || normalized === 'table') {
        kind = normalized;
      } else {
        kind = kinds[0];
      }
    }

    const baseName = picked.name.replace(/\.(ya?ml)$/i, '');
    const safeBase = sanitizeFilename(baseName, kind === 'unknown' ? 'file' : kind);
    const prefix =
      kind === 'view'
        ? 'views/'
        : kind === 'cube'
        ? 'cubes/'
        : kind === 'table'
        ? 'tables/'
        : '';
    const defaultPath = `${prefix}${safeBase}.yml`;

    const destInput = prompt('导入到项目的哪个路径？', defaultPath);
    if (!destInput) return;
    const destPath = destInput.endsWith('.yml') || destInput.endsWith('.yaml') ? destInput : `${destInput}.yml`;

    const exists = files.some((f) => f.path === destPath);
    if (exists) {
      const ok = confirm(`${destPath} 已存在，覆盖？`);
      if (!ok) return;
    }

    setLoading(true);
    try {
      await api.writeFile(destPath, picked.text);
      await refreshFiles();
      await refreshCatalog();
      setActivePath(destPath);
      setContent(picked.text);
      setOriginalContent(picked.text);
      const p = destPath.replace(/\\/g, '/');
      const isStructured =
        kind === 'cube' ||
        kind === 'view' ||
        kind === 'table' ||
        p.includes('/cubes/') ||
        p.startsWith('cubes/') ||
        p.includes('/views/') ||
        p.startsWith('views/') ||
        p.includes('/tables/') ||
        p.startsWith('tables/');
      setEditMode(isStructured ? 'visual' : 'source');
      setCubeIndex(0);
      setViewIndex(0);
      setViewMode('detail');
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let socket: WebSocket | null = null;

    const connect = () => {
      if (cancelled) return;
      const wsUrl =
        (window.location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + window.location.host + '/ws';
      socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        if (msg.event === 'file:changed' && msg.path === activePathRef.current) {
          setHotReloadEvent('文件在外部被修改，已热更新');
          try {
            const data = await api.readFile(msg.path);
            setContent(data.content);
            setOriginalContent(data.content);
          } catch (e: any) {
            setError(e.message);
          }
          if (hotReloadTimerRef.current) window.clearTimeout(hotReloadTimerRef.current);
          hotReloadTimerRef.current = window.setTimeout(() => setHotReloadEvent(null), 3000);
        }
        if (msg.event === 'file:changed' || msg.event === 'file:added' || msg.event === 'file:deleted') {
          void refreshCatalogRef.current();
        }
        if (msg.event === 'file:added' || msg.event === 'file:deleted') {
          await refreshFilesRef.current();
        }
      };

      socket.onerror = () => {
        /* 后端未启动或短暂断线时不打扰用户；热更新为附加能力 */
      };

      socket.onclose = () => {
        wsRef.current = null;
        if (cancelled) return;
        reconnectTimer = window.setTimeout(connect, 4000);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socket?.close();
      wsRef.current = null;
    };
  }, []);

  const cubeCount = catalog?.cubes.length ?? 0;
  const viewCount = catalog?.views.length ?? 0;
  const tableCount = catalog?.tables.length ?? 0;

  /** 列表页按 section；详情页按当前文件类型，避免打开条目后左栏分类失去高亮 */
  const sidebarCubeActive =
    (viewMode === 'catalog' && section === 'cube') ||
    (viewMode === 'detail' && effectiveFileType === 'cube');
  const sidebarViewActive =
    (viewMode === 'catalog' && section === 'view') ||
    (viewMode === 'detail' && effectiveFileType === 'view');
  const sidebarTableActive =
    (viewMode === 'catalog' && section === 'table') ||
    (viewMode === 'detail' && effectiveFileType === 'table');

  const handleSelectSection = (s: CatalogSection) => {
    setSection(s);
    if (viewMode !== 'catalog') {
      if (isUnsaved) {
        const ok = confirm('当前文件未保存，切换将丢失修改，确认继续？');
        if (!ok) return;
      }
      setViewMode('catalog');
      setActivePath(null);
      setContent('');
      setOriginalContent('');
    }
  };

  return (
    <div className="app">
      <aside className="sidebar" style={{ width: sidebarWidth, minWidth: sidebarWidth, maxWidth: sidebarWidth }}>
        <div className="sidebar-header">
          <h1>Cube Core IDE</h1>
          <div className="dir">{import.meta.env.VITE_CUBE_DIR || 'demo-models'}</div>
          <div className="sidebar-actions">
            <button className="create-btn" onClick={createFile}>+ 新建文件</button>
            <button className="create-btn create-btn--secondary" onClick={importFile} title="从本地 YAML 文件导入为新的 cube/view 文件">
              导入…
            </button>
          </div>
        </div>
        <nav className="sidebar-nav" aria-label="模型分类">
          <button
            type="button"
            className={`sidebar-nav-item ${sidebarCubeActive ? 'active' : ''}`}
            onClick={() => handleSelectSection('cube')}
          >
            <span className="sidebar-nav-icon">🧊</span>
            <span className="sidebar-nav-label">Cubes</span>
            <span className="sidebar-nav-count">{cubeCount}</span>
          </button>
          <button
            type="button"
            className={`sidebar-nav-item ${sidebarViewActive ? 'active' : ''}`}
            onClick={() => handleSelectSection('view')}
          >
            <span className="sidebar-nav-icon">👁</span>
            <span className="sidebar-nav-label">Views</span>
            <span className="sidebar-nav-count">{viewCount}</span>
          </button>
          <button
            type="button"
            className={`sidebar-nav-item ${sidebarTableActive ? 'active' : ''}`}
            onClick={() => handleSelectSection('table')}
          >
            <span className="sidebar-nav-icon">🗄</span>
            <span className="sidebar-nav-label">Tables</span>
            <span className="sidebar-nav-count">{tableCount}</span>
          </button>
        </nav>
        {viewMode === 'detail' && activePath && (
          <div className="sidebar-current">
            <div className="sidebar-current-title">当前编辑</div>
            <div className="sidebar-current-path" title={activePath}>
              {activePath}
            </div>
          </div>
        )}
      </aside>

      <div
        className={`resizer resizer--v ${isResizing ? 'is-active' : ''}`}
        onPointerDown={startSidebarDrag}
        role="separator"
        aria-orientation="vertical"
        aria-label="拖拽以调整侧边栏宽度"
      />

      <main className="main">
        {viewMode === 'catalog' ? (
          <CatalogPage
            catalog={catalog}
            loading={catalogLoading}
            error={catalogError}
            section={section}
            onSectionChange={setSection}
            onOpenCube={handleOpenCube}
            onOpenView={handleOpenView}
            onOpenTable={handleOpenTable}
            onRefresh={refreshCatalog}
            onSyncTables={syncTablesFromStarRocks}
            syncing={syncingTables}
            onSaveTableMeta={handleSaveTableMeta}
            savingTablePath={savingTablePath}
          />
        ) : activePath ? (
          <>
            <div className="toolbar">
              <div className="toolbar-left">
                <button
                  type="button"
                  className="back-btn"
                  onClick={goToCatalog}
                  title="返回列表"
                >
                  ← 列表
                </button>
                <span className="filename">{activeFile?.name || activePath}</span>
                <span className={`status ${isUnsaved ? 'unsaved' : ''}`}>
                  {isUnsaved ? '未保存' : '已保存'}
                </span>
                {hotReloadEvent && <span className="hot-reload-badge">{hotReloadEvent}</span>}
              </div>
              <div className="toolbar-right">
                {showYamlPreview && (
                  <div className="edit-mode-tabs" role="tablist" aria-label="编辑方式">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={editMode === 'source'}
                      className={`edit-mode-tab ${editMode === 'source' ? 'active' : ''}`}
                      onClick={() => setEditMode('source')}
                    >
                      源码
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={editMode === 'visual'}
                      className={`edit-mode-tab ${editMode === 'visual' ? 'active' : ''}`}
                      onClick={() => setEditMode('visual')}
                    >
                      可视化
                    </button>
                  </div>
                )}
                <button onClick={deleteActiveFile} disabled={loading}>删除</button>
                <button
                  onClick={exportCurrent}
                  disabled={loading || !content}
                  title={
                    showYamlPreview
                      ? `将当前 ${effectiveFileType} 导出为单独的 YAML 文件`
                      : '将当前文件导出到本地'
                  }
                >
                  导出{showYamlPreview ? '当前' : ''}
                </button>
                <button className="primary" onClick={saveFile} disabled={loading || !isUnsaved}>
                  保存
                </button>
              </div>
            </div>
            <div className={`editor-container ${showYamlPreview ? 'editor-container--split' : ''}`}>
              {showYamlPreview ? (
                <div className="editor-split" ref={editorSplitRef}>
                  <div
                    className={`editor-pane ${editMode === 'visual' ? 'editor-pane--visual' : 'editor-pane--source'}`}
                    style={
                      previewCollapsed
                        ? { flex: '1 1 auto' }
                        : { flex: `0 0 ${editorLeftPct}%` }
                    }
                  >
                    <div className="pane-header">{editMode === 'visual' ? '可视化' : '源码'}</div>
                    <div className={editMode === 'visual' ? 'pane-body pane-body--scroll' : 'pane-body'}>
                      {editMode === 'visual' ? (
                        <>
                          {effectiveFileType === 'cube' && (
                            <VisualCubeEditor
                              content={content}
                              cubeIndex={cubeIndex}
                              onCubeIndexChange={setCubeIndex}
                              onChange={setContent}
                              activePath={activePath}
                            />
                          )}
                          {effectiveFileType === 'view' && (
                            <VisualViewEditor
                              content={content}
                              viewIndex={viewIndex}
                              onViewIndexChange={setViewIndex}
                              onChange={setContent}
                              activePath={activePath}
                            />
                          )}
                          {effectiveFileType === 'table' && (
                            <VisualTableEditor
                              content={content}
                              onChange={setContent}
                              activePath={activePath}
                            />
                          )}
                        </>
                      ) : (
                        <Editor
                          height="100%"
                          defaultLanguage="yaml"
                          value={content}
                          onChange={(v) => setContent(v || '')}
                          theme="vs"
                          options={{
                            minimap: { enabled: false },
                            fontSize: 13,
                            wordWrap: 'on',
                            automaticLayout: true,
                          }}
                        />
                      )}
                    </div>
                  </div>
                  {previewCollapsed ? (
                    <button
                      type="button"
                      className="preview-collapse-rail"
                      onClick={() => setPreviewCollapsed(false)}
                      title="展开 YAML 预览"
                      aria-label="展开 YAML 预览"
                    >
                      <span className="preview-collapse-rail-icon" aria-hidden>
                        ◀
                      </span>
                      <span className="preview-collapse-rail-label">预览 YAML</span>
                    </button>
                  ) : (
                    <>
                      <div
                        className={`resizer resizer--v ${isResizing ? 'is-active' : ''}`}
                        onPointerDown={startEditorSplitDrag}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="拖拽以调整预览宽度"
                      />
                      <div className="editor-pane editor-pane--preview">
                        <div className="pane-header pane-header--with-action">
                          <span>预览 YAML</span>
                          <button
                            type="button"
                            className="preview-collapse-btn"
                            onClick={() => setPreviewCollapsed(true)}
                            title="收起预览"
                            aria-label="收起预览"
                          >
                            ▶
                          </button>
                        </div>
                        <div className="pane-body">
                          {yamlPreview.ok ? (
                            <Editor
                              height="100%"
                              defaultLanguage="yaml"
                              value={yamlPreview.text}
                              theme="vs"
                              options={{
                                readOnly: true,
                                domReadOnly: true,
                                minimap: { enabled: false },
                                fontSize: 13,
                                wordWrap: 'on',
                                automaticLayout: true,
                                scrollBeyondLastLine: false,
                              }}
                            />
                          ) : (
                            <div className="preview-yaml-error">
                              <div className="preview-yaml-error-title">无法生成预览</div>
                              <pre className="preview-yaml-error-msg">{yamlPreview.message}</pre>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <Editor
                  height="100%"
                  defaultLanguage="yaml"
                  value={content}
                  onChange={(v) => setContent(v || '')}
                  theme="vs"
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    wordWrap: 'on',
                    automaticLayout: true,
                  }}
                />
              )}
            </div>
          </>
        ) : (
          <div className="empty-state">请选择左侧分类查看列表</div>
        )}
      </main>

      {error && (
        <div className="error-toast" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </div>
  );
}

export default App;
