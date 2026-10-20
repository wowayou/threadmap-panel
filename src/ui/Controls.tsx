import { h } from 'preact'

export function Switch({ id, checked, label, disabled = false, onChange }: { id: string; checked: boolean; label: string; disabled?: boolean; onChange: () => void }) {
  return <div class="tm-setting"><span id={`tm-${id}`}>{label}</span><button type="button" class="tm-switch" role="switch" disabled={disabled} aria-checked={checked} aria-labelledby={`tm-${id}`} onClick={onChange} /></div>
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return <div class="tm-segmented" role="group" aria-label={label}>{options.map(([v, text]) => <button type="button" key={v} aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>)}</div>
}
