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
  buildImportSplitWrites,
  collectCubeRecordsFromYamlRoot,
  collectTableRecordsFromYamlRoot,
  collectViewRecordsFromYamlRoot,
  downloadTextFile,
  extractStructuredModelName,
  parseCubeFile,
  parseTableFile,
  parseViewFile,
  pickYamlFile,
  sanitizeFilename,
  stringifyDoc,
  stringifyExportBundle,
  uniquePathsInOrder,
} from './modelYaml';
import { buildCubeYamlFromTableContent, findCubeMatchingTableEnglishName } from './visualModel/cubeFromTable';
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
  /** 新建未落盘：无路径，保存时按 YAML 中 name 写入 cubes|views|tables/&lt;name&gt;.yml */
  const [newDraft, setNewDraft] = useState<{ kind: CatalogSection } | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
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
    if (newDraft) {
      return newDraft.kind === 'cube' ? 'cube' : newDraft.kind === 'view' ? 'view' : 'table';
    }
    if (activeFile?.type) return activeFile.type;
    const p = activePath?.replace(/\\/g, '/') ?? '';
    if (p.includes('/cubes/') || p.startsWith('cubes/')) return 'cube';
    if (p.includes('/views/') || p.startsWith('views/')) return 'view';
    if (p.includes('/tables/') || p.startsWith('tables/')) return 'table';
    return 'unknown';
  }, [newDraft, activeFile?.type, activePath]);

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
    if (isUnsaved || newDraft) {
      const ok = confirm('当前文件未保存，切换将丢失修改，确认继续？');
      if (!ok) return;
    }
    setViewMode('catalog');
    setActivePath(null);
    setContent('');
    setOriginalContent('');
    setNewDraft(null);
    refreshCatalog();
  };

  const openFile = async (
    path: string,
    opts?: { cubeIndex?: number; viewIndex?: number; skipUnsavedCheck?: boolean }
  ) => {
    if (!opts?.skipUnsavedCheck && isUnsaved) {
      const ok = confirm('当前文件未保存，切换将丢失修改，确认继续？');
      if (!ok) return;
    }
    setLoading(true);
    try {
      const data = await api.readFile(path);
      setActivePath(path);
      setNewDraft(null);
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

  /** Table 详情：用当前 YAML 预填 Cube；若已有 Cube 的 sql_table/name 与表英文名一致则提示跳转 */
  const handleCreateCubeFromTable = () => {
    if (effectiveFileType !== 'table') return;
    if (isUnsaved) {
      const ok = confirm('当前 Table 未保存，将按编辑器中的内容检测并生成 Cube，是否继续？');
      if (!ok) return;
    }
    const built = buildCubeYamlFromTableContent(content);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    const existing =
      catalog?.cubes && catalog.cubes.length > 0
        ? findCubeMatchingTableEnglishName(built.tableEnName, catalog.cubes)
        : undefined;
    if (existing) {
      const ok = confirm(
        `已存在与该表关联的 Cube（name：${existing.name || '—'}，sql_table：${
          existing.sql_table || '—'
        }，文件：${existing.path}）。是否打开编辑该 Cube？`
      );
      if (ok) {
        setSection('cube');
        void openFile(existing.path, { cubeIndex: existing.index, skipUnsavedCheck: true });
      }
      return;
    }
    setSection('cube');
    setContent(built.yaml);
    setOriginalContent('');
    setActivePath(null);
    setNewDraft({ kind: 'cube' });
    setCubeIndex(0);
    setViewIndex(0);
    setEditMode('visual');
    setViewMode('detail');
    setError(null);
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
    setError(null);
    if (newDraft && !activePath) {
      const kind = newDraft.kind;
      const extracted = extractStructuredModelName(kind, content);
      if (!extracted.ok) {
        setError(extracted.error);
        return;
      }
      const nameNorm = extracted.name.trim();
      const folder = kind === 'cube' ? 'cubes' : kind === 'view' ? 'views' : 'tables';
      const stem = sanitizeFilename(nameNorm, kind);
      const targetPath = `${folder}/${stem}.yml`;
      const list =
        kind === 'cube' ? catalog?.cubes : kind === 'view' ? catalog?.views : catalog?.tables;
      const dupByName = list?.find((e) => e.name.trim() === nameNorm);
      const pathNorm = targetPath.replace(/\\/g, '/');
      const fileOnDisk = files.some((f) => f.path.replace(/\\/g, '/') === pathNorm);
      if (dupByName || fileOnDisk) {
        const label = kind === 'cube' ? 'Cube' : kind === 'view' ? 'View' : 'Table';
        const msg = dupByName
          ? `已存在名为「${nameNorm}」的${label}（${dupByName.path}），保存将覆盖该文件，是否继续？`
          : `文件 ${targetPath} 已存在，是否覆盖？`;
        if (!confirm(msg)) return;
      }
      setLoading(true);
      try {
        await api.writeFile(targetPath, content);
        setActivePath(targetPath);
        setNewDraft(null);
        setOriginalContent(content);
        await refreshFiles();
        await refreshCatalog();
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
      return;
    }
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
    if (newDraft) {
      const ok = confirm('放弃当前新建？未保存内容将丢失。');
      if (!ok) return;
      setViewMode('catalog');
      setActivePath(null);
      setContent('');
      setOriginalContent('');
      setNewDraft(null);
      refreshCatalog();
      return;
    }
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

  const startNewDraft = (kind: CatalogSection) => {
    const templates: Record<CatalogSection, string> = {
      cube: `cubes:\n  - name: \n`,
      view: `views:\n  - name: \n`,
      table: `table:\n  name: \n  fields: []\n`,
    };
    setSection(kind);
    setContent(templates[kind]);
    setOriginalContent('');
    setActivePath(null);
    setNewDraft({ kind });
    setEditMode('visual');
    setCubeIndex(0);
    setViewIndex(0);
    setViewMode('detail');
    setError(null);
  };

  const beginCreateFlow = () => {
    if (viewMode === 'detail') {
      if (isUnsaved || newDraft) {
        if (!confirm('当前有未保存内容，继续将丢失修改，是否继续？')) return;
      } else if (activePath) {
        if (!confirm('将关闭当前文件并开始新建，是否继续？')) return;
      }
    }
    setCreateModalOpen(true);
  };

  const chooseCreateKind = (kind: CatalogSection) => {
    setCreateModalOpen(false);
    startNewDraft(kind);
  };

  const importFile = async () => {
    if (isUnsaved || newDraft) {
      const ok = confirm('当前文件未保存，切换将丢失修改，确认继续？');
      if (!ok) return;
    }
    const picked = await pickYamlFile();
    if (!picked) return;

    const plan = buildImportSplitWrites(picked.text);
    if ('error' in plan) {
      setError(plan.error);
      return;
    }
    const writes = plan;
    const conflicts = writes.filter((w) => files.some((f) => f.path === w.path));
    const lines = writes.map((w) => `${w.path}（${w.kind}）`);
    const maxLines = 24;
    const listText =
      lines.length <= maxLines ? lines.join('\n') : `${lines.slice(0, maxLines).join('\n')}\n…共 ${lines.length} 个文件`;
    let msg = `从「${picked.name}」拆分写入 ${writes.length} 个文件（路径与文件名为各条目的 name，后缀 .yml）：\n\n${listText}`;
    if (conflicts.length > 0) {
      msg += `\n\n其中 ${conflicts.length} 个路径已存在，将被覆盖。`;
    }
    msg += `\n\n确定导入？`;
    if (!confirm(msg)) return;

    setLoading(true);
    try {
      for (const w of writes) {
        await api.writeFile(w.path, w.yaml);
      }
      await refreshFiles();
      await refreshCatalog();
      const first = writes[0];
      const { content: yaml } = await api.readFile(first.path);
      setActivePath(first.path);
      setNewDraft(null);
      setContent(yaml);
      setOriginalContent(yaml);
      const p = first.path.replace(/\\/g, '/');
      const isStructured =
        first.kind === 'cube' ||
        first.kind === 'view' ||
        first.kind === 'table' ||
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
      setSection(
        first.kind === 'cube' ? 'cube' : first.kind === 'view' ? 'view' : 'table'
      );
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const exportFullCatalogAsCubeYml = async () => {
    setError(null);
    setLoading(true);
    try {
      const cat = await api.listCatalog();
      const cubePaths = uniquePathsInOrder(cat.cubes);
      const viewPaths = uniquePathsInOrder(cat.views);
      const tablePaths = uniquePathsInOrder(cat.tables);

      const allCubes: Record<string, unknown>[] = [];
      for (const p of cubePaths) {
        try {
          const { content } = await api.readFile(p);
          const doc = YAML.parse(content) as Record<string, unknown> | null;
          if (doc && typeof doc === 'object') {
            allCubes.push(...collectCubeRecordsFromYamlRoot(doc));
          }
        } catch {
          /* 跳过无法解析的 cube 文件 */
        }
      }

      const allViews: Record<string, unknown>[] = [];
      for (const p of viewPaths) {
        try {
          const { content } = await api.readFile(p);
          const doc = YAML.parse(content) as Record<string, unknown> | null;
          if (doc && typeof doc === 'object') {
            allViews.push(...collectViewRecordsFromYamlRoot(doc));
          }
        } catch {
          /* 跳过无法解析的 view 文件 */
        }
      }

      const allTables: Record<string, unknown>[] = [];
      for (const p of tablePaths) {
        const { content } = await api.readFile(p);
        try {
          const doc = YAML.parse(content) as Record<string, unknown> | null;
          if (doc && typeof doc === 'object') {
            allTables.push(...collectTableRecordsFromYamlRoot(doc));
          }
        } catch {
          /* 跳过无法解析的表文件 */
        }
      }

      if (allCubes.length === 0 && allViews.length === 0 && allTables.length === 0) {
        alert('当前项目中没有可导出的 cube、view 或 table。');
        return;
      }

      downloadTextFile(
        'cube.yml',
        stringifyExportBundle({ cubes: allCubes, views: allViews, tables: allTables })
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
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
      if (isUnsaved || newDraft) {
        const ok = confirm('当前文件未保存，切换将丢失修改，确认继续？');
        if (!ok) return;
      }
      setViewMode('catalog');
      setActivePath(null);
      setContent('');
      setOriginalContent('');
      setNewDraft(null);
    }
  };

  return (
    <div className="app">
      <aside className="sidebar" style={{ width: sidebarWidth, minWidth: sidebarWidth, maxWidth: sidebarWidth }}>
        <div className="sidebar-header">
          <h1>Cube Core IDE</h1>
          <div className="dir">{import.meta.env.VITE_CUBE_DIR || 'demo-models'}</div>
          <div className="sidebar-actions">
            <button type="button" className="create-btn sidebar-btn-new" onClick={beginCreateFlow}>
              + 新建
            </button>
            <div className="sidebar-io">
              <button
                type="button"
                className="create-btn create-btn--secondary"
                onClick={importFile}
                disabled={loading}
                title="从本地 YAML 导入：可按 cubes/views/table(s) 拆成多个文件，写入 cubes/、views/、tables/，文件名取各条目的 name"
              >
                导入
              </button>
              <button
                type="button"
                className="create-btn create-btn--secondary"
                onClick={exportFullCatalogAsCubeYml}
                disabled={loading}
                title="导出当前项目中全部 cube、view、table 为一份 cube.yml，可用「导入」再拆分落盘"
              >
                导出
              </button>
            </div>
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
        {viewMode === 'detail' && (activePath || newDraft) && (
          <div className="sidebar-current">
            <div className="sidebar-current-title">当前编辑</div>
            <div
              className="sidebar-current-path"
              title={activePath || (newDraft ? '未保存的新建' : '')}
            >
              {newDraft
                ? `新建 ${
                    newDraft.kind === 'cube' ? 'Cube' : newDraft.kind === 'view' ? 'View' : 'Table'
                  }（保存至 ${
                    newDraft.kind === 'cube' ? 'cubes' : newDraft.kind === 'view' ? 'views' : 'tables'
                  } 目录，文件名为 YAML 中的 name）`
                : activePath}
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
        ) : activePath || newDraft ? (
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
                <span className="filename">
                  {newDraft
                    ? `新建 ${
                        newDraft.kind === 'cube' ? 'Cube' : newDraft.kind === 'view' ? 'View' : 'Table'
                      }`
                    : activeFile?.name || activePath}
                </span>
                <span className={`status ${isUnsaved ? 'unsaved' : ''}`}>
                  {isUnsaved ? '未保存' : '已保存'}
                </span>
                {hotReloadEvent && <span className="hot-reload-badge">{hotReloadEvent}</span>}
                {effectiveFileType === 'table' && (
                  <button
                    type="button"
                    className="toolbar-from-table-cube"
                    onClick={handleCreateCubeFromTable}
                    disabled={loading}
                    title="用当前表预填 Cube（英文名、中文名、描述与字段维度），进入 Cube 编辑"
                  >
                    创建 Cube
                  </button>
                )}
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

      {createModalOpen && (
        <div
          className="create-modal-overlay"
          onClick={() => setCreateModalOpen(false)}
          role="presentation"
        >
          <div
            className="create-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="create-modal-title" className="create-modal-title">
              新建类型
            </h2>
            <p className="create-modal-hint">选择后进入编辑页，填写 name 等信息后点击保存，将写入对应目录下以 name 命名的 yml 文件。</p>
            <div className="create-modal-actions">
              <button type="button" className="create-modal-choice" onClick={() => chooseCreateKind('cube')}>
                <span className="create-modal-choice-icon" aria-hidden>
                  🧊
                </span>
                <span className="create-modal-choice-label">Cube</span>
              </button>
              <button type="button" className="create-modal-choice" onClick={() => chooseCreateKind('view')}>
                <span className="create-modal-choice-icon" aria-hidden>
                  👁
                </span>
                <span className="create-modal-choice-label">View</span>
              </button>
              <button type="button" className="create-modal-choice" onClick={() => chooseCreateKind('table')}>
                <span className="create-modal-choice-icon" aria-hidden>
                  🗄
                </span>
                <span className="create-modal-choice-label">Table</span>
              </button>
            </div>
            <button type="button" className="create-modal-cancel" onClick={() => setCreateModalOpen(false)}>
              取消
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="error-toast" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </div>
  );
}

export default App;
