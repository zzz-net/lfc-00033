import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Plus,
  Upload,
  Download,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Clock,
  User,
  Phone,
  StickyNote,
  FileJson,
  Trash2,
  AlertOctagon,
  Play,
  X,
} from "lucide-react";
import { api } from "@/utils/api";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/components/Toast";
import {
  formatDate,
  OFFLINE_SIGNOFF_TYPE_LABELS,
  OFFLINE_SIGNOFF_TYPE_COLORS,
  OFFLINE_SIGNOFF_STATUS_LABELS,
  OFFLINE_SIGNOFF_STATUS_COLORS,
  EQUIPMENT_STATUS_LABELS,
  EQUIPMENT_STATUS_COLORS,
} from "@/utils/helpers";
import type {
  OfflineSignoffRecord,
  OfflineSignoffStats,
  Equipment,
} from "@/types";

type TabKey = "pending" | "syncing" | "failed" | "completed";
type FormType = "borrow" | "return" | "damage";

const TABS: { key: TabKey; label: string; icon: typeof Clock }[] = [
  { key: "pending", label: "待同步", icon: Clock },
  { key: "syncing", label: "同步中", icon: RefreshCw },
  { key: "failed", label: "同步失败", icon: AlertTriangle },
  { key: "completed", label: "已完成", icon: CheckCircle },
];

const FORM_TYPES: { key: FormType; label: string }[] = [
  { key: "borrow", label: "借出登记" },
  { key: "return", label: "归还登记" },
  { key: "damage", label: "损坏登记" },
];

