import type { LegacyRef, ReactNode } from 'react';
import { useResizableColumnPercents } from '../hooks/useResizableColumnPercents';

export type ResizableColumnDef = {
  id: string;
  header: ReactNode;
  thClassName?: string;
};

type Props = {
  storageKey: string;
  columns: ResizableColumnDef[];
  defaultPercents: number[];
  minPercents: number[];
  className?: string;
  children: ReactNode;
};

export function ResizableColumnTable({
  storageKey,
  columns,
  defaultPercents,
  minPercents,
  className = '',
  children,
}: Props) {
  const { percents, tableRef, onResizePointerDown } = useResizableColumnPercents(
    storageKey,
    defaultPercents,
    minPercents
  );

  return (
    <div className="catalog-table-wrapper catalog-table-wrapper--resizable">
      <table
        ref={tableRef as LegacyRef<HTMLTableElement>}
        className={`catalog-table catalog-table--resizable ${className}`.trim()}
      >
        <colgroup>
          {percents.map((p, i) => (
            <col key={columns[i]?.id ?? i} style={{ width: `${p}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((col, i) => (
              <th key={col.id} className={col.thClassName}>
                <span className="catalog-th-inner">
                  <span className="catalog-th-label">{col.header}</span>
                  {i < columns.length - 1 && (
                    <span
                      className="resizable-col-handle"
                      onPointerDown={onResizePointerDown(i)}
                      role="separator"
                      aria-orientation="vertical"
                      aria-label="拖拽调整列宽"
                    />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        {children}
      </table>
    </div>
  );
}
