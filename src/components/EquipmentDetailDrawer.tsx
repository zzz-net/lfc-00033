import { X } from "lucide-react";
import type { EquipmentDetail } from "@/types";
import { formatAmount, formatDate, EQUIPMENT_STATUS_LABELS, EQUIPMENT_STATUS_COLORS, DEPOSIT_TYPE_LABELS, DEPOSIT_TYPE_COLORS } from "@/utils/helpers";

interface Props {
  detail: EquipmentDetail | null;
  loading: boolean;
  onClose: () => void;
}

export default function EquipmentDetailDrawer({ detail, loading, onClose }: Props) {
  if (!detail && !loading) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
      <div className="w-[420px] bg-white shadow-xl h-full overflow-auto scrollbar-thin">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold text-gray-900">设备详情</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            加载中...
          </div>
        ) : detail ? (
          <div className="p-5 space-y-6">
            <div className="space-y-3">
              <h3 className="font-semibold text-gray-900 text-base">{detail.equipment.name}</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-gray-500">类型：</span>
                  <span className="text-gray-900">{detail.equipment.type}</span>
                </div>
                <div>
                  <span className="text-gray-500">状态：</span>
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${EQUIPMENT_STATUS_COLORS[detail.equipment.status]}`}>
                    {EQUIPMENT_STATUS_LABELS[detail.equipment.status]}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">押金：</span>
                  <span className="text-gray-900 font-medium">{formatAmount(detail.equipment.deposit_amount)}</span>
                </div>
                <div>
                  <span className="text-gray-500">备注：</span>
                  <span className="text-gray-900">{detail.equipment.notes || "-"}</span>
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3">押金流水</h4>
              {detail.deposit_timeline.length === 0 ? (
                <p className="text-sm text-gray-400">暂无记录</p>
              ) : (
                <div className="space-y-2">
                  {detail.deposit_timeline.map((t) => (
                    <div key={t.id} className="flex items-center justify-between text-sm bg-gray-50 px-3 py-2 rounded-lg">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${DEPOSIT_TYPE_COLORS[t.type]}`}>
                          {DEPOSIT_TYPE_LABELS[t.type]}
                        </span>
                        <span className="text-gray-600">{t.borrower_name}</span>
                      </div>
                      <div className="text-right">
                        <div className="font-medium text-gray-900">{formatAmount(t.amount)}</div>
                        <div className="text-xs text-gray-400">{formatDate(t.created_at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3">操作日志</h4>
              {detail.operation_logs.length === 0 ? (
                <p className="text-sm text-gray-400">暂无记录</p>
              ) : (
                <div className="space-y-2">
                  {detail.operation_logs.map((log) => (
                    <div key={log.id} className="text-sm bg-gray-50 px-3 py-2 rounded-lg">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-800">{log.action}</span>
                        <span className="text-xs text-gray-400">{formatDate(log.created_at)}</span>
                      </div>
                      <div className="text-gray-500 text-xs mt-0.5">
                        {log.operator_name} - {log.detail}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
