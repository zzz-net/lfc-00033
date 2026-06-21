import { useState, useEffect, useCallback, useMemo } from "react";
import { X, Download, Plus, User, Phone, Clock, StickyNote, Bell, CheckCircle2, XCircle, ArrowUp, ArrowDown, ListTodo, AlertTriangle, Lock, Unlock } from "lucide-react";
import { api } from "@/utils/api";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/components/Toast";
import { formatAmount, formatDate, EQUIPMENT_STATUS_LABELS, EQUIPMENT_STATUS_COLORS, RESERVATION_STATUS_LABELS, RESERVATION_STATUS_COLORS } from "@/utils/helpers";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import type { Equipment, BorrowRecord, Reservation } from "@/types";

type EquipmentWithLocked = Equipment & { lockedReservation: Reservation | null };

type TabKey = "borrow" | "return" | "damage" | "reservations";

const TABS: { key: TabKey; label: string; icon: typeof ListTodo }[] = [
  { key: "borrow", label: "借出", icon: ListTodo },
  { key: "return", label: "归还", icon: ListTodo },
  { key: "damage", label: "损坏登记", icon: ListTodo },
  { key: "reservations", label: "预约排队", icon: ListTodo },
];

export default function BorrowReturnPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === "admin";

  const [activeTab, setActiveTab] = useLocalStorage<TabKey>("borrow_return_tab", "borrow");

  const [availableEquipments, setAvailableEquipments] = useState<Equipment[]>([]);
  const [borrowedEquipments, setBorrowedEquipments] = useState<Equipment[]>([]);
  const [reservedEquipments, setReservedEquipments] = useState<Equipment[]>([]);
  const [borrowedRecords, setBorrowedRecords] = useState<BorrowRecord[]>([]);
  const [pendingRecords, setPendingRecords] = useState<BorrowRecord[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);

  const [nextReservationAlert, setNextReservationAlert] = useState<Reservation | null>(null);

  const [borrowForm, setBorrowForm] = useState({
    equipment_id: 0,
    borrower_name: "",
    borrower_phone: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const [showReservationForm, setShowReservationForm] = useState(false);
  const [reservationForm, setReservationForm] = useState({
    equipment_id: 0,
    borrower_name: "",
    borrower_phone: "",
    expected_pickup_time: "",
    notes: "",
  });
  const [reservationSubmitting, setReservationSubmitting] = useState(false);

  const [damageDialog, setDamageDialog] = useState<BorrowRecord | null>(null);
  const [damageDesc, setDamageDesc] = useState("");

  const [confirmDialog, setConfirmDialog] = useState<BorrowRecord | null>(null);
  const [confirmDeducted, setConfirmDeducted] = useState("");

  const fetchAvailable = useCallback(async () => {
    try {
      const res = await api.getEquipments({ status: "available" });
      setAvailableEquipments(res.data);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "加载失败", "error");
    }
  }, []);

  const fetchBorrowedEquipments = useCallback(async () => {
    try {
      const res = await api.getEquipments({ status: "borrowed" });
      setBorrowedEquipments(res.data);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "加载失败", "error");
    }
  }, []);

  const fetchReservedEquipments = useCallback(async () => {
    try {
      const res = await api.getEquipments({ status: "reserved" });
      setReservedEquipments(res.data);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "加载失败", "error");
    }
  }, []);

  const fetchBorrowed = useCallback(async () => {
    try {
      const data = await api.getBorrows({ status: "borrowed" });
      setBorrowedRecords(data);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "加载失败", "error");
    }
  }, []);

  const fetchPending = useCallback(async () => {
    try {
      const data = await api.getBorrows({ status: "pending_confirm" });
      setPendingRecords(data);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "加载失败", "error");
    }
  }, []);

  const fetchReservations = useCallback(async () => {
    try {
      const data = await api.getReservations();
      setReservations(data);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "加载失败", "error");
    }
  }, []);

  const refreshAll = useCallback(() => {
    fetchAvailable();
    fetchBorrowedEquipments();
    fetchReservedEquipments();
    fetchBorrowed();
    fetchPending();
    fetchReservations();
  }, [fetchAvailable, fetchBorrowedEquipments, fetchReservedEquipments, fetchBorrowed, fetchPending, fetchReservations]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const borrowableEquipments: EquipmentWithLocked[] = useMemo(() => {
    const availWithLocked = availableEquipments.map((eq) => ({
      ...eq,
      lockedReservation: null as Reservation | null,
    }));
    const reservedWithLocked = reservedEquipments.map((eq) => {
      const locked = reservations.find(
        (r) => r.equipment_id === eq.id && r.status === "locked"
      );
      return { ...eq, lockedReservation: locked || null };
    });
    return [...availWithLocked, ...reservedWithLocked].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [availableEquipments, reservedEquipments, reservations]);

  const selectedEquip = borrowableEquipments.find(
    (e) => e.id === borrowForm.equipment_id
  );

  const handleBorrowFormEquipmentChange = (equipmentId: number) => {
    const eq = borrowableEquipments.find((e) => e.id === equipmentId);
    if (eq && eq.status === "reserved" && eq.lockedReservation) {
      setBorrowForm({
        equipment_id: equipmentId,
        borrower_name: eq.lockedReservation.borrower_name,
        borrower_phone: eq.lockedReservation.borrower_phone,
      });
    } else {
      setBorrowForm({ ...borrowForm, equipment_id: equipmentId });
    }
  };

  const handleBorrow = async () => {
    if (!borrowForm.equipment_id) {
      toast("请选择设备", "error");
      return;
    }
    if (!borrowForm.borrower_name.trim()) {
      toast("请输入借用人姓名", "error");
      return;
    }
    if (!borrowForm.borrower_phone.trim()) {
      toast("请输入借用人电话", "error");
      return;
    }
    setSubmitting(true);
    try {
      await api.createBorrow(borrowForm);
      toast("借出成功", "success");
      setBorrowForm({ equipment_id: 0, borrower_name: "", borrower_phone: "" });
      refreshAll();
    } catch (err: any) {
      if (err?.conflict) {
        toast("设备状态在提交时已变更，请刷新后重试", "error");
        refreshAll();
      } else {
        toast(err instanceof Error ? err.message : "借出失败", "error");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleReturn = async (id: number) => {
    try {
      const res = await api.returnBorrow(id);
      toast("归还成功", "success");
      if (res?.next_reservation) {
        setNextReservationAlert(res.next_reservation);
      }
      refreshAll();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "归还失败", "error");
    }
  };

  const handleDamage = async () => {
    if (!damageDialog) return;
    if (!damageDesc.trim()) {
      toast("请输入损坏描述", "error");
      return;
    }
    try {
      await api.reportDamage(damageDialog.id, damageDesc);
      toast("损坏登记成功", "success");
      setDamageDialog(null);
      setDamageDesc("");
      refreshAll();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "登记失败", "error");
    }
  };

  const handleConfirmDamage = async () => {
    if (!confirmDialog) return;
    const deducted = parseFloat(confirmDeducted) || 0;
    if (deducted < 0) {
      toast("扣减金额不能为负", "error");
      return;
    }
    try {
      await api.confirmDamage(confirmDialog.id, deducted);
      toast("确认损坏成功", "success");
      setConfirmDialog(null);
      setConfirmDeducted("");
      refreshAll();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "确认失败", "error");
    }
  };

  const handleCreateReservation = async () => {
    if (!reservationForm.equipment_id) {
      toast("请选择设备", "error");
      return;
    }
    if (!reservationForm.borrower_name.trim()) {
      toast("请输入借用人姓名", "error");
      return;
    }
    if (!reservationForm.borrower_phone.trim()) {
      toast("请输入借用人电话", "error");
      return;
    }
    setReservationSubmitting(true);
    try {
      await api.createReservation({
        equipment_id: reservationForm.equipment_id,
        borrower_name: reservationForm.borrower_name.trim(),
        borrower_phone: reservationForm.borrower_phone.trim(),
        expected_pickup_time: reservationForm.expected_pickup_time || undefined,
        notes: reservationForm.notes || undefined,
      });
      toast("预约登记成功", "success");
      setShowReservationForm(false);
      setReservationForm({ equipment_id: 0, borrower_name: "", borrower_phone: "", expected_pickup_time: "", notes: "" });
      refreshAll();
    } catch (err: any) {
      if (err?.conflict) {
        toast("设备状态在提交时已变更，请刷新后重试", "error");
        refreshAll();
      } else {
        toast(err instanceof Error ? err.message : "预约登记失败", "error");
      }
    } finally {
      setReservationSubmitting(false);
    }
  };

  const handleNotifyReservation = async (r: Reservation) => {
    try {
      await api.notifyReservation(r.id);
      toast("已通知预约人", "success");
      fetchReservations();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "通知失败", "error");
    }
  };

  const handleCompleteReservation = async (r: Reservation) => {
    try {
      await api.completeReservation(r.id, r.version);
      toast("预约已完成", "success");
      fetchReservations();
    } catch (err: any) {
      if (err?.conflict) {
        toast("该预约已被其他操作更新，请刷新后重试", "error");
      } else {
        toast(err instanceof Error ? err.message : "操作失败", "error");
      }
      fetchReservations();
    }
  };

  const handleCancelReservation = async (r: Reservation) => {
    const reason = prompt("请输入取消原因（可选）：") || "";
    try {
      await api.cancelReservation(r.id, reason, r.version);
      toast("预约已取消", "success");
      refreshAll();
    } catch (err: any) {
      if (err?.conflict) {
        toast("该预约已被其他操作更新，请刷新后重试", "error");
      } else {
        toast(err instanceof Error ? err.message : "取消失败", "error");
      }
      refreshAll();
    }
  };

  const handleLockReservation = async (r: Reservation) => {
    try {
      await api.lockReservation(r.id);
      toast("已锁定预约人为唯一取件对象", "success");
      fetchReservations();
      fetchReservedEquipments();
    } catch (err: any) {
      if (err?.conflict) {
        toast("锁定冲突，设备已锁定给其他预约人，请刷新", "error");
      } else {
        toast(err instanceof Error ? err.message : "锁定失败", "error");
      }
      refreshAll();
    }
  };

  const handleReleaseLock = async (r: Reservation) => {
    if (!confirm(`确认释放 ${r.borrower_name} 的取件锁定？释放后将自动锁定下一位预约人。`)) return;
    try {
      await api.releaseLockReservation(r.id, r.version);
      toast("已释放取件锁定", "success");
      refreshAll();
    } catch (err: any) {
      if (err?.conflict) {
        toast("该预约已被其他操作更新，请刷新后重试", "error");
      } else {
        toast(err instanceof Error ? err.message : "释放失败", "error");
      }
      refreshAll();
    }
  };

  const handleMoveReservation = async (r: Reservation, direction: -1 | 1) => {
    const sameEquipReservations = reservations.filter(
      (x) => x.equipment_id === r.equipment_id && (x.status === "queued" || x.status === "notified" || x.status === "locked")
    ).sort((a, b) => a.queue_order - b.queue_order);

    const idx = sameEquipReservations.findIndex((x) => x.id === r.id);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= sameEquipReservations.length) return;

    const orders = sameEquipReservations.map((x, i) => {
      if (x.id === r.id) return { id: x.id, queue_order: newIdx };
      if (i === newIdx) return { id: x.id, queue_order: idx };
      return { id: x.id, queue_order: i };
    });

    try {
      await api.reorderReservations(r.equipment_id, orders);
      toast("排队顺序已调整", "success");
      fetchReservations();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "调整失败", "error");
    }
  };

  const handleExport = async () => {
    try {
      if (activeTab === "reservations") {
        await api.exportReservations();
      } else {
        let status = "";
        if (activeTab === "return") status = "borrowed";
        else if (activeTab === "damage") status = "pending_confirm";
        await api.exportBorrows({ status: status || undefined });
      }
      toast("导出成功", "success");
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "导出失败", "error");
    }
  };

  const groupedReservations = useMemo(() => {
    const map = new Map<number, { equipment: { id: number; name: string; type: string; status: string } | null; items: Reservation[] }>();
    for (const r of reservations) {
      if (!map.has(r.equipment_id)) {
        map.set(r.equipment_id, { equipment: null, items: [] });
      }
      map.get(r.equipment_id)!.items.push(r);
    }
    for (const e of [...availableEquipments, ...borrowedEquipments, ...reservedEquipments]) {
      if (map.has(e.id)) {
        map.get(e.id)!.equipment = { id: e.id, name: e.name, type: e.type, status: e.status };
      }
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({
        equipment_id: id,
        equipment: v.equipment || { id, name: `设备#${id}`, type: "", status: "" },
        items: v.items.sort((a, b) => a.queue_order - b.queue_order),
      }))
      .sort((a, b) => a.equipment.name.localeCompare(b.equipment.name));
  }, [reservations, availableEquipments, borrowedEquipments, reservedEquipments]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-gray-900">借还操作</h1>
        {isAdmin && (activeTab === "return" || activeTab === "damage" || activeTab === "reservations") && (
          <button
            onClick={handleExport}
            className="btn-outline flex items-center gap-1.5 text-sm"
          >
            <Download className="w-4 h-4" />
            导出当前列表
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="flex border-b border-gray-100 flex-wrap">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-teal-700 text-teal-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {activeTab === "borrow" && (
            <div className="max-w-lg space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">选择设备</label>
                <select
                  value={borrowForm.equipment_id}
                  onChange={(e) => handleBorrowFormEquipmentChange(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                >
                  <option value={0}>请选择可用设备</option>
                  {availableEquipments.length > 0 && (
                    <optgroup label="可借">
                      {availableEquipments.map((eq) => (
                        <option key={eq.id} value={eq.id}>
                          {eq.name}（{eq.type}）
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {reservedEquipments.length > 0 && (
                    <optgroup label="已锁定 - 待取件">
                      {reservedEquipments.map((eq) => {
                        const locked = reservations.find(
                          (r) => r.equipment_id === eq.id && r.status === "locked"
                        );
                        return (
                          <option key={eq.id} value={eq.id}>
                            {eq.name}（{eq.type}）→ {locked ? `${locked.borrower_name} 🔒` : "待锁定"}
                          </option>
                        );
                      })}
                    </optgroup>
                  )}
                </select>
              </div>

              {selectedEquip && (
                <div className={`rounded-lg px-4 py-3 text-sm ${selectedEquip.status === "reserved" ? "bg-purple-50 border border-purple-200" : "bg-teal-50"}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-gray-600">押金金额：</span>
                      <span className={`font-semibold ${selectedEquip.status === "reserved" ? "text-purple-700" : "text-teal-700"}`}>
                        {formatAmount(selectedEquip.deposit_amount)}
                      </span>
                    </div>
                    {selectedEquip.status === "reserved" && (
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${EQUIPMENT_STATUS_COLORS.reserved}`}>
                        {EQUIPMENT_STATUS_LABELS.reserved}
                      </span>
                    )}
                  </div>
                  {selectedEquip.status === "reserved" && selectedEquip.lockedReservation && (
                    <div className="mt-2 space-y-1">
                      <div className="text-xs text-purple-600 flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        该设备已锁定给 {selectedEquip.lockedReservation.borrower_name}，仅限该预约人取件
                      </div>
                      {selectedEquip.lockedReservation.lock_expires_at && (
                        <div className="text-xs text-purple-500">
                          取件锁定超时：{formatDate(selectedEquip.lockedReservation.lock_expires_at)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">借用人姓名</label>
                <input
                  type="text"
                  value={borrowForm.borrower_name}
                  onChange={(e) =>
                    setBorrowForm({ ...borrowForm, borrower_name: e.target.value })
                  }
                  readOnly={selectedEquip?.status === "reserved" && !!selectedEquip?.lockedReservation}
                  className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm ${selectedEquip?.status === "reserved" && selectedEquip?.lockedReservation ? "bg-gray-100 cursor-not-allowed" : ""}`}
                  placeholder="请输入姓名"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">借用人电话</label>
                <input
                  type="text"
                  value={borrowForm.borrower_phone}
                  onChange={(e) =>
                    setBorrowForm({ ...borrowForm, borrower_phone: e.target.value })
                  }
                  readOnly={selectedEquip?.status === "reserved" && !!selectedEquip?.lockedReservation}
                  className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm ${selectedEquip?.status === "reserved" && selectedEquip?.lockedReservation ? "bg-gray-100 cursor-not-allowed" : ""}`}
                  placeholder="请输入电话"
                />
              </div>

              <button
                onClick={handleBorrow}
                disabled={submitting}
                className="btn-primary"
              >
                {submitting ? "提交中..." : "确认借出"}
              </button>
            </div>
          )}

          {activeTab === "return" && (
            <div className="space-y-3">
              {borrowedRecords.length === 0 ? (
                <p className="text-center text-gray-400 py-8">暂无待归还记录</p>
              ) : (
                borrowedRecords.map((r, idx) => {
                  const pendingReservations = reservations.filter(
                    (rv) => rv.equipment_id === r.equipment_id && (rv.status === "queued" || rv.status === "notified" || rv.status === "locked")
                  );
                  return (
                    <div
                      key={r.id}
                      className={`rounded-lg border ${
                        pendingReservations.length > 0
                          ? "border-purple-200 bg-purple-50/30"
                          : `border-gray-100 ${idx % 2 === 1 ? "bg-gray-50/50" : "bg-white"}`
                      }`}
                    >
                      <div className="flex items-center justify-between px-5 py-3">
                        <div className="space-y-1">
                          <div className="font-medium text-gray-900">{r.equipment_name}</div>
                          <div className="text-sm text-gray-500">
                            借用人：{r.borrower_name}（{r.borrower_phone}）
                          </div>
                          <div className="text-xs text-gray-400">
                            借出时间：{formatDate(r.borrow_time)} | 押金：{formatAmount(r.deposit_frozen)}
                          </div>
                          {pendingReservations.length > 0 && (
                            <div className="text-xs text-purple-600 mt-1">
                              <Lock className="w-3 h-3 inline mr-0.5" />
                              归还后将自动锁定下一位预约人为唯一取件对象，设备将变为「已预约/已锁定」状态
                            </div>
                          )}
                        </div>
                        <button onClick={() => handleReturn(r.id)} className="btn-primary text-sm">
                          归还
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {activeTab === "damage" && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">已借出设备 - 损坏登记</h3>
                {borrowedRecords.length === 0 ? (
                  <p className="text-center text-gray-400 py-4">暂无可登记的借出记录</p>
                ) : (
                  <div className="space-y-3">
                    {borrowedRecords.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between px-5 py-3 rounded-lg border border-gray-100 bg-gray-50/50"
                      >
                        <div className="space-y-1">
                          <div className="font-medium text-gray-900">{r.equipment_name}</div>
                          <div className="text-sm text-gray-500">
                            借用人：{r.borrower_name}（{r.borrower_phone}）
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setDamageDialog(r);
                            setDamageDesc("");
                          }}
                          className="btn-danger text-sm"
                        >
                          登记损坏
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {isAdmin && pendingRecords.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">
                    待确认损坏（管理员）
                  </h3>
                  <div className="space-y-3">
                    {pendingRecords.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between px-5 py-3 rounded-lg border border-yellow-200 bg-yellow-50/50"
                      >
                        <div className="space-y-1">
                          <div className="font-medium text-gray-900">
                            {r.equipment_name}
                            <span className={`ml-2 inline-block px-2 py-0.5 rounded-full text-xs font-medium ${EQUIPMENT_STATUS_COLORS[r.status]}`}>
                              {EQUIPMENT_STATUS_LABELS[r.status]}
                            </span>
                          </div>
                          <div className="text-sm text-gray-500">
                            借用人：{r.borrower_name} | 损坏描述：{r.damage_description || "-"}
                          </div>
                          <div className="text-xs text-gray-400">
                            押金：{formatAmount(r.deposit_frozen)}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setConfirmDialog(r);
                            setConfirmDeducted(r.deposit_frozen.toString());
                          }}
                          className="btn-primary text-sm"
                        >
                          确认损坏
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "reservations" && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">预约排队列表</h3>
                <button
                  onClick={() => {
                    setShowReservationForm(!showReservationForm);
                    setReservationForm({ equipment_id: 0, borrower_name: "", borrower_phone: "", expected_pickup_time: "", notes: "" });
                  }}
                  className="btn-primary text-sm flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  新增预约
                </button>
              </div>

              {showReservationForm && (
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 space-y-3 max-w-2xl">
                  {borrowedEquipments.length === 0 ? (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-sm text-yellow-800">
                      当前没有已借出的设备，无法登记预约。只有「已借出」的设备才能进行预约登记。
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">选择设备（仅限已借出的设备）</label>
                        <select
                          value={reservationForm.equipment_id}
                          onChange={(e) =>
                            setReservationForm({ ...reservationForm, equipment_id: Number(e.target.value) })
                          }
                          className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm bg-white"
                        >
                          <option value={0}>请选择已借出的设备</option>
                          {borrowedEquipments
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((eq) => {
                              const activeCount = reservations.filter(
                                (r) => r.equipment_id === eq.id && (r.status === "queued" || r.status === "notified" || r.status === "locked")
                              ).length;
                              return (
                                <option key={eq.id} value={eq.id}>
                                  {eq.name}（{eq.type}）{activeCount > 0 ? `- 排队 ${activeCount} 人` : ""}
                                </option>
                              );
                            })}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            <User className="w-3 h-3 inline mr-1" />借用人姓名
                          </label>
                          <input
                            type="text"
                            value={reservationForm.borrower_name}
                            onChange={(e) =>
                              setReservationForm({ ...reservationForm, borrower_name: e.target.value })
                            }
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
                            value={reservationForm.borrower_phone}
                            onChange={(e) =>
                              setReservationForm({ ...reservationForm, borrower_phone: e.target.value })
                            }
                            className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
                            placeholder="请输入电话"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          <Clock className="w-3 h-3 inline mr-1" />预计取用时间
                        </label>
                        <input
                          type="datetime-local"
                          value={reservationForm.expected_pickup_time}
                          onChange={(e) =>
                            setReservationForm({ ...reservationForm, expected_pickup_time: e.target.value })
                          }
                          className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          <StickyNote className="w-3 h-3 inline mr-1" />备注
                        </label>
                        <textarea
                          value={reservationForm.notes}
                          onChange={(e) =>
                            setReservationForm({ ...reservationForm, notes: e.target.value })
                          }
                          rows={2}
                          className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm resize-none"
                          placeholder="可选"
                        />
                      </div>
                    </>
                  )}
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setShowReservationForm(false)}
                      className="px-3 py-1.5 text-sm text-gray-600 bg-gray-200 rounded hover:bg-gray-300"
                    >
                      取消
                    </button>
                    {borrowedEquipments.length > 0 && (
                      <button
                        onClick={handleCreateReservation}
                        disabled={reservationSubmitting}
                        className="px-3 py-1.5 text-sm bg-teal-700 text-white rounded hover:bg-teal-800 disabled:opacity-50"
                      >
                        {reservationSubmitting ? "提交中..." : "确认登记"}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {groupedReservations.length === 0 ? (
                <p className="text-center text-gray-400 py-12">暂无预约记录</p>
              ) : (
                groupedReservations.map((group) => {
                  const activeItems = group.items.filter((r) => r.status === "queued" || r.status === "notified" || r.status === "locked");
                  const historyItems = group.items.filter((r) => r.status === "completed" || r.status === "cancelled" || r.status === "expired");
                  const equipStatus = group.equipment.status;
                  return (
                    <div key={group.equipment_id} className="border border-gray-200 rounded-lg overflow-hidden">
                      <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-800 text-sm">{group.equipment.name}</span>
                          <span className="text-xs text-gray-500">{group.equipment.type}</span>
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${EQUIPMENT_STATUS_COLORS[equipStatus] || "bg-gray-100 text-gray-600"}`}>
                            {EQUIPMENT_STATUS_LABELS[equipStatus] || equipStatus}
                          </span>
                          {activeItems.length > 0 && (
                            <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700">
                              排队 {activeItems.length} 人
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="divide-y divide-gray-100">
                        {activeItems.map((r) => (
                          <div key={r.id} className="px-4 py-3 bg-white">
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1 flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-200 text-amber-800 text-xs font-bold">
                                    #{r.queue_order + 1}
                                  </span>
                                  <span className="font-medium text-gray-900 text-sm">{r.borrower_name}</span>
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
                                {r.status === "locked" && r.lock_expires_at && (
                                  <div className="text-xs text-purple-500 flex items-center gap-0.5">
                                    <Lock className="w-3 h-3" />
                                    取件锁定超时：{formatDate(r.lock_expires_at)}
                                  </div>
                                )}
                                <div className="text-xs text-gray-400">
                                  登记人：{r.operator_name} · {formatDate(r.created_at)}
                                </div>
                              </div>
                              <div className="flex flex-col gap-1">
                                {isAdmin && activeItems.length > 1 && (
                                  <div className="flex gap-0.5">
                                    <button
                                      onClick={() => handleMoveReservation(r, -1)}
                                      disabled={r.queue_order === 0}
                                      className="p-1 text-gray-500 hover:text-teal-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                      title="上移"
                                    >
                                      <ArrowUp className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => handleMoveReservation(r, 1)}
                                      disabled={r.queue_order === activeItems.length - 1}
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
                                      onClick={() => handleNotifyReservation(r)}
                                      className="p-1 text-blue-600 hover:text-blue-800"
                                      title="通知"
                                    >
                                      <Bell className="w-4 h-4" />
                                    </button>
                                  )}
                                  {r.status === "queued" && isAdmin && (
                                    <button
                                      onClick={() => handleLockReservation(r)}
                                      className="p-1 text-purple-600 hover:text-purple-800"
                                      title="锁定为取件人"
                                    >
                                      <Lock className="w-4 h-4" />
                                    </button>
                                  )}
                                  {r.status === "notified" && isAdmin && (
                                    <button
                                      onClick={() => handleLockReservation(r)}
                                      className="p-1 text-purple-600 hover:text-purple-800"
                                      title="升级为取件锁定"
                                    >
                                      <Lock className="w-4 h-4" />
                                    </button>
                                  )}
                                  {r.status === "locked" && isAdmin && (
                                    <button
                                      onClick={() => handleReleaseLock(r)}
                                      className="p-1 text-orange-500 hover:text-orange-700"
                                      title="释放锁定"
                                    >
                                      <Unlock className="w-4 h-4" />
                                    </button>
                                  )}
                                  {(r.status === "queued" || r.status === "notified" || r.status === "locked") && (isAdmin || r.operator_id === user?.id) && (
                                    <>
                                      <button
                                        onClick={() => handleCompleteReservation(r)}
                                        className="p-1 text-green-600 hover:text-green-800"
                                        title="完成"
                                      >
                                        <CheckCircle2 className="w-4 h-4" />
                                      </button>
                                      <button
                                        onClick={() => handleCancelReservation(r)}
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
                        {historyItems.length > 0 && (
                          <div className="px-4 py-2 bg-gray-50/70">
                            <div className="text-xs font-medium text-gray-500 mb-1.5">历史记录</div>
                            <div className="space-y-1">
                              {historyItems.map((r) => (
                                <div key={r.id} className="text-xs flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${RESERVATION_STATUS_COLORS[r.status]}`}>
                                      {RESERVATION_STATUS_LABELS[r.status]}
                                    </span>
                                    <span className="text-gray-600">{r.borrower_name}</span>
                                    {r.cancel_reason && (
                                      <span className="text-red-500">({r.cancel_reason})</span>
                                    )}
                                  </div>
                                  <span className="text-gray-400">{formatDate(r.created_at)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {nextReservationAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 border-2 border-purple-300">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-purple-50">
              <h2 className="text-lg font-semibold text-purple-900 flex items-center gap-2">
                <Lock className="w-5 h-5" />
                下一位预约人已自动锁定
              </h2>
              <button
                onClick={() => setNextReservationAlert(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-3">
              <div className="p-3 bg-purple-50/50 rounded-lg border border-purple-100 space-y-1.5">
                <div className="text-sm">
                  <span className="text-gray-500">借用人：</span>
                  <span className="font-medium text-gray-900">{nextReservationAlert.borrower_name}</span>
                </div>
                <div className="text-sm">
                  <span className="text-gray-500">联系电话：</span>
                  <span className="font-medium text-gray-900">{nextReservationAlert.borrower_phone}</span>
                </div>
                <div className="text-sm">
                  <span className="text-gray-500">排队顺位：</span>
                  <span className="font-medium text-purple-700">#{nextReservationAlert.queue_order + 1}</span>
                </div>
                {nextReservationAlert.lock_expires_at && (
                  <div className="text-sm">
                    <span className="text-gray-500">锁定超时：</span>
                    <span className="font-medium text-purple-700">{formatDate(nextReservationAlert.lock_expires_at)}</span>
                  </div>
                )}
                {nextReservationAlert.notes && (
                  <div className="text-sm">
                    <span className="text-gray-500">备注：</span>
                    <span className="text-gray-700">{nextReservationAlert.notes}</span>
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-500">
                该预约人已被正式锁定为唯一取件对象，仅限该预约人取件，管理员也不可越权借出。如超时未取件，锁定将自动释放并锁定下一位。
              </p>
            </div>
            <div className="px-6 py-3 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setNextReservationAlert(null)}
                className="btn-primary text-sm"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}

      {damageDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold">损坏登记</h2>
              <button onClick={() => setDamageDialog(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="text-sm text-gray-600">
                设备：<span className="font-medium text-gray-900">{damageDialog.equipment_name}</span>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">损坏描述</label>
                <textarea
                  value={damageDesc}
                  onChange={(e) => setDamageDesc(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
                  placeholder="请描述损坏情况"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button onClick={() => setDamageDialog(null)} className="btn-outline">取消</button>
                <button onClick={handleDamage} className="btn-danger">确认登记</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold">确认损坏</h2>
              <button onClick={() => setConfirmDialog(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="text-sm text-gray-600">
                设备：<span className="font-medium text-gray-900">{confirmDialog.equipment_name}</span>
              </div>
              <div className="text-sm text-gray-600">
                损坏描述：<span className="text-gray-900">{confirmDialog.damage_description}</span>
              </div>
              <div className="text-sm text-gray-600">
                冻结押金：<span className="font-medium text-gray-900">{formatAmount(confirmDialog.deposit_frozen)}</span>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">扣减金额（元）</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={confirmDeducted}
                  onChange={(e) => setConfirmDeducted(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <p className="text-xs text-gray-400 mt-1">
                  剩余押金将退还：{formatAmount(confirmDialog.deposit_frozen - (parseFloat(confirmDeducted) || 0))}
                </p>
              </div>
              <div className="flex justify-end gap-3">
                <button onClick={() => setConfirmDialog(null)} className="btn-outline">取消</button>
                <button onClick={handleConfirmDamage} className="btn-primary">确认</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
