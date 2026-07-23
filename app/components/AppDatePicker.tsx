"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"];

function parseDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function toDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function AppDatePicker({ value, onChange, ariaLabel, disabled = false, invalid = false }: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const selectedDate = parseDate(value);
  const today = new Date();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [viewYear, setViewYear] = useState(() => (selectedDate ?? today).getFullYear());
  const [viewMonth, setViewMonth] = useState(() => (selectedDate ?? today).getMonth());
  const rootRef = useRef<HTMLDivElement | null>(null);
  const years = useMemo(() => Array.from({ length: today.getFullYear() + 11 - 1900 }, (_, index) => today.getFullYear() + 10 - index), [today.getFullYear()]);

  useEffect(() => {
    setDraft(value);
    if (!selectedDate) return;
    setViewYear(selectedDate.getFullYear());
    setViewMonth(selectedDate.getMonth());
  }, [value]);

  useEffect(() => {
    function closeOnOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("click", closeOnOutside);
    return () => document.removeEventListener("click", closeOnOutside);
  }, []);

  const calendarDays = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const start = new Date(viewYear, viewMonth, 1 - mondayOffset);
    return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  }, [viewYear, viewMonth]);

  function moveMonth(offset: number) {
    const next = new Date(viewYear, viewMonth + offset, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  }

  function choose(date: Date) {
    const next = toDateValue(date);
    setDraft(next);
    onChange(next);
    setOpen(false);
  }

  return <div className={`app-date-picker ${disabled ? "disabled" : ""}`} ref={rootRef}>
    <div className={`app-date-picker-control ${invalid ? "invalid" : ""}`}>
      <input
        aria-label={ariaLabel}
        autoComplete="off"
        disabled={disabled}
        inputMode="numeric"
        maxLength={10}
        value={draft}
        onBlur={() => { if (draft && !parseDate(draft)) setDraft(value); }}
        onChange={(event) => { const next = event.target.value.replace(/[^0-9-]/g, "").slice(0, 10); setDraft(next); if (!next || parseDate(next)) onChange(next); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => { if (event.key === "Escape") { setDraft(value); setOpen(false); } if (event.key === "Enter" && parseDate(draft)) { onChange(draft); setOpen(false); } }}
      />
      <button type="button" aria-label={`打开${ariaLabel}日历`} disabled={disabled} onClick={() => setOpen((current) => !current)}>▣</button>
    </div>
    <div className={`app-date-picker-popover ${open ? "" : "hidden"}`} role="dialog" aria-label={`${ariaLabel}日历`}>
      <div className="app-date-picker-header">
        <button type="button" aria-label="上个月" onClick={() => moveMonth(-1)}>‹</button>
        <div className="app-date-picker-jump">
          <select aria-label="年份" value={viewYear} onChange={(event) => setViewYear(Number(event.target.value))}>{years.map((year) => <option key={year} value={year}>{year}年</option>)}</select>
          <select aria-label="月份" value={viewMonth} onChange={(event) => setViewMonth(Number(event.target.value))}>{Array.from({ length: 12 }, (_, month) => <option key={month} value={month}>{month + 1}月</option>)}</select>
        </div>
        <button type="button" aria-label="下个月" onClick={() => moveMonth(1)}>›</button>
      </div>
      <div className="app-date-picker-weekdays">{weekdayLabels.map((label) => <span key={label}>{label}</span>)}</div>
      <div className="app-date-picker-days">{calendarDays.map((date) => {
        const dateValue = toDateValue(date);
        const outside = date.getMonth() !== viewMonth;
        return <button type="button" key={dateValue} className={`${outside ? "outside" : ""} ${dateValue === value ? "selected" : ""} ${dateValue === toDateValue(today) ? "today" : ""}`} onClick={() => choose(date)}>{date.getDate()}</button>;
      })}</div>
      <div className="app-date-picker-actions">
        <button type="button" className="secondary-button" onClick={() => { setDraft(""); onChange(""); setOpen(false); }}>清空</button>
        <button type="button" className="secondary-button" onClick={() => choose(today)}>今天</button>
      </div>
    </div>
  </div>;
}
