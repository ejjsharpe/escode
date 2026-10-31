import React, { useState } from "react";
import { Popover } from "@base-ui/react/popover";

export function ContextPicker({ label, value, options, disabled, onChange }: {
  label: string; value: string; options: { value: string; label: string; detail?: string; disabled?: boolean }[];
  disabled?: boolean; onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = options.find(option => option.value === value);
  const matches = options.filter(option => `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  return <Popover.Root open={open} onOpenChange={next => { setOpen(next); setQuery(""); }}>
    <Popover.Trigger className="context-picker-trigger" disabled={disabled} aria-label={label}>
      <span>{selected?.label ?? (value || label)}</span>
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m6 9 6 6 6-6" /></svg>
    </Popover.Trigger>
    <Popover.Portal><Popover.Positioner sideOffset={8} align="start" className="context-picker-positioner">
      <Popover.Popup className="context-picker-popup">
        <Popover.Title className="context-picker-title">{label}</Popover.Title>
        <input aria-label={`Search ${label.toLowerCase()}`} placeholder={`Search ${label.toLowerCase()}…`} value={query} onChange={event => setQuery(event.target.value)} />
        <div className="context-picker-options">
          {matches.map(option => <button type="button" key={option.value} disabled={option.disabled} aria-pressed={option.value === value} onClick={() => { onChange(option.value); setOpen(false); }}>
            <span>{option.label}{option.detail && <small>{option.detail}</small>}</span>
            {option.value === value && <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m5 12 4 4L19 6" /></svg>}
          </button>)}
          {!matches.length && <p>No matches</p>}
        </div>
      </Popover.Popup>
    </Popover.Positioner></Popover.Portal>
  </Popover.Root>;
}
