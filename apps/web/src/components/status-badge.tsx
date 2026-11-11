export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface StatusBadgeProps {
  status?: string;
  tone?: StatusTone;
  label?: string;
  className?: string;
}

function resolveStatus(status?: string): { tone: StatusTone; label: string } {
  if (!status) return { tone: "neutral", label: "" };
  const s = status.toLowerCase();

  switch (s) {
    case "active":
      return { tone: "success", label: "Active" };
    case "contested":
      return { tone: "warning", label: "Disputed" };
    case "deprecated":
      return { tone: "neutral", label: "Deprecated" };
    case "archived":
      return { tone: "neutral", label: "Archived" };
    case "pending":
      return { tone: "neutral", label: "Pending" };
    case "compiling":
      return { tone: "info", label: "Compiling" };
    case "completed":
      return { tone: "success", label: "Completed" };
    case "failed":
      return { tone: "danger", label: "Failed" };
    case "awaiting_approval":
    case "awaiting approval":
    case "held":
      return { tone: "warning", label: "Held for approval" };
    case "positive":
      return { tone: "success", label: "Positive" };
    case "negative":
      return { tone: "danger", label: "Negative" };
    case "warning":
      return { tone: "warning", label: "Warning" };
    default:
      return { tone: "neutral", label: status };
  }
}

const toneClasses: Record<StatusTone, string> = {
  neutral: "badge-neutral",
  info: "badge-info",
  success: "badge-success",
  warning: "badge-warning",
  danger: "badge-danger",
};

export function StatusBadge({ status, tone, label, className = "" }: StatusBadgeProps) {
  const resolved = resolveStatus(status);
  const finalTone = tone ?? resolved.tone;
  const finalLabel = label ?? resolved.label;

  if (!finalLabel) return null;

  return (
    <span className={`badge ${toneClasses[finalTone]} ${className}`.trim()} role="status">
      <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
      <span>{finalLabel}</span>
    </span>
  );
}