export default function OfflineSignoffPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === "admin";

  const [activeTab, setActiveTab] = useState<TabKey>("pending");
  const [records, setRecords] = useState<OfflineSignoffRecord[]>([]);
  const [stats, setStats] = useState<OfflineSignoffStats | null>(null);
  const [equipments, setEquipments] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState<FormType>("borrow");
  const [formData, setFormData] = useState({
    equipment_id: 0,
    borrower_name: "",
    borrower_phone: "",
    damage_description: "",
    signer_name: "",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const [detailRecord, setDetailRecord] = useState<OfflineSignoffRecord | null>(null);
  const [resolveDialog, setResolveDialog] = useState<OfflineSignoffRecord | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchRecords = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getOfflineSignoffs({ status: activeTab });
      setRecords(data);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "加载失败", "error");
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await api.getOfflineSignoffStats();
      setStats(data);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "加载统计失败", "error");
    }
  }, []);

  const fetchEquipments = useCallback(async () => {
    try {
      const res = await api.getEquipments();
      setEquipments(res.data);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "加载设备失败", "error");
    }
  }, []);

  const refreshAll = useCallback(() => {
    fetchRecords();
    fetchStats();
  }, [fetchRecords, fetchStats]);

  useEffect(() => {
    fetchEquipments();
    fetchStats();
  }, [fetchEquipments, fetchStats]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const availableEquipmentsForForm = useMemo(() => {
    if (formType === "borrow") {
      return equipments.filter(
        (e) => e.status === "available" || e.status === "reserved"
      );
    }
    return equipments.filter((e) => e.status === "borrowed");
  }, [equipments, formType]);

  const handleSubmit = async () => {
    if (!formData.equipment_id) {
      toast("请选择设备", "error");
      return;
    }
    if (!formData.borrower_name.trim()) {
      toast("请输入借用人姓名", "error");
      return;
    }
    if (!formData.borrower_phone.trim()) {
      toast("请输入借用人电话", "error");
      return;
    }
    setSubmitting(true);
    try {
      await api.createOfflineSignoff({
        type: formType,
        equipment_id: formData.equipment_id,
        borrower_name: formData.borrower_name.trim(),
        borrower_phone: formData.borrower_phone.trim(),
        damage_description: formData.damage_description || undefined,
        signer_name: formData.signer_name || undefined,
        notes: formData.notes || undefined,
      });
      toast("补录记录创建成功", "success");
      setShowForm(false);
      setFormData({
        equipment_id: 0,
        borrower_name: "",
        borrower_phone: "",
        damage_description: "",
        signer_name: "",
        notes: "",
      });
      refreshAll();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "创建失败", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSync = async (id: number) => {
    try {
      await api.syncOfflineSignoff(id);
      toast("同步成功", "success");
      refreshAll();
    } catch (err: any) {
      if (err?.conflict) {
        toast("同步失败，存在冲突", "error");
      } else {
        toast(err instanceof Error ? err.message : "同步失败", "error");
      }
      refreshAll();
    }
  };

  const handleBatchSync = async () => {
    if (!confirm("确定要批量同步所有待同步和失败的记录吗？")) return;
    try {
      setSyncing(true);
      const result = await api.batchSyncOfflineSignoffs();
      toast(
        `批量同步完成：成功 ${result.success} 条，失败 ${result.failed} 条`,
        result.failed > 0 ? "info" : "success"
      );
      refreshAll();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "批量同步失败", "error");
    } finally {
      setSyncing(false);
    }
  };

  const handleResolve = async (
    record: OfflineSignoffRecord,
    action: "retry" | "force" | "discard"
  ) => {
    try {
      await api.resolveOfflineSignoff(record.id, action, action === "force");
      toast(
        action === "discard"
          ? "已放弃记录"
          : action === "force"
          ? "强制同步成功"
          : "已重置为待同步",
        "success"
      );
      setResolveDialog(null);
      refreshAll();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "操作失败", "error");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确定要删除这条记录吗？")) return;
    try {
      await api.deleteOfflineSignoff(id);
      toast("删除成功", "success");
      refreshAll();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "删除失败", "error");
    }
  };

  const handleExport = async () => {
    try {
      await api.exportOfflineSignoffs();
      toast("导出成功", "success");
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "导出失败", "error");
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        const recordsToImport = data.records || data;

        if (!Array.isArray(recordsToImport)) {
          toast("无效的导入文件格式", "error");
          return;
        }

        if (!confirm(`确定要导入 ${recordsToImport.length} 条记录吗？`)) {
          return;
        }

        api
          .importOfflineSignoffs(recordsToImport)
          .then((result) => {
            toast(
              `导入完成：成功 ${result.imported} 条，跳过 ${result.skipped} 条`,
              result.skipped > 0 ? "info" : "success"
            );
            refreshAll();
          })
          .catch((err: Error) => {
            toast(err.message || "导入失败", "error");
          });
      } catch {
        toast("文件解析失败，请确认是合法的 JSON 文件", "error");
      }
    };
    reader.readAsText(file);

    e.target.value = "";
  };

  const STAT_CARDS = [
    { key: "pending", label: "待同步", color: "bg-amber-50 border-amber-200 text-amber-700", count: stats?.pending || 0 },
    { key: "syncing", label: "同步中", color: "bg-blue-50 border-blue-200 text-blue-700", count: stats?.syncing || 0 },
    { key: "failed", label: "同步失败", color: "bg-red-50 border-red-200 text-red-700", count: stats?.failed || 0 },
    { key: "completed", label: "已完成", color: "bg-green-50 border-green-200 text-green-700", count: stats?.completed || 0 },
  ];

  const getEmptyIcon = () => {
    switch (activeTab) {
      case "pending":
        return <Clock className="w-12 h-12 mx-auto opacity-50" />;
      case "failed":
        return <AlertTriangle className="w-12 h-12 mx-auto opacity-50" />;
      case "completed":
        return <CheckCircle className="w-12 h-12 mx-auto opacity-50" />;
      case "syncing":
        return <RefreshCw className="w-12 h-12 mx-auto opacity-50 animate-spin" />;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-gray-900">离线补录台</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleBatchSync}
            disabled={syncing || (stats?.pending || 0) + (stats?.failed || 0) === 0}
            className="btn-primary flex items-center gap-1.5 text-sm"
          >
            <Play className="w-4 h-4" />
            {syncing ? "同步中..." : "批量同步"}
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="btn-primary flex items-center gap-1.5 text-sm"
          >
            <Plus className="w-4 h-4" />
            新增补录
          </button>
          {isAdmin && (
            <>
              <button
                onClick={handleExport}
                className="btn-outline flex items-center gap-1.5 text-sm"
              >
                <Download className="w-4 h-4" />
                导出 JSON
              </button>
              <button
                onClick={handleImportClick}
                className="btn-outline flex items-center gap-1.5 text-sm"
              >
                <Upload className="w-4 h-4" />
                导入 JSON
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileChange}
                className="hidden"
              />
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {STAT_CARDS.map((stat) => (
          <button
            key={stat.key}
            onClick={() => setActiveTab(stat.key as TabKey)}
            className={`${stat.color} border rounded-xl p-4 cursor-pointer transition-all hover:shadow-sm ${
              activeTab === stat.key ? "ring-2 ring-offset-1 ring-current" : ""
            }`}
          >
            <div className="text-sm font-medium opacity-80">{stat.label}</div>
            <div className="text-2xl font-bold mt-1">{stat.count}</div>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="flex border-b border-gray-100 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? "border-teal-700 text-teal-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <tab.icon className="w-4 h-4" />
                {tab.label}
                <span
                  className={`px-1.5 py-0.5 rounded text-xs rounded-full ${
                    activeTab === tab.key
                      ? "bg-teal-100 text-teal-700"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {stats?.[tab.key] || 0}
                </span>
              </div>
            </button>
          ))}
        </div>

        <div className="p-5">
          {loading ? (
            <div className="text-center py-8 text-gray-400">加载中...</div>
          ) : records.length === 0 ? (
            <div className="text-center py-12 text-gray-300">
              {getEmptyIcon()}
              <p className="text-gray-400 mt-2">
                暂无{OFFLINE_SIGNOFF_STATUS_LABELS[activeTab]}记录
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {records.map((record) => (
                <div
                  key={record.id}
                  className={`rounded-lg border ${
                    record.status === "failed"
                      ? "border-red-200 bg-red-50/30"
                      : record.status === "completed"
                      ? "border-green-200 bg-green-50/30"
                      : "border-gray-100 bg-white"
                  }`}
                >
                  <div className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${OFFLINE_SIGNOFF_TYPE_COLORS[record.type]}`}
                          >
                            {OFFLINE_SIGNOFF_TYPE_LABELS[record.type]}
                          </span>
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${OFFLINE_SIGNOFF_STATUS_COLORS[record.status]}`}
                          >
                            {OFFLINE_SIGNOFF_STATUS_LABELS[record.status]}
                          </span>
                          <span className="text-sm font-medium text-gray-900">
                            {record.equipment_snapshot?.name ||
                              `设备 #${record.equipment_id}`}
                          </span>
                        </div>

                        <div className="text-sm text-gray-600">
                          <User className="w-3.5 h-3.5 inline mr-1" />
                          {record.borrower_name}（{record.borrower_phone}）
                        </div>

                        {record.signer_name && (
                          <div className="text-xs text-gray-500">
                            签收人：{record.signer_name}
                          </div>
                        )}

                        {record.damage_description && (
                          <div className="text-xs text-gray-500">
                            <StickyNote className="w-3.5 h-3.5 inline mr-1" />
                            损坏描述：{record.damage_description}
                          </div>
                        )}

                        {record.notes && (
                          <div className="text-xs text-gray-500">
                            <StickyNote className="w-3.5 h-3.5 inline mr-1" />
                            备注：{record.notes}
                          </div>
                        )}

                        {record.status === "failed" && record.error_message && (
                          <div className="text-xs text-red-600 flex items-center gap-1">
                            <AlertOctagon className="w-3.5 h-3.5" />
                            失败原因：{record.error_message}
                          </div>
                        )}

                        {record.conflict_info && (
                          <div className="text-xs text-orange-600 flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            冲突类型：{record.conflict_info.type}
                          </div>
                        )}

                        <div className="text-xs text-gray-400">
                          登记人：{record.operator_name} · {formatDate(record.created_at)}
                          {record.synced_at && ` · 同步时间：${formatDate(record.synced_at)}`}
                          {record.server_record_id &&
                            ` · 服务端记录 #${record.server_record_id}`}
                        </div>
                      </div>

                      <div className="flex flex-col gap-1.5 flex-shrink-0">
                        {(record.status === "pending" || record.status === "failed") && (
                          <button
                            onClick={() => handleSync(record.id)}
                            className="p-1.5 text-teal-600 hover:text-teal-800 hover:bg-teal-50 rounded"
                            title="同步"
                          >
                            <Play className="w-4 h-4" />
                          </button>
                        )}

                        {record.status === "failed" && isAdmin && (
                          <button
                            onClick={() => setResolveDialog(record)}
                            className="p-1.5 text-orange-500 hover:text-orange-700 hover:bg-orange-50 rounded"
                            title="解决冲突"
                          >
                            <AlertTriangle className="w-4 h-4" />
                          </button>
                        )}

                        <button
                          onClick={() => setDetailRecord(record)}
                          className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded"
                          title="查看详情"
                        >
                          <FileJson className="w-4 h-4" />
                        </button>

                        {isAdmin && record.status !== "syncing" && (
                          <button
                            onClick={() => handleDelete(record.id)}
                            className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                            title="删除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {record.equipment_snapshot && (
                      <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500">
                        <span className="text-gray-400">登记时设备状态：</span>
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            EQUIPMENT_STATUS_COLORS[
                              record.equipment_snapshot.status
                            ] || "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {EQUIPMENT_STATUS_LABELS[
                            record.equipment_snapshot.status
                          ] || record.equipment_snapshot.status}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold">新增补录记录</h2>
              <button
                onClick={() => setShowForm(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  记录类型
                </label>
                <div className="flex gap-2">
                  {FORM_TYPES.map((type) => (
                    <button
                      key={type.key}
                      onClick={() => {
                        setFormType(type.key);
                        setFormData({
                          ...formData,
                          equipment_id: 0,
                        });
                      }}
                      className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
                        formType === type.key
                          ? "bg-teal-50 border-teal-300 text-teal-700"
                          : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {type.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  选择设备
                </label>
                <select
                  value={formData.equipment_id}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      equipment_id: Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                >
                  <option value={0}>请选择设备</option>
                  {availableEquipmentsForForm
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((eq) => (
                      <option key={eq.id} value={eq.id}>
                        {eq.name}（{eq.type} - {EQUIPMENT_STATUS_LABELS[eq.status]}）
                      </option>
                    ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  {formType === "borrow"
                    ? "仅显示「可借」和「已预约」状态的设备"
                    : "仅显示「已借出」状态的设备"}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <User className="w-3 h-3 inline mr-1" />
                    借用人姓名
                  </label>
                  <input
                    type="text"
                    value={formData.borrower_name}
                    onChange={(e) =>
                      setFormData({ ...formData, borrower_name: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="请输入姓名"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <Phone className="w-3 h-3 inline mr-1" />
                    借用人电话
                  </label>
                  <input
                    type="text"
                    value={formData.borrower_phone}
                    onChange={(e) =>
                      setFormData({ ...formData, borrower_phone: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="请输入电话"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  签收人
                </label>
                <input
                  type="text"
                  value={formData.signer_name}
                  onChange={(e) =>
                    setFormData({ ...formData, signer_name: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="请输入签收人姓名（可选）"
                />
              </div>

              {formType === "damage" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    损坏描述
                  </label>
                  <textarea
                    value={formData.damage_description}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        damage_description: e.target.value,
                      })
                    }
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
                    placeholder="请描述损坏情况"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <StickyNote className="w-3 h-3 inline mr-1" />
                  备注
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData({ ...formData, notes: e.target.value })
                  }
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
                  placeholder="可选备注信息"
                />
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-sm text-yellow-800">
                <AlertTriangle className="w-4 h-4 inline mr-1.5 align-text-bottom" />
                此为离线补录记录，将在网络恢复后同步到主数据库。请确保信息准确。
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={() => setShowForm(false)}
                className="btn-outline"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="btn-primary"
              >
                {submitting ? "提交中..." : "确认提交"}
              </button>
            </div>
          </div>
        </div>
      )}

      {detailRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold">补录记录详情</h2>
              <button
                onClick={() => setDetailRecord(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-3">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${OFFLINE_SIGNOFF_TYPE_COLORS[detailRecord.type]}`}
                >
                  {OFFLINE_SIGNOFF_TYPE_LABELS[detailRecord.type]}
                </span>
                <span
                  className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${OFFLINE_SIGNOFF_STATUS_COLORS[detailRecord.status]}`}
                >
                  {OFFLINE_SIGNOFF_STATUS_LABELS[detailRecord.status]}
                </span>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex">
                  <span className="text-gray-500 w-24 flex-shrink-0">设备：</span>
                  <span className="text-gray-900">
                    {detailRecord.equipment_snapshot?.name ||
                      `设备 #${detailRecord.equipment_id}`}
                  </span>
                </div>
                <div className="flex">
                  <span className="text-gray-500 w-24 flex-shrink-0">借用人：</span>
                  <span className="text-gray-900">
                    {detailRecord.borrower_name}
                  </span>
                </div>
                <div className="flex">
                  <span className="text-gray-500 w-24 flex-shrink-0">联系电话：</span>
                  <span className="text-gray-900">
                    {detailRecord.borrower_phone}
                  </span>
                </div>
                {detailRecord.signer_name && (
                  <div className="flex">
                    <span className="text-gray-500 w-24 flex-shrink-0">签收人：</span>
                    <span className="text-gray-900">
                      {detailRecord.signer_name}
                    </span>
                  </div>
                )}
                {detailRecord.damage_description && (
                  <div className="flex">
                    <span className="text-gray-500 w-24 flex-shrink-0">
                      损坏描述：
                    </span>
                    <span className="text-gray-900">
                      {detailRecord.damage_description}
                    </span>
                  </div>
                )}
                {detailRecord.notes && (
                  <div className="flex">
                    <span className="text-gray-500 w-24 flex-shrink-0">备注：</span>
                    <span className="text-gray-900">{detailRecord.notes}</span>
                  </div>
                )}
                <div className="flex">
                  <span className="text-gray-500 w-24 flex-shrink-0">登记人：</span>
                  <span className="text-gray-900">
                    {detailRecord.operator_name}
                  </span>
                </div>
                <div className="flex">
                  <span className="text-gray-500 w-24 flex-shrink-0">登记时间：</span>
                  <span className="text-gray-900">
                    {formatDate(detailRecord.created_at)}
                  </span>
                </div>
                {detailRecord.synced_at && (
                  <div className="flex">
                    <span className="text-gray-500 w-24 flex-shrink-0">同步时间：</span>
                    <span className="text-gray-900">
                      {formatDate(detailRecord.synced_at)}
                    </span>
                  </div>
                )}
                {detailRecord.server_record_id && (
                  <div className="flex">
                    <span className="text-gray-500 w-24 flex-shrink-0">
                      服务端记录：
                    </span>
                    <span className="text-gray-900">
                      #{detailRecord.server_record_id}
                    </span>
                  </div>
                )}
                {detailRecord.error_message && (
                  <div className="flex text-red-600">
                    <span className="w-24 flex-shrink-0">失败原因：</span>
                    <span>{detailRecord.error_message}</span>
                  </div>
                )}
                {detailRecord.conflict_info && (
                  <div className="text-orange-600">
                    <div className="font-medium mb-1">冲突信息：</div>
                    <pre className="text-xs bg-orange-50 p-2 rounded overflow-auto">
                      {JSON.stringify(detailRecord.conflict_info, null, 2)}
                    </pre>
                  </div>
                )}
                {detailRecord.equipment_snapshot && (
                  <div className="text-gray-500">
                    <div className="font-medium mb-1">登记时设备快照：</div>
                    <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto text-gray-700">
                      {JSON.stringify(detailRecord.equipment_snapshot, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setDetailRecord(null)}
                className="btn-primary"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {resolveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-orange-500" />
                解决冲突
              </h2>
              <button
                onClick={() => setResolveDialog(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 text-sm text-orange-800">
                <div className="font-medium mb-1">
                  冲突类型：{resolveDialog.conflict_info?.type || "未知冲突"}
                </div>
                {resolveDialog.error_message && (
                  <div className="text-orange-700">
                    {resolveDialog.error_message}
                  </div>
                )}
                {resolveDialog.conflict_info?.snapshot_status && (
                  <div className="text-xs mt-2 text-orange-600">
                    登记时状态：{resolveDialog.conflict_info.snapshot_status}
                  </div>
                )}
                {resolveDialog.conflict_info?.current_status && (
                  <div className="text-xs text-orange-600">
                    当前状态：{resolveDialog.conflict_info.current_status}
                  </div>
                )}
              </div>

              <p className="text-sm text-gray-600">请选择处理方式：</p>

              <div className="space-y-2">
                <button
                  onClick={() => handleResolve(resolveDialog, "retry")}
                  className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                >
                  <div className="font-medium text-gray-900">重试同步</div>
                  <div className="text-xs text-gray-500">
                    将记录重置为待同步状态，可再次尝试同步
                  </div>
                </button>

                <button
                  onClick={() => handleResolve(resolveDialog, "force")}
                  className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                >
                  <div className="font-medium text-gray-900">强制同步</div>
                  <div className="text-xs text-gray-500">
                    忽略冲突，强制写入主数据（可能覆盖当前状态）
                  </div>
                </button>

                <button
                  onClick={() => handleResolve(resolveDialog, "discard")}
                  className="w-full text-left px-4 py-3 rounded-lg border border-red-200 hover:bg-red-50 transition-colors"
                >
                  <div className="font-medium text-red-600">放弃记录</div>
                  <div className="text-xs text-red-500">
                    删除该条补录记录，不同步到主数据
                  </div>
                </button>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setResolveDialog(null)}
                className="btn-outline"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
