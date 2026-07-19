"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type AppComboboxOption = { value: string; label: string; keywords?: string };

export default function AppCombobox({ value, options, onChange, ariaLabel, placeholder = "请输入关键词", disabled = false, invalid = false }: {
  value: string;
  options: AppComboboxOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const filtered = useMemo(() => {
    const keyword = value.trim().toLowerCase();
    if (!keyword) return options.slice(0, 12);
    return options.filter((item) => `${item.label} ${item.keywords ?? ""}`.toLowerCase().includes(keyword)).slice(0, 12);
  }, [options, value]);

  useEffect(() => {
    function close(event: MouseEvent) { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false); }
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  return <div className={`config-select app-combobox ${disabled ? "disabled" : ""}`} ref={rootRef}>
    <div className={`app-combobox-control ${invalid ? "invalid" : ""}`}>
      <input aria-label={ariaLabel} disabled={disabled} value={value} placeholder={placeholder} onFocus={() => setOpen(true)} onChange={(event) => { onChange(event.target.value); setOpen(true); }} />
      <button type="button" aria-label={`${ariaLabel}展开`} disabled={disabled} onClick={() => setOpen((current) => !current)}>▾</button>
    </div>
    <div className={`config-select-menu ${open ? "" : "hidden"}`} role="listbox" aria-label={`${ariaLabel}选项`}>
      {filtered.map((item) => <button key={item.value} type="button" role="option" aria-selected={item.label === value} className={item.label === value ? "active" : ""} onClick={() => { onChange(item.label); setOpen(false); }}><span>{item.label}</span></button>)}
      {filtered.length === 0 ? <div className="config-select-empty">未找到匹配的行政区</div> : null}
    </div>
  </div>;
}
