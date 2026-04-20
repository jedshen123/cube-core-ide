import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent } from 'react';

/**
 * 多行输入：失焦时保持较矮高度；聚焦时放宽高度上限并由内容撑开高度（与 Sql 字段行为一致）。
 */
export function ExpandableTextarea({
  value,
  onChange,
  placeholder,
  className = '',
  minRowsFocused = 5,
  spellCheck = false,
  disabled = false,
  onBlur,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  minRowsFocused?: number;
  spellCheck?: boolean;
  disabled?: boolean;
  onBlur?: (e: FocusEvent<HTMLTextAreaElement>) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (disabled) setFocused(false);
  }, [disabled]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 失焦时不要用内容的 scrollHeight 写死高度，否则在 flex 布局下会像「撑满内容高度」一样缩不回去
    if (!focused || disabled) {
      el.style.removeProperty('height');
      return;
    }
    el.style.height = 'auto';
    const h = el.scrollHeight;
    el.style.height = `${h}px`;
  }, [value, focused, disabled]);

  const cls = [className.trim(), focused ? 'is-focused' : ''].filter(Boolean).join(' ');

  return (
    <textarea
      ref={ref}
      className={cls}
      value={value}
      placeholder={placeholder}
      spellCheck={spellCheck}
      disabled={disabled}
      rows={focused ? minRowsFocused : 1}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => {
        if (!disabled) setFocused(true);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          (e.currentTarget as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}
