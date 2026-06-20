import { useState, useEffect, useCallback } from "react";
import { Plus, Search, Download } from "lucide-react";
import { api } from "@/utils/api";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/components/Toast";
import { formatAmount, EQUIPMENT_STATUS_LABELS, EQUIPMENT_STATUS_COLORS } from "@/utils/helpers";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import type { Equipment } from "@/types";
import EquipmentModal from "@/components/EquipmentModal";
import EquipmentDetailDrawer from "@/components/EquipmentDetailDrawer";

const STATUS_TABS = [
  { value: "", label: "全部" },
  { value: "available", label: "可用" },
  { value: "borrowed", label: "已借出" },
  { value: "damaged", label: "已损坏" },
  { value: "pending_confirm", label: "待确认" },
];

export default function EquipmentPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === "admin";

  const [equipments, setEquipments] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useLocalStorage<string>("equipment_filter_status", "");
  const [nameSearch, setNameSearch] = useLocalStorage<string>("equipment_filter_name", "");
  const [typeFilter, setTypeFilter] = useLocalStorage<string>("equipment_filter_type", "");

  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<Equipment | null>(null);
  const [showDrawer, setShowDrawer] = useState(false);
  const [drawerDetail, setDrawerDetail] = useState<any>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const fetchEquipments = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getEquipments({
        status: statusFilter || undefined,
        name: nameSearch || undefined,
        type: typeFilter || undefined,
      });
      setEquipments(data);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "加载失败", "error");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, nameSearch, typeFilter]);

  useEffect(() => {
    fetchEquipments();
  }, [fetchEquipments]);

  const handleRowClick = async (id: number) => {
    setShowDrawer(true);
    setDrawerLoading(true);
    setDrawerDetail(null);
    try {
      const data = await api.getEquipmentDetail(id);
      setDrawerDetail(data);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "加载详情失败", "error");
      setShowDrawer(false);
    } finally {
      setDrawerLoading(false);
    }
  };

  const handleModalSubmit = async (data: {
    name: string;
    type: string;
    deposit_amount: number;
    notes: string;
  }) => {
    try {
      if (editItem) {
        await api.updateEquipment(editItem.id, data);
        toast("设备更新成功", "success");
      } else {
        await api.createEquipment(data);
        toast("设备添加成功", "success");
      }
      setShowModal(false);
      setEditItem(null);
      fetchEquipments();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "操作失败", "error");
    }
  };

  const handleExport = async () => {
    try {
      await api.exportEquipments({
        status: statusFilter,
        name: nameSearch,
        type: typeFilter,
      });
      toast("导出成功", "success");
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "导出失败", "error");
    }
  };

  const uniqueTypes = [...new Set(equipments.map((e) => e.type))].filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">设备台账</h1>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={handleExport}
              className="btn-outline flex items-center gap-1.5 text-sm"
            >
              <Download className="w-4 h-4" />
              导出当前筛选
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => {
                setEditItem(null);
                setShowModal(true);
              }}
              className="btn-primary flex items-center gap-1.5 text-sm"
            >
              <Plus className="w-4 h-4" />
              添加设备
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center gap-3">
          <div className="flex gap-1">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  statusFilter === tab.value
                    ? "bg-teal-700 text-white"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={nameSearch}
                onChange={(e) => setNameSearch(e.target.value)}
                placeholder="搜索设备名称"
                className="pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-sm w-44"
              />
            </div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white"
            >
              <option value="">全部类型</option>
              {uniqueTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600">
                <th className="text-left px-5 py-3 font-medium">名称</th>
                <th className="text-left px-5 py-3 font-medium">类型</th>
                <th className="text-left px-5 py-3 font-medium">状态</th>
                <th className="text-left px-5 py-3 font-medium">押金金额</th>
                <th className="text-left px-5 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-gray-400">
                    加载中...
                  </td>
                </tr>
              ) : equipments.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-gray-400">
                    暂无设备数据
                  </td>
                </tr>
              ) : (
                equipments.map((eq, idx) => (
                  <tr
                    key={eq.id}
                    onClick={() => handleRowClick(eq.id)}
                    className={`cursor-pointer border-b border-gray-50 hover:bg-teal-50/40 transition-colors ${
                      idx % 2 === 1 ? "bg-gray-50/50" : ""
                    }`}
                  >
                    <td className="px-5 py-3 font-medium text-gray-900">{eq.name}</td>
                    <td className="px-5 py-3 text-gray-600">{eq.type}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${EQUIPMENT_STATUS_COLORS[eq.status]}`}>
                        {EQUIPMENT_STATUS_LABELS[eq.status]}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-900">{formatAmount(eq.deposit_amount)}</td>
                    <td className="px-5 py-3">
                      {isAdmin && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditItem(eq);
                            setShowModal(true);
                          }}
                          className="text-teal-700 hover:text-teal-900 text-sm font-medium"
                        >
                          编辑
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <EquipmentModal
          equipment={editItem}
          onClose={() => {
            setShowModal(false);
            setEditItem(null);
          }}
          onSubmit={handleModalSubmit}
        />
      )}

      {showDrawer && (
        <EquipmentDetailDrawer
          detail={drawerDetail}
          loading={drawerLoading}
          onClose={() => {
            setShowDrawer(false);
            setDrawerDetail(null);
          }}
        />
      )}
    </div>
  );
}
