import { ConfirmModal } from "../components/ConfirmModal.tsx";
export function DraftNavigationDialog({ onClose, onConfirm, onOpenDraft }: {
  onClose: () => void; onConfirm: () => void; onOpenDraft: () => void;
}) {
  return <ConfirmModal title="Leave active draft?"
    description="You will lose the active draft if you leave this project. Open the draft to review it, or confirm to continue."
    onClose={onClose} actions={[
      { label: "Open draft", variant: "ghost", onClick: onOpenDraft },
      { label: "Leave and lose draft", variant: "danger", onClick: onConfirm },
    ]} />;
}
