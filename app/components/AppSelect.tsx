"use client";

import { useEffect, useRef, useState } from "react";

export type AppSelectOption<T extends string = string> = { value: T; label: string };

export default function AppSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = "请选择",
  disabled = false,
}: {
  value: T | "";
  options: AppSelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    function closeOnOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("click", closeOnOutside);
    return () => document.removeEventListener("click", closeOnOutside);
  }, []);

  return (
    <div className={`config-select app-select ${disabled ? "disabled" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="config-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={selected ? "" : "placeholder"}>{selected?.label ?? placeholder}</span>
        <span className="select-arrow">▾</span>
      </button>
      <div className={`config-select-menu ${open ? "" : "hidden"}`} role="listbox" aria-label={`${ariaLabel}选项`}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={option.value === value}
            className={option.value === value ? "active" : ""}
            onClick={() => { onChange(option.value); setOpen(false); }}
          >
            <span>{option.label}</span>
          </button>
        ))}
        {options.length === 0 ? <div className="config-select-empty">暂无可选项</div> : null}
      </div>
    </div>
  );
}
