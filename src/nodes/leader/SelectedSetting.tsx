import "./selected-setting.css";

/** Visible native-select disclosure: never depend on native interior text paint. */
export function SelectedSetting({ id, label, value, description }: {
  id: string;
  label?: string;
  value: string;
  description?: string;
}) {
  return <span id={id} className="leader-selected-setting">
    {label ? `${label}: ` : null}<strong>{value}{description ? "." : ""}</strong>
    {description ? ` ${description}` : null}
  </span>;
}
