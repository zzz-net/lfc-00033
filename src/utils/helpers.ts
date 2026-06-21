export function formatAmount(amount: number): string {
  return `¥${amount.toFixed(2)}`;
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const EQUIPMENT_STATUS_LABELS: Record<string, string> = {
  available: "可用",
  borrowed: "已借出",
  reserved: "已预约",
  damaged: "已损坏",
  pending_confirm: "待确认",
};

export const EQUIPMENT_STATUS_COLORS: Record<string, string> = {
  available: "bg-green-100 text-green-800",
  borrowed: "bg-blue-100 text-blue-800",
  reserved: "bg-purple-100 text-purple-800",
  damaged: "bg-red-100 text-red-800",
  pending_confirm: "bg-yellow-100 text-yellow-800",
};

export const DEPOSIT_TYPE_LABELS: Record<string, string> = {
  freeze: "冻结",
  refund: "退还",
  deduct: "扣减",
};

export const DEPOSIT_TYPE_COLORS: Record<string, string> = {
  freeze: "bg-blue-100 text-blue-800",
  refund: "bg-green-100 text-green-800",
  deduct: "bg-red-100 text-red-800",
};

export const RESERVATION_STATUS_LABELS: Record<string, string> = {
  queued: "排队中",
  notified: "已通知",
  completed: "已完成",
  cancelled: "已取消",
};

export const RESERVATION_STATUS_COLORS: Record<string, string> = {
  queued: "bg-amber-100 text-amber-800",
  notified: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-gray-100 text-gray-600",
};
