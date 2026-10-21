import { LibraryDialog } from "./LibraryDialog.tsx";
export function NavigationBlockedDialog({ onClose }: { onClose: () => void }) {
  return <LibraryDialog title="Keep your unsaved work" onClose={onClose} footer={<button className="pl-action--primary" type="button" onClick={onClose}>Keep editing</button>}>
    <p>Navigation is paused. Save or explicitly discard your edits before leaving. Pending or failed writes must finish or be retried; your draft is still here.</p>
  </LibraryDialog>;
}
