import type { UIMessage } from "ai";

interface PermissionDialogProps {
  messages: UIMessage[];
  onRespond: (approvalId: string, approved: boolean) => void | Promise<void>;
}

export function PermissionDialog(_props: PermissionDialogProps) {
  // Placeholder — wired in Task 10
  return null;
}
