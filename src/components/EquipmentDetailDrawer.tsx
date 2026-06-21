import { useState } from "react";
import { X, Plus, User, Phone, Clock, StickyNote, Bell, CheckCircle2, XCircle, ArrowUp, ArrowDown } from "lucide-react";
import type { EquipmentDetail, Reservation } from "@/types";
import { formatAmount, formatDate, EQUIPMENT_STATUS_LABELS, EQUIPMENT_STATUS_COLORS, DEPOSIT_TYPE_LABELS, DEPOSIT_TYPE_COLORS, RESERVATION_STATUS_LABELS, RESERVATION_STATUS_COLORS } from "@/utils/helpers";
import { api } from "@/utils/api";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/components/Toast";

interface Props {
  detail: EquipmentDetail | null;
  loading: boolean;
  onClose: () => void;
  onRefresh?: () => void;
}

export default function EquipmentDetailDrawer({ detail, loading, onClose, onRefresh }: Props) {
  const { user } = useAuthStore();
  const isAdmin = user?.role === "admin";
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({
    borrower_name: "",
    borrower_phone: "",
    expected_pickup_time: "",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);

  if (!detail && !loading) return null;

  const activeReservations = detail?.reservations.filter(
    (r) => r.status === "queued" || r.status === "notified"
  ) || [];
  const historyReservations = detail?.reservations.filter(
    (r) => r.status === "completed" || r.status === "cancelled"
  ) || [];

  const handleAddReservation = async () => {
    if (!addForm.borrower_name.trim()) {
      toast("请输入借用人姓名", "error");
      return;
    }
    if (!addForm.borrower_phone.trim()) {
      toast("请输入借用人电话", "error");
      return;
    }
    if (!detail) return;
    setSubmitting(true);
    try {
      await api.createReservation({
        equipment_id: detail.equipment.id,
        borrower_name: addForm.borrower_name.trim(),
        borrower_phone: addForm.borrower_phone.trim(),
        expected_pickup_time: addForm.expected_pickup_time || undefined,
        notes: addForm.notes || undefined,
      });
      toast("预约登记成功", "success");
      setShowAddForm(false);
      setAddForm({ borrower_name: "", borrower_phone: "", expected_pickup_time: "", notes: "" });
      onRefresh?.();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "预约登记失败", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleNotify = async (r: Reservation) => {
    try {
      await api.notifyReservation(r.id);
      toast("已通知预约人", "success");
      onRefresh?.();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "通知失败", "error");
    }
  };

  const handleComplete = async (r: Reservation) => {
    try {
      await api.completeReservation(r.id, r.version);
      toast("预约已完成", "success");
      onRefresh?.();
    } catch (err: any) {
      if (err?.conflict) {
        toast("该预约已被其他操作更新，请刷新后重试", "error");
      } else {
        toast(err instanceof Error ? err.message : "操作失败", "error");
      }
    }
  };

  const handleCancel = async (r: Reservation) => {
    const reason = prompt("请输入取消原因（可选）：") || "";
    try {
      await api.cancelReservation(r.id, reason, r.version);
      toast("预约已取消", "success");
      onRefresh?.();
    } catch (err: any) {
      if (err?.conflict) {
        toast("该预约已被其他操作更新，请刷新后重试", "error");
      } else {
        toast(err instanceof Error ? err.message : "取消失败", "error");
      }
    }
  };

  const handleMove = async (r: Reservation, direction: -1 | 1) => {
    if (!detail) return;
    const idx = activeReservations.findIndex((x) => x.id === r.id);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= activeReservations.length) return;

    const orders = activeReservations.map((x, i) => {
      if (x.id === r.id) return { id: x.id, queue_order: newIdx };
      if (i === newIdx) return { id: x.id, queue_order: idx };
      return { id: x.id, queue_order: i };
    });

    try {
      await api.reorderReservations(detail.equipment.id, orders);
      toast("排队顺序已调整", "success");
      onRefresh?.();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "调整失败", "error");
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
      <div className="w-[460px] bg-white shadow-xl h-full overflow-auto scrollbar-thin">
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
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-gray-700">
                  预约排队 <span className="text-xs font-normal text-gray-400">({activeReservations.length} 人)</span>
                </h4>
                <button
                  onClick={() => setShowAddForm(!showAddForm)}
                  className="text-teal-700 hover:text-teal-900 text-sm font-medium flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  新增预约
                </button>
              </div>

              {showAddForm && (
                <div className="bg-gray-50 rounded-lg p-4 mb-4 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      <User className="w-3 h-3 inline mr-1" />借用人姓名
                    </label>
                    <input
                      type="text"
                      value={addForm.borrower_name}
                      onChange={(e) => setAddForm({ ...addForm, borrower_name: e.target.value })}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
                      placeholder="请输入姓名"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      <Phone className="w-3 h-3 inline mr-1" />借用人电话
                    </label>
                    <input
                      type="text"
                      value={addForm.borrower_phone}
                      onChange={(e) => setAddForm({ ...addForm, borrower_phone: e.target.value })}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
                      placeholder="请输入电话"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      <Clock className="w-3 h-3 inline mr-1" />预计取用时间
                    </label>
                    <input
                      type="datetime-local"
                      value={addForm.expected_pickup_time}
                      onChange={(e) => setAddForm({ ...addForm, expected_pickup_time: e.target.value })}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      <StickyNote className="w-3 h-3 inline mr-1" />备注
                    </label>
                    <textarea
                      value={addForm.notes}
                      onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })}
                      rows={2}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm resize-none"
                      placeholder="可选"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setShowAddForm(false)} className="px-3 py-1.5 text-sm text-gray-600 bg-gray-200 rounded hover:bg-gray-300">取消</button>
                    <button
                      onClick={handleAddReservation}
                      disabled={submitting}
                      className="px-3 py-1.5 text-sm bg-teal-700 text-white rounded hover:bg-teal-800 disabled:opacity-50"
                    >
                      {submitting ? "提交中..." : "确认登记"}
                    </button>
                  </div>
                </div>
              )}

              {activeReservations.length === 0 ? (
                <p className="text-sm text-gray-400">暂无排队预约</p>
              ) : (
                <div className="space-y-2">
                  {activeReservations.map((r) => (
                    <div key={r.id} className="text-sm bg-gray-50 px-3 py-3 rounded-lg border border-gray-100">
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1 flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-200 text-amber-800 text-xs font-bold">
                              #{r.queue_order + 1}
                            </span>
                            <span className="font-medium text-gray-900">{r.borrower_name}</span>
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${RESERVATION_STATUS_COLORS[r.status]}`}>
                              {RESERVATION_STATUS_LABELS[r.status]}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500">
                            <Phone className="w-3 h-3 inline mr-0.5" />{r.borrower_phone}
                          </div>
                          {r.expected_pickup_time && (
                            <div className="text-xs text-gray-500">
                              <Clock className="w-3 h-3 inline mr-0.5" />预计：{formatDate(r.expected_pickup_time)}
                            </div>
                          )}
                          {r.notes && (
                            <div className="text-xs text-gray-500">
                              <StickyNote className="w-3 h-3 inline mr-0.5" />{r.notes}
                            </div>
                          )}
                          <div className="text-xs text-gray-400">
                            登记人：{r.operator_name} · {formatDate(r.created_at)}
                          </div>
                        </div>
                        <div className="flex flex-col gap-1">
                          {isAdmin && (
                            <div className="flex gap-0.5">
                              <button
                                onClick={() => handleMove(r, -1)}
                                disabled={r.queue_order === 0}
                                className="p-1 text-gray-500 hover:text-teal-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                title="上移"
                              >
                                <ArrowUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleMove(r, 1)}
                                disabled={r.queue_order === activeReservations.length - 1}
                                className="p-1 text-gray-500 hover:text-teal-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                title="下移"
                              >
                                <ArrowDown className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                          <div className="flex gap-0.5 flex-wrap justify-end">
                            {r.status === "queued" && (isAdmin || r.operator_id === user?.id) && (
                              <button
                                onClick={() => handleNotify(r)}
                                className="p-1 text-blue-600 hover:text-blue-800"
                                title="通知"
                              >
                                <Bell className="w-4 h-4" />
                              </button>
                            )}
                            {(r.status === "queued" || r.status === "notified") && (isAdmin || r.operator_id === user?.id) && (
                              <>
                                <button
                                  onClick={() => handleComplete(r)}
                                  className="p-1 text-green-600 hover:text-green-800"
                                  title="完成"
                                >
                                  <CheckCircle2 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleCancel(r)}
                                  className="p-1 text-red-500 hover:text-red-700"
                                  title="取消"
                                >
                                  <XCircle className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {historyReservations.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-3">
                  预约历史 <span className="text-xs font-normal text-gray-400">({historyReservations.length} 条)</span>
                </h4>
                <div className="space-y-2">
                  {historyReservations.map((r) => (
                    <div key={r.id} className="text-sm bg-gray-50/60 px-3 py-2 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-700">{r.borrower_name}</span>
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${RESERVATION_STATUS_COLORS[r.status]}`}>
                            {RESERVATION_STATUS_LABELS[r.status]}
                          </span>
                        </div>
                        <span className="text-xs text-gray-400">{formatDate(r.created_at)}</span>
                      </div>
                      {r.cancel_reason && (
                        <div className="text-xs text-red-500 mt-1">取消原因：{r.cancel_reason}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                        <span className="text-gray-600">{(t as any).borrower_name_col}</span>
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
