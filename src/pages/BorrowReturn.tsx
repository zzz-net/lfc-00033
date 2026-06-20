import { useState, useEffect, useCallback } from "react";
import { X, Download } from "lucide-react";
import { api } from "@/utils/api";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/components/Toast";
import { formatAmount, formatDate, EQUIPMENT_STATUS_LABELS, EQUIPMENT_STATUS_COLORS } from "@/utils/helpers";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import type { Equipment, BorrowRecord } from "@/types";

type TabKey = "borrow" | "return" | "damage";

const TABS: { key: TabKey; label: string }[] = [
  { key: "borrow", label: "借出" },
  { key: "return", label: "归还" },
  { key: "damage", label: "损坏登记" },
];

export default function BorrowReturnPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === "admin";

  const [activeTab, setActiveTab] = useLocalStorage<TabKey>("borrow_return_tab", "borrow");

  const [availableEquipments, setAvailableEquipments] = useState<Equipment[]>([]);
  const [borrowedRecords, setBorrowedRecords] = useState<BorrowRecord[]>([]);
  const [pendingRecords, setPendingRecords] = useState<BorrowRecord[]>([]);

  const [borrowForm, setBorrowForm] = useState({
    equipment_id: 0,
    borrower_name: "",
    borrower_phone: "",
  });
  const [submitting, setSubmitting] = useState(false);

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

  useEffect(() => {
    fetchAvailable();
    fetchBorrowed();
    fetchPending();
  }, [fetchAvailable, fetchBorrowed, fetchPending]);

  const selectedEquip = availableEquipments.find(
    (e) => e.id === borrowForm.equipment_id
  );

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
      fetchAvailable();
      fetchBorrowed();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "借出失败", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReturn = async (id: number) => {
    try {
      await api.returnBorrow(id);
      toast("归还成功", "success");
      fetchBorrowed();
      fetchAvailable();
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
      fetchBorrowed();
      fetchPending();
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
      fetchPending();
      fetchAvailable();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "确认失败", "error");
    }
  };

  const handleExport = async () => {
    try {
      let status = "";
      if (activeTab === "return") status = "borrowed";
      else if (activeTab === "damage") status = "pending_confirm";
      await api.exportBorrows({ status: status || undefined });
      toast("导出成功", "success");
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "导出失败", "error");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">借还操作</h1>
        {isAdmin && (activeTab === "return" || activeTab === "damage") && (
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
        <div className="flex border-b border-gray-100">
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
                  onChange={(e) =>
                    setBorrowForm({ ...borrowForm, equipment_id: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                >
                  <option value={0}>请选择可用设备</option>
                  {availableEquipments.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      {eq.name}（{eq.type}）
                    </option>
                  ))}
                </select>
              </div>

              {selectedEquip && (
                <div className="bg-teal-50 rounded-lg px-4 py-3 text-sm">
                  <span className="text-gray-600">押金金额：</span>
                  <span className="font-semibold text-teal-700">
                    {formatAmount(selectedEquip.deposit_amount)}
                  </span>
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
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
                borrowedRecords.map((r, idx) => (
                  <div
                    key={r.id}
                    className={`flex items-center justify-between px-5 py-3 rounded-lg border border-gray-100 ${
                      idx % 2 === 1 ? "bg-gray-50/50" : "bg-white"
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="font-medium text-gray-900">{r.equipment_name}</div>
                      <div className="text-sm text-gray-500">
                        借用人：{r.borrower_name}（{r.borrower_phone}）
                      </div>
                      <div className="text-xs text-gray-400">
                        借出时间：{formatDate(r.borrow_time)} | 押金：{formatAmount(r.deposit_frozen)}
                      </div>
                    </div>
                    <button onClick={() => handleReturn(r.id)} className="btn-primary text-sm">
                      归还
                    </button>
                  </div>
                ))
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
        </div>
      </div>

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
