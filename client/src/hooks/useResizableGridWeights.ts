import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

function loadWeights(key: string, defaults: number[]): number[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [...defaults];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== defaults.length) return [...defaults];
    const nums = parsed.map((x) => Number(x));
    if (nums.some((n) => !Number.isFinite(n) || n <= 0)) return [...defaults];
    return nums;
  } catch {
    return [...defaults];
  }
}

function saveWeights(key: string, weights: number[]) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify(weights.map((w) => Math.round(w * 1000) / 1000))
    );
  } catch {
    /* ignore */
  }
}

/** 可视化列表中间「字段区」多列 fr 权重，可拖拽分隔线调整 */
export function useResizableGridWeights(
  storageKey: string,
  defaultWeights: number[],
  minRatio = 0.06
): {
  gridTemplateColumns: string;
  gridRef: RefObject<HTMLDivElement | null>;
  onResizePointerDown: (boundaryIndex: number) => (e: React.PointerEvent) => void;
} {
  const [weights, setWeights] = useState(() => loadWeights(storageKey, defaultWeights));
  const gridRef = useRef<HTMLDivElement | null>(null);
  const weightsRef = useRef(weights);
  weightsRef.current = weights;
  const dragRef = useRef<{ index: number; startX: number; start: number[] } | null>(null);

  useEffect(() => {
    saveWeights(storageKey, weights);
  }, [storageKey, weights]);

  const gridTemplateColumns = weights
    .map((w) => `minmax(0, ${w}fr)`)
    .join(' ');

  const onResizePointerDown = useCallback(
    (boundaryIndex: number) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const grid = gridRef.current;
      if (!grid) return;
      const rect = grid.getBoundingClientRect();
      if (rect.width <= 0) return;
      dragRef.current = {
        index: boundaryIndex,
        startX: e.clientX,
        start: [...weightsRef.current],
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev: PointerEvent) => {
        const d = dragRef.current;
        if (!d) return;
        const dx = ev.clientX - d.startX;
        const pair = d.start[d.index] + d.start[d.index + 1];
        const delta = (dx / rect.width) * pair;
        let a = d.start[d.index] + delta;
        let b = d.start[d.index + 1] - delta;
        const minA = minRatio * pair;
        const minB = minRatio * pair;
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
        next[d.index] = a;
        next[d.index + 1] = b;
        setWeights(next);
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
    [minRatio]
  );

  return { gridTemplateColumns, gridRef, onResizePointerDown };
}
