"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../src/api/client";
import AppCombobox, { type AppComboboxOption } from "./AppCombobox";

type ReferenceType = "disease_icd10" | "administrative_area";
type Item = { itemCode: string; itemName: string; description?: string | null };

export default function ReferenceDataCombobox({ type, value, onChange, onSelect, ariaLabel, placeholder, disabled = false, invalid = false }: {
  type: ReferenceType; value: string; onChange: (value: string) => void; onSelect?: (item: Item) => void;
  ariaLabel: string; placeholder?: string; disabled?: boolean; invalid?: boolean;
}) {
  const [options, setOptions] = useState<AppComboboxOption[]>([]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ type, keyword: value.trim() });
      void apiFetch(`/api/reference-data?${params}`).then(async (response) => {
        if (!response.ok) return;
        const data = await response.json() as { items?: Item[] };
        setOptions((data.items ?? []).map((item) => ({ value: item.itemCode, label: type === "disease_icd10" ? `${item.itemName}（${item.itemCode}）` : item.itemName, keywords: `${item.itemCode} ${item.description ?? ""}` })));
      }).catch(() => setOptions([]));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [type, value]);
  return <AppCombobox ariaLabel={ariaLabel} placeholder={placeholder} disabled={disabled} invalid={invalid} value={value} options={options} onChange={onChange} onSelect={(option) => onSelect?.({ itemCode: option.value, itemName: type === "disease_icd10" ? option.label.replace(/（[^）]+）$/, "") : option.label })} />;
}
