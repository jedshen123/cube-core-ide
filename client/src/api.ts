const API_BASE = '/api';

export interface FileInfo {
  path: string;
  name: string;
  type: 'cube' | 'view' | 'unknown';
}

export async function listFiles(): Promise<FileInfo[]> {
  const res = await fetch(`${API_BASE}/files`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function readFile(path: string): Promise<{ content: string; path: string }> {
  const res = await fetch(`${API_BASE}/files/${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function writeFile(path: string, content: string): Promise<void> {
  const res = await fetch(`${API_BASE}/files/${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Save failed');
  }
}

export async function deleteFile(path: string): Promise<void> {
  const res = await fetch(`${API_BASE}/files/${encodeURIComponent(path)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(await res.text());
}
