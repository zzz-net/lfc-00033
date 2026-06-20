import { useState, useEffect, useCallback } from "react";
import { Search, Download } from "lucide-react";
import { api } from "@/utils/api";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/components/Toast";
import { formatAmount, formatDate, DEPOSIT_TYPE_LABELS, DEPOSIT_TYPE_COLORS } from "@/utils/helpers";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import type { DepositTransaction } from "@/types";

const TYPE_OPTIONS = [
  { value: "", label: "全部" },
  { value: "freeze", label: "冻结" },
  { value: "refund", label: "退还" },
  { value: "deduct", label: "扣减" },
];

export default function DepositLogPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === "admin";

  const [transactions, setTransactions] = useState<DepositTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  const [typeFilter, setTypeFilter] = useLocalStorage<string>("deposit_filter_type", "");
  const [borrowerSearch, setBorrowerSearch] = useLocalStorage<string>("deposit_filter_borrower", "");
  const [equipmentSearch, setEquipmentSearch] = useLocalStorage<string>("deposit_filter_equipment", "");

  const fetchDeposits = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getDeposits({
        type: typeFilter || undefined,
        borrower_name: borrowerSearch || undefined,
        equipment_name: equipmentSearch || undefined,
      });
      setTransactions(data);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "加载失败", "error");
    } finally {
      setLoading(false);
    }
  }, [typeFilter, borrowerSearch, equipmentSearch]);

  useEffect(() => {
    fetchDeposits();
  }, [fetchDeposits]);

  const handleExport = async () => {
    try {
      await api.exportDeposits({
        type: typeFilter,
        borrower_name: borrowerSearch,
        equipment_name: equipmentSearch,
      });
      toast("导出成功", "success");
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "导出失败", "error");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">押金流水</h1>
        {isAdmin && (
          <button
            onClick={handleExport}
            className="btn-outline flex items-center gap-1.5 text-sm"
          >
            <Download className="w-4 h-4" />
            导出当前筛选
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center gap-3">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white"
          >
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={borrowerSearch}
              onChange={(e) => setBorrowerSearch(e.target.value)}
              placeholder="搜索借用人"
              className="pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-sm w-40"
            />
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={equipmentSearch}
              onChange={(e) => setEquipmentSearch(e.target.value)}
              placeholder="搜索设备名称"
              className="pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-sm w-40"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600">
                <th className="text-left px-5 py-3 font-medium">设备</th>
                <th className="text-left px-5 py-3 font-medium">借用人</th>
                <th className="text-left px-5 py-3 font-medium">类型</th>
                <th className="text-left px-5 py-3 font-medium">金额</th>
                <th className="text-left px-5 py-3 font-medium">操作人</th>
                <th className="text-left px-5 py-3 font-medium">时间</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-400">
                    加载中...
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-400">
                    暂无押金流水
                  </td>
                </tr>
              ) : (
                transactions.map((t, idx) => (
                  <tr
                    key={t.id}
                    className={`border-b border-gray-50 ${
                      idx % 2 === 1 ? "bg-gray-50/50" : ""
                    }`}
                  >
                    <td className="px-5 py-3 font-medium text-gray-900">{t.equipment_name}</td>
                    <td className="px-5 py-3 text-gray-600">{t.borrower_name}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${DEPOSIT_TYPE_COLORS[t.type]}`}>
                        {DEPOSIT_TYPE_LABELS[t.type]}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-900 font-medium">{formatAmount(t.amount)}</td>
                    <td className="px-5 py-3 text-gray-600">{t.operator_name}</td>
                    <td className="px-5 py-3 text-gray-500">{formatDate(t.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
