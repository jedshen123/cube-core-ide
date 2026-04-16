import { useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import * as api from './api';
import type { FileInfo } from './api';

function App() {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hotReloadEvent, setHotReloadEvent] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const hotReloadTimerRef = useRef<number | null>(null);

  const activeFile = useMemo(
    () => files.find((f) => f.path === activePath),
    [files, activePath]
  );

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
          <button className="create-btn" onClick={createFile}>+ 新建文件</button>
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
                <button onClick={deleteActiveFile} disabled={loading}>删除</button>
                <button className="primary" onClick={saveFile} disabled={loading || !isUnsaved}>
                  保存
                </button>
              </div>
            </div>
            <div className="editor-container">
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
