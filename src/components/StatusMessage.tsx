import type { ReactNode } from "react";
import { CircleAlert, Info, LoaderCircle } from "lucide-react";
import "./status-message.css";

/** Compact feedback for loading, error, and informational states. */
export function StatusMessage({ children, tone = "info", onRetry, className = "" }: {
  children: ReactNode;
  tone?: "info" | "loading" | "error";
  onRetry?: (() => void) | undefined;
  className?: string;
}) {
  const Icon = tone === "loading" ? LoaderCircle : tone === "error" ? CircleAlert : Info;
  return <div className={`status-message ${className}`} data-tone={tone} role={tone === "error" ? "alert" : "status"}>
    <Icon className="status-message__icon" size={16} aria-hidden="true" />
    <span className="status-message__copy">{children}</span>
    {onRetry && <button className="status-message__retry" type="button" onClick={onRetry}>Retry</button>}
  </div>;
}
