import { useEffect, useRef, useState } from "react";

/** Arguments are individual values: empty strings, spaces and newlines survive edits. */
export function ArgumentFields({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const args = JSON.parse(value) as string[];
  const update = (next: string[]) => onChange(JSON.stringify(next));
  return <fieldset className="connection-fields"><legend>Arguments <span className="connection-muted">optional</span></legend>
    {args.map((arg, index) => <div className="connection-field-row" key={index}>
      <textarea aria-label={`Argument ${index + 1}`} rows={1} value={arg} placeholder="One argument, including any spaces" onChange={e => update(args.map((current, i) => i === index ? e.target.value : current))} />
      <button type="button" aria-label={`Remove argument ${index + 1}`} onClick={() => update(args.filter((_, i) => i !== index))}>Remove</button>
    </div>)}
    <button type="button" onClick={() => update([...args, ""])}>Add argument</button>
    <p className="connection-muted">One value per field. Arguments are passed literally; use absolute paths on the Swarmcrews host.</p>
  </fieldset>;
}
export function CredentialFields({ value, onChange, local }: { value: string; onChange: (value: string) => void; local: boolean }) {
  const [rows, setRows] = useState<[string, string][]>(() => Object.entries(JSON.parse(value)));
  const [revealed, setRevealed] = useState(false);
  const lastValue = useRef(value);
  useEffect(() => { if (value !== lastValue.current) { setRows(Object.entries(JSON.parse(value))); lastValue.current = value; } }, [value]);
  const update = (next: [string, string][]) => { setRows(next); const encoded = JSON.stringify(Object.fromEntries(next)); lastValue.current = encoded; onChange(encoded); };
  return <fieldset className="connection-fields"><legend>{local ? "Environment variables" : "HTTP headers"}</legend>
    {rows.map(([name, secret], index) => <div className="connection-secret-row" key={index}>
      <input required aria-label={`${local ? "Variable" : "Header"} name ${index + 1}`} value={name} placeholder={local ? "API_KEY" : "Authorization"}
        ref={input => { input?.setCustomValidity(rows.some(([other], i) => i !== index && other === name) ? "Each name must be unique." : ""); }}
        onChange={e => update(rows.map((row, i) => i === index ? [e.target.value, secret] : row))} />
      {revealed ? <textarea aria-label={`Credential value ${index + 1}`} rows={2} value={secret} onChange={e => update(rows.map((row, i) => i === index ? [name, e.target.value] : row))} />
        : <input aria-label={`Credential value ${index + 1}`} type="password" autoComplete="off" value={secret} placeholder={local ? "Value" : "Bearer your-token"} onChange={e => update(rows.map((row, i) => i === index ? [name, e.target.value] : row))} />}
      <button type="button" aria-label={`Remove credential ${index + 1}`} onClick={() => update(rows.filter((_, i) => i !== index))}>Remove</button>
    </div>)}
    <div className="connection-actions"><button type="button" onClick={() => update([...rows, ["", ""]])}>{local ? "Add variable" : "Add header"}</button>{rows.length > 0 && <button type="button" aria-pressed={revealed} onClick={() => setRevealed(v => !v)}>{revealed ? "Hide values" : "Show entered values"}</button>}</div>
  </fieldset>;
}
