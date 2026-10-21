import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import type { ReactNode } from "react";

type Tone = "error" | "warning" | "info" | "success";
const icons = { error: AlertTriangle, warning: AlertTriangle, info: Info, success: CheckCircle2 } as const;

/** One announced message with its recovery actions. Alerts interrupt; statuses wait. */
export function LibraryNotice({ tone = "info", alert = false, actions, onDismiss, children }: {
  tone?: Tone;
  alert?: boolean;
  actions?: ReactNode;
  onDismiss?: () => void;
  children: ReactNode;
}) {
  const Icon = icons[tone];
  return <div className="pl-callout" data-tone={tone} role={alert ? "alert" : "status"}>
    <Icon className="pl-callout-icon" size={16} aria-hidden="true" />
    <div className="pl-callout-copy">{children}</div>
    {(actions || onDismiss) && <div className="pl-callout-actions">
      {actions}
      {onDismiss && <button type="button" className="pl-callout-dismiss" aria-label="Dismiss message" onClick={onDismiss}><X size={16} aria-hidden="true" /></button>}
    </div>}
  </div>;
}
