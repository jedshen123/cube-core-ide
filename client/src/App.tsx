import { useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import YAML from 'yaml';
import * as api from './api';
import type { FileInfo } from './api';
import { VisualCubeEditor } from './components/VisualCubeEditor';
import { VisualViewEditor } from './components/VisualViewEditor';
import {
  downloadTextFile,
  extractCubesFromText,
  extractViewsFromText,
  parseCubeFile,
  parseViewFile,
  pickYamlFile,
  sanitizeFilename,
  stringifyDoc,
} from './modelYaml';
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
  const wsRef = useRef<WebSocket | null>(null);
  const hotReloadTimerRef = useRef<number | null>(null);

  const activeFile = useMemo(
    () => files.find((f) => f.path === activePath),
    [files, activePath]
  );

  const effectiveFileType: FileInfo['type'] = useMemo(() => {
    if (activeFile?.type) return activeFile.type;
    const p = activePath?.replace(/\\/g, '/') ?? '';
    if (p.includes('/cubes/') || p.startsWith('cubes/')) return 'cube';
    if (p.includes('/views/') || p.startsWith('views/')) return 'view';
    return 'unknown';
  }, [activeFile?.type, activePath]);

  const showYamlPreview = effectiveFileType === 'cube' || effectiveFileType === 'view';

  const yamlPreview = useMemo(() => yamlPreviewFromSource(content), [content]);

  const isUnsaved = content !== originalContent;

  // Load file list
  const refreshFiles = async () => {
    try {
      const list = await api.listFiles();
      setFiles(list);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => {
    refreshFiles();
  }, []);

  // Open file
  const openFile = async (path: string) => {
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
      const isCubeOrView =
        fileMeta?.type === 'cube' ||
        fileMeta?.type === 'view' ||
        p.includes('/cubes/') ||
        p.startsWith('cubes/') ||
        p.includes('/views/') ||
        p.startsWith('views/');
      setEditMode(isCubeOrView ? 'visual' : 'source');
      setCubeIndex(0);
      setViewIndex(0);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Save file
  const saveFile = async () => {
    if (!activePath) return;
    setLoading(true);
    try {
      await api.writeFile(activePath, content);
      setOriginalContent(content);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Export current cube/view as standalone YAML file
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
    if (!activePath) return;
    const fallbackName = (activePath.split('/').pop() || 'file').replace(/\.(ya?ml)$/i, '');
    downloadTextFile(`${sanitizeFilename(fallbackName, 'file')}.yml`, content);
  };

  // Delete file
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
    } catch (e: any) {
      setError(e.message);
    }
  };

  // Create new file
  const createFile = () => {
    const name = prompt('请输入文件名（如 cubes/orders.yml）：');
    if (!name) return;
    const path = name.endsWith('.yml') || name.endsWith('.yaml') ? name : `${name}.yml`;
    setActivePath(path);
    const defaultContent = path.includes('view')
      ? `views:\n  - name: \n`
      : `cubes:\n  - name: \n`;
    setContent(defaultContent);
    setOriginalContent('');
    const isCubeOrView = path.includes('cubes/') || path.includes('views/') || path.includes('view') || path.includes('cube');
    setEditMode(isCubeOrView ? 'visual' : 'source');
    setCubeIndex(0);
    setViewIndex(0);
  };

  // Import YAML file: pick local file, detect cube/view, save as new project file
  const importFile = async () => {
    if (isUnsaved) {
      const ok = confirm('当前文件未保存，切换将丢失修改，确认继续？');
      if (!ok) return;
    }
    const picked = await pickYamlFile();
    if (!picked) return;

    const asCube = extractCubesFromText(picked.text);
    const asView = extractViewsFromText(picked.text);
    let kind: 'cube' | 'view' | 'unknown' = 'unknown';
    if (asCube.ok && asCube.cubes.length > 0 && !(asView.ok && asView.views.length > 0)) {
      kind = 'cube';
    } else if (asView.ok && asView.views.length > 0 && !(asCube.ok && asCube.cubes.length > 0)) {
      kind = 'view';
    } else if (asCube.ok && asCube.cubes.length > 0 && asView.ok && asView.views.length > 0) {
      const pickCube = confirm('文件同时包含 cubes 和 views，点「确定」作为 cube 导入，「取消」作为 view 导入');
      kind = pickCube ? 'cube' : 'view';
    }

    const baseName = picked.name.replace(/\.(ya?ml)$/i, '');
    const safeBase = sanitizeFilename(baseName, kind === 'view' ? 'view' : 'cube');
    const prefix = kind === 'view' ? 'views/' : kind === 'cube' ? 'cubes/' : '';
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
      setActivePath(destPath);
      setContent(picked.text);
      setOriginalContent(picked.text);
      const p = destPath.replace(/\\/g, '/');
      const isCubeOrView =
        kind === 'cube' ||
        kind === 'view' ||
        p.includes('/cubes/') ||
        p.startsWith('cubes/') ||
        p.includes('/views/') ||
        p.startsWith('views/');
      setEditMode(isCubeOrView ? 'visual' : 'source');
      setCubeIndex(0);
      setViewIndex(0);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // WebSocket hot reload
  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      if (msg.event === 'file:changed' && msg.path === activePath) {
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
      if (msg.event === 'file:added' || msg.event === 'file:deleted') {
        await refreshFiles();
      }
    };

    ws.onerror = () => setError('WebSocket 连接失败');

    return () => {
      ws.close();
    };
  }, [activePath]);

  const cubes = files.filter((f) => f.type === 'cube');
  const views = files.filter((f) => f.type === 'view');
  const others = files.filter((f) => f.type === 'unknown');

  return (
    <div className="app">
      <aside className="sidebar">
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
        <div className="file-tree">
          {cubes.length > 0 && (
            <div className="section">
              <div className="section-title">Cubes</div>
              {cubes.map((f) => (
                <div
                  key={f.path}
                  className={`file-item ${activePath === f.path ? 'active' : ''}`}
                  onClick={() => openFile(f.path)}
                >
                  <span className="icon">🧊</span>
                  {f.name}
                </div>
              ))}
            </div>
          )}
          {views.length > 0 && (
            <div className="section">
              <div className="section-title">Views</div>
              {views.map((f) => (
                <div
                  key={f.path}
                  className={`file-item ${activePath === f.path ? 'active' : ''}`}
                  onClick={() => openFile(f.path)}
                >
                  <span className="icon">👁</span>
                  {f.name}
                </div>
              ))}
            </div>
          )}
          {others.length > 0 && (
            <div className="section">
              <div className="section-title">Others</div>
              {others.map((f) => (
                <div
                  key={f.path}
                  className={`file-item ${activePath === f.path ? 'active' : ''}`}
                  onClick={() => openFile(f.path)}
                >
                  <span className="icon">📄</span>
                  {f.name}
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      <main className="main">
        {activePath ? (
          <>
            <div className="toolbar">
              <div className="toolbar-left">
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
                      ? `将当前${effectiveFileType === 'view' ? ' view ' : ' cube '}导出为单独的 YAML 文件`
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
              {showYamlPreview && editMode === 'visual' ? (
                <div className="editor-split">
                  <div className="editor-pane editor-pane--visual">
                    <div className="pane-header">可视化</div>
                    <div className="pane-body pane-body--scroll">
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
                    </div>
                  </div>
                  <div className="editor-pane editor-pane--preview">
                    <div className="pane-header">预览 YAML</div>
                    <div className="pane-body">
                      {yamlPreview.ok ? (
                        <Editor
                          height="100%"
                          defaultLanguage="yaml"
                          value={yamlPreview.text}
                          theme="vs-dark"
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
                </div>
              ) : showYamlPreview ? (
                <div className="editor-split">
                  <div className="editor-pane editor-pane--source">
                    <div className="pane-header">源码</div>
                    <div className="pane-body">
                      <Editor
                        height="100%"
                        defaultLanguage="yaml"
                        value={content}
                        onChange={(v) => setContent(v || '')}
                        theme="vs-dark"
                        options={{
                          minimap: { enabled: false },
                          fontSize: 13,
                          wordWrap: 'on',
                          automaticLayout: true,
                        }}
                      />
                    </div>
                  </div>
                  <div className="editor-pane editor-pane--preview">
                    <div className="pane-header">预览 YAML</div>
                    <div className="pane-body">
                      {yamlPreview.ok ? (
                        <Editor
                          height="100%"
                          defaultLanguage="yaml"
                          value={yamlPreview.text}
                          theme="vs-dark"
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
                </div>
              ) : (
                <Editor
                  height="100%"
                  defaultLanguage="yaml"
                  value={content}
                  onChange={(v) => setContent(v || '')}
                  theme="vs-dark"
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
          <div className="empty-state">请选择左侧文件开始编辑</div>
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
