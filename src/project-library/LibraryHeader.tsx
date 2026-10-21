import { NavigationDraftReveal } from "../navigation-drafts.tsx";
import { ChevronDown, Plus } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

/** Heading actions stay fixed while the repository draft expands below navigation. */
export function LibraryHeader({ title, tools, navigation, empty, subdued = false, children }: { title: string; tools: ReactNode; navigation: ReactNode; empty: boolean; subdued?: boolean; children?: ReactNode }) {
  const [chosenOpen, setChosenOpen] = useState<boolean | null>(null);
  const open = chosenOpen ?? empty;
  const panelId = useId();
  return <>
    <header className="pl-heading"><h1>{title}</h1><div className="pl-heading-actions">
      {children && <button className={`pl-registration-toggle${subdued ? " pl-registration-toggle--quiet" : ""}`} type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setChosenOpen(!open)}><Plus size={16} aria-hidden="true" />Add repository<ChevronDown className="pl-registration-chevron" size={16} aria-hidden="true" /></button>}
      {tools}
    </div></header>
    {navigation}
    {children && <div id={panelId} className="pl-registration-panel" hidden={!open}><NavigationDraftReveal onOpen={() => setChosenOpen(true)}>{children}</NavigationDraftReveal></div>}
  </>;
}
