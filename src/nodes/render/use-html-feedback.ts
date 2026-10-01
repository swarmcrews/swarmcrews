import { useEffect, useSyncExternalStore } from "react";
import { useDashboardTransport } from "./FormSubmissionProvider.tsx";
import { getHtmlFeedbackStore } from "./html-feedback-store.ts";

export function useHtmlFeedback(componentId: string, currentHtml: string) {
  const transport = useDashboardTransport();
  const store = getHtmlFeedbackStore(transport?.sessionKey ?? "standalone", componentId);
  const snapshot = useSyncExternalStore(store.subscribe, store.snapshot);
  useEffect(() => { store.connect(transport); }, [store, transport]);
  return { ...snapshot, setState: store.update, send: () => store.send(currentHtml),
    canSend: !!transport?.socketSend, resetDelivery: store.resetDelivery };
}
