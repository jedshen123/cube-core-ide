import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

function loadPercents(key: string, defaults: number[]): number[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [...defaults];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== defaults.length) return [...defaults];
    const nums = parsed.map((x) => Number(x));
    if (nums.some((n) => !Number.isFinite(n) || n <= 0)) return [...defaults];
    const sum = nums.reduce((a, b) => a + b, 0);
    if (sum <= 0) return [...defaults];
    return nums.map((x) => (x / sum) * 100);
  } catch {
    return [...defaults];
  }
}

function savePercents(key: string, percents: number[]) {
  try {
    localStorage.setItem(key, JSON.stringify(percents.map((p) => Math.round(p * 100) / 100)));
  } catch {
    /* ignore */
  }
}

export function useResizableColumnPercents(
  storageKey: string,
  defaultPercents: number[],
  minPercents: number[]
): {
  percents: number[];
  tableRef: RefObject<HTMLTableElement | null>;
  onResizePointerDown: (boundaryIndex: number) => (e: React.PointerEvent) => void;
} {
  const [percents, setPercents] = useState(() =>
    loadPercents(storageKey, defaultPercents)
  );
  const tableRef = useRef<HTMLTableElement | null>(null);
  const percentsRef = useRef(percents);
  percentsRef.current = percents;
  const dragRef = useRef<{
    index: number;
    startX: number;
    start: number[];
  } | null>(null);

  useEffect(() => {
    savePercents(storageKey, percents);
  }, [storageKey, percents]);

  const normalize = useCallback((arr: number[]) => {
    const sum = arr.reduce((a, b) => a + b, 0);
    if (sum <= 0) return arr;
    return arr.map((x) => (x / sum) * 100);
  }, []);

  const onResizePointerDown = useCallback(
    (boundaryIndex: number) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const table = tableRef.current;
      if (!table) return;
      const rect = table.getBoundingClientRect();
      if (rect.width <= 0) return;
      dragRef.current = {
        index: boundaryIndex,
        startX: e.clientX,
        start: [...percentsRef.current],
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev: PointerEvent) => {
        const d = dragRef.current;
        if (!d) return;
        const dx = ev.clientX - d.startX;
        const dPct = (dx / rect.width) * 100;
        const i = d.index;
        const a0 = d.start[i];
        const b0 = d.start[i + 1];
        let a = a0 + dPct;
        let b = b0 - dPct;
        const minA = minPercents[i] ?? 0;
        const minB = minPercents[i + 1] ?? 0;
        if (a < minA) {
          b -= minA - a;
          a = minA;
        }
        if (b < minB) {
          a -= minB - b;
          b = minB;
        }
        if (a < minA || b < minB) return;
        const next = [...d.start];
        next[i] = a;
        next[i + 1] = b;
        setPercents(normalize(next));
      };

      const onUp = (ev: PointerEvent) => {
        dragRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        (ev.target as HTMLElement).releasePointerCapture(ev.pointerId);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [minPercents, normalize]
  );

  return { percents, tableRef, onResizePointerDown };
}
