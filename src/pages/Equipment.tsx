import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus,
  Search,
  Download,
  Save,
  Trash2,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Settings,
  RotateCcw,
  BookmarkPlus,
  Bookmark,
  X,
  Check,
  ArrowUpDown,
  History,
  Camera,
  AlertTriangle,
  Clock,
  User,
} from "lucide-react";
import { api } from "@/utils/api";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/components/Toast";
import {
  formatAmount,
  EQUIPMENT_STATUS_LABELS,
  EQUIPMENT_STATUS_COLORS,
} from "@/utils/helpers";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import type { Equipment, SavedView, ViewSnapshot } from "@/types";
import EquipmentModal from "@/components/EquipmentModal";
import EquipmentDetailDrawer from "@/components/EquipmentDetailDrawer";

const STATUS_TABS = [
  { value: "", label: "全部" },
  { value: "available", label: "可用" },
  { value: "borrowed", label: "已借出" },
  { value: "damaged", label: "已损坏" },
  { value: "pending_confirm", label: "待确认" },
];

const ALL_COLUMNS = [
  { key: "name", label: "名称" },
  { key: "type", label: "类型" },
  { key: "status", label: "状态" },
  { key: "deposit_amount", label: "押金金额" },
  { key: "notes", label: "备注" },
  { key: "created_at", label: "创建时间" },
];

const DEFAULT_VISIBLE_COLUMNS = ["name", "type", "status", "deposit_amount"];

interface EquipmentsResponse {
  data: Equipment[];
  total: number;
  page: number;
  page_size: number;
}

export default function EquipmentPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === "admin";

  const [equipments, setEquipments] = useState<Equipment[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useLocalStorage<string>(
    "equipment_filter_status",
    ""
  );
  const [nameSearch, setNameSearch] = useLocalStorage<string>(
    "equipment_filter_name",
    ""
  );
  const [typeFilter, setTypeFilter] = useLocalStorage<string>(
    "equipment_filter_type",
    ""
  );
  const [sortBy, setSortBy] = useLocalStorage<string | null>(
    "equipment_sort_by",
    null
  );
  const [sortOrder, setSortOrder] = useLocalStorage<"asc" | "desc">(
    "equipment_sort_order",
    "desc"
  );
  const [currentPage, setCurrentPage] = useLocalStorage<number>(
    "equipment_page",
    1
  );
  const [pageSize, setPageSize] = useLocalStorage<number>(
    "equipment_page_size",
    20
  );
  const [visibleColumns, setVisibleColumns] = useLocalStorage<string[]>(
    "equipment_visible_columns",
    DEFAULT_VISIBLE_COLUMNS
  );

  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useLocalStorage<number | null>(
    "equipment_active_view_id",
    null
  );
  const [appliedReadOnlyViewId, setAppliedReadOnlyViewId] = useLocalStorage<number | null>(
    "equipment_applied_readonly_view_id",
    null
  );
  const [appliedReadOnlyView, setAppliedReadOnlyView] = useState<SavedView | null>(null);
  const [activeViewVersion, setActiveViewVersion] = useLocalStorage<number | null>(
    "equipment_active_view_version",
    null
  );
  const [showViewDropdown, setShowViewDropdown] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [showSnapshotDialog, setShowSnapshotDialog] = useState(false);
  const [showUpdateRemarkDialog, setShowUpdateRemarkDialog] = useState(false);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [conflictInfo, setConflictInfo] = useState<any>(null);
  const [saveViewName, setSaveViewName] = useState("");
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [updateRemark, setUpdateRemark] = useState("");
  const [snapshots, setSnapshots] = useState<ViewSnapshot[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [snapshotTargetView, setSnapshotTargetView] = useState<SavedView | null>(null);
  const [viewModified, setViewModified] = useLocalStorage<boolean>(
    "equipment_view_modified",
    false
  );

  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<Equipment | null>(null);
  const [showDrawer, setShowDrawer] = useState(false);
  const [drawerDetail, setDrawerDetail] = useState<any>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const loadViews = useCallback(async () => {
    if (!user) return;
    try {
      const views = await api.getViews("equipments", true);
      setSavedViews(views);
      return views;
    } catch (err) {
      toast(err instanceof Error ? err.message : "加载视图方案失败", "error");
      return [] as SavedView[];
    }
  }, [user]);

  const applyViewToState = useCallback(
    (view: SavedView) => {
      setStatusFilter(view.filters.status || "");
      setNameSearch(view.filters.name || "");
      setTypeFilter(view.filters.type || "");
      setSortBy(view.sort_by);
      setSortOrder(view.sort_order || "desc");
      setPageSize(view.page_size || 20);
      setCurrentPage(1);
      if (view.visible_columns && view.visible_columns.length > 0) {
        setVisibleColumns(view.visible_columns);
      } else {
        setVisibleColumns(DEFAULT_VISIBLE_COLUMNS);
      }
    },
    [
      setStatusFilter,
      setNameSearch,
      setTypeFilter,
      setSortBy,
      setSortOrder,
      setPageSize,
      setCurrentPage,
      setVisibleColumns,
    ]
  );

  const resetToDefaultView = useCallback(() => {
    setStatusFilter("");
    setNameSearch("");
    setTypeFilter("");
    setSortBy(null);
    setSortOrder("desc");
    setPageSize(20);
    setCurrentPage(1);
    setVisibleColumns(DEFAULT_VISIBLE_COLUMNS);
    setActiveViewId(null);
    setAppliedReadOnlyView(null);
    setAppliedReadOnlyViewId(null);
    setActiveViewVersion(null);
    setViewModified(false);
  }, [
    setStatusFilter,
    setNameSearch,
    setTypeFilter,
    setSortBy,
    setSortOrder,
    setPageSize,
    setCurrentPage,
    setVisibleColumns,
    setActiveViewId,
    setAppliedReadOnlyView,
    setAppliedReadOnlyViewId,
    setActiveViewVersion,
    setViewModified,
  ]);

  const currentFiltersMatchView = useCallback(
    (view: SavedView | null): boolean => {
      if (!view) return false;
      const f = view.filters;
      if ((f.status || "") !== statusFilter) return false;
      if ((f.name || "") !== nameSearch) return false;
      if ((f.type || "") !== typeFilter) return false;
      if ((view.sort_by || null) !== sortBy) return false;
      if ((view.sort_order || "desc") !== sortOrder) return false;
      if ((view.page_size || 20) !== pageSize) return false;
      const vc = view.visible_columns || DEFAULT_VISIBLE_COLUMNS;
      if (vc.length !== visibleColumns.length) return false;
      if (!vc.every((c) => visibleColumns.includes(c))) return false;
      return true;
    },
    [statusFilter, nameSearch, typeFilter, sortBy, sortOrder, pageSize, visibleColumns]
  );

  const markViewModifiedIfNeeded = useCallback(() => {
    const currentView = activeViewId
      ? savedViews.find((v) => v.id === activeViewId) || null
      : appliedReadOnlyView;
    if (currentView) {
      const matches = currentFiltersMatchView(currentView);
      setViewModified(!matches);
    } else {
      setViewModified(false);
    }
  }, [activeViewId, savedViews, appliedReadOnlyView, currentFiltersMatchView, setViewModified]);

  const revertToViewOriginal = useCallback(() => {
    const currentView = activeViewId
      ? savedViews.find((v) => v.id === activeViewId) || null
      : appliedReadOnlyView;
    if (currentView) {
      applyViewToState(currentView);
      setViewModified(false);
      toast("已恢复到方案原始条件", "success");
    }
  }, [activeViewId, savedViews, appliedReadOnlyView, applyViewToState, setViewModified]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const init = async () => {
      const views = await loadViews();
      if (cancelled || !views || views.length === 0) return;

      if (appliedReadOnlyViewId) {
        const matched = views.find((v) => v.id === appliedReadOnlyViewId && !v.is_owner);
        if (matched) {
          applyViewToState(matched);
          setAppliedReadOnlyView(matched);
          setActiveViewId(null);
          setActiveViewVersion(null);
          setViewModified(false);
          return;
        }
      }

      if (activeViewId) {
        const matched = views.find((v) => v.id === activeViewId && v.is_owner);
        if (matched) {
          applyViewToState(matched);
          setActiveViewVersion(matched.version);
          setViewModified(false);
          return;
        }
      }

      const defaultView = views.find((v) => v.is_default && v.is_owner);
      if (defaultView) {
        applyViewToState(defaultView);
        setActiveViewId(defaultView.id);
        setActiveViewVersion(defaultView.version);
        setViewModified(false);
        return;
      }

      setActiveViewId(null);
      setAppliedReadOnlyViewId(null);
      setActiveViewVersion(null);
      setViewModified(false);
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [user, loadViews, applyViewToState, activeViewId, appliedReadOnlyViewId]);

  const fetchEquipments = useCallback(async () => {
    setLoading(true);
    try {
      const res: EquipmentsResponse = await api.getEquipments({
        status: statusFilter || undefined,
        name: nameSearch || undefined,
        type: typeFilter || undefined,
        sort_by: sortBy || undefined,
        sort_order: sortOrder,
        page: currentPage,
        page_size: pageSize,
      });
      setEquipments(res.data);
      setTotalCount(res.total);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "加载失败", "error");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, nameSearch, typeFilter, sortBy, sortOrder, currentPage, pageSize]);

  useEffect(() => {
    fetchEquipments();
  }, [fetchEquipments]);

  useEffect(() => {
    markViewModifiedIfNeeded();
  }, [markViewModifiedIfNeeded]);

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
        sort_by: sortBy || undefined,
        sort_order: sortOrder,
      });
      toast("导出成功", "success");
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "导出失败", "error");
    }
  };

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setSortOrder("asc");
    }
    // 不切回默认方案，仅标记 modified（由 useEffect 自动处理）
  };

  const handleSaveView = async () => {
    if (!saveViewName.trim()) {
      toast("请输入方案名称", "error");
      return;
    }
    try {
      const filters: Record<string, string> = {};
      if (statusFilter) filters.status = statusFilter;
      if (nameSearch) filters.name = nameSearch;
      if (typeFilter) filters.type = typeFilter;

      const newView = await api.createView({
        page: "equipments",
        name: saveViewName.trim(),
        filters,
        sort_by: sortBy,
        sort_order: sortOrder,
        page_size: pageSize,
        visible_columns: visibleColumns,
        is_default: saveAsDefault,
      });
      toast(`方案「${newView.name}」保存成功`, "success");
      setShowSaveDialog(false);
      setSaveViewName("");
      setSaveAsDefault(false);
      setActiveViewId(newView.id);
      setActiveViewVersion(newView.version);
      setAppliedReadOnlyView(null);
      setAppliedReadOnlyViewId(null);
      setViewModified(false);
      await loadViews();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "保存失败", "error");
    }
  };

  const handleUpdateView = async () => {
    if (!activeViewId) return;
    const activeView = savedViews.find((v) => v.id === activeViewId);
    if (!activeView || !activeView.is_owner) {
      toast("只能修改自己创建的方案", "error");
      return;
    }
    setSnapshotTargetView(activeView);
    setUpdateRemark("");
    setShowUpdateRemarkDialog(true);
  };

  const confirmUpdateView = async () => {
    if (!activeViewId || !snapshotTargetView) return;

    try {
      const filters: Record<string, string> = {};
      if (statusFilter) filters.status = statusFilter;
      if (nameSearch) filters.name = nameSearch;
      if (typeFilter) filters.type = typeFilter;

      const res = await api.updateView(activeViewId, {
        filters,
        sort_by: sortBy,
        sort_order: sortOrder,
        page_size: pageSize,
        visible_columns: visibleColumns,
        expected_version: activeViewVersion ?? undefined,
        snapshot_remark: updateRemark.trim() || undefined,
      });
      setActiveViewVersion(res.data.version);
      if (res.snapshot_created) {
        toast(`方案更新成功（已创建快照 #${res.snapshot_created}）`, "success");
      } else {
        toast("当前方案已更新", "success");
      }
      setAppliedReadOnlyView(null);
      setAppliedReadOnlyViewId(null);
      setShowUpdateRemarkDialog(false);
      setSnapshotTargetView(null);
      setUpdateRemark("");
      setViewModified(false);
      await loadViews();
    } catch (err: any) {
      if (err?.conflict) {
        setConflictInfo(err.conflict);
        setShowConflictDialog(true);
      } else {
        toast(err instanceof Error ? err.message : "更新失败", "error");
      }
    }
  };

  const handleDeleteView = async (viewId: number) => {
    const view = savedViews.find((v) => v.id === viewId);
    if (!view || !view.is_owner) {
      toast("只能删除自己创建的方案", "error");
      return;
    }
    try {
      await api.deleteView(viewId);
      toast("方案已删除", "success");
      if (viewId === activeViewId) {
        resetToDefaultView();
      }
      if (appliedReadOnlyView?.id === viewId) {
        setAppliedReadOnlyView(null);
        setAppliedReadOnlyViewId(null);
      }
      await loadViews();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "删除失败", "error");
    }
  };

  const handleApplyView = async (view: SavedView) => {
    try {
      await api.applyView(view.id);
      applyViewToState(view);
      if (view.is_owner) {
        setActiveViewId(view.id);
        setActiveViewVersion(view.version);
        setAppliedReadOnlyView(null);
        setAppliedReadOnlyViewId(null);
        setViewModified(false);
        toast(`已应用方案「${view.name}」(v${view.version})`, "success");
      } else {
        setActiveViewId(null);
        setActiveViewVersion(null);
        setAppliedReadOnlyView(view);
        setAppliedReadOnlyViewId(view.id);
        setViewModified(false);
        toast(`已套用他人方案「${view.name}」（只读，如需保存请另存为新方案）`, "info");
      }
      setShowViewDropdown(false);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "应用方案失败", "error");
    }
  };

  const openSnapshotDialog = async (view: SavedView) => {
    setSnapshotTargetView(view);
    setShowSnapshotDialog(true);
    setSnapshotsLoading(true);
    try {
      const data = await api.getViewSnapshots(view.id);
      setSnapshots(data);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "加载快照失败", "error");
      setSnapshots([]);
    } finally {
      setSnapshotsLoading(false);
    }
  };

  const handleRollback = async (snapshot: ViewSnapshot) => {
    if (!snapshotTargetView) return;
    if (!confirm(`确定要将方案「${snapshotTargetView.name}」回滚到快照 #${snapshot.id} 吗？\n备注：${snapshot.remark || '(无)'}`)) {
      return;
    }
    try {
      const res = await api.rollbackView(snapshotTargetView.id, snapshot.id);
      toast(
        `回滚成功！已恢复到版本 ${snapshot.version}（当前版本 v${res.data.version}）`,
        "success"
      );
      if (snapshotTargetView.id === activeViewId) {
        applyViewToState(res.data);
        setActiveViewVersion(res.data.version);
      }
      if (snapshotTargetView.id === appliedReadOnlyViewId) {
        const isOwner = res.data.is_owner;
        applyViewToState(res.data);
        if (!isOwner) {
          setAppliedReadOnlyView(res.data);
        }
      }
      setShowSnapshotDialog(false);
      setSnapshotTargetView(null);
      setViewModified(false);
      await loadViews();
      fetchEquipments();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "回滚失败", "error");
    }
  };

  const handleManualSnapshot = async (view: SavedView) => {
    const remark = prompt("请输入快照备注（可选）：") || "";
    try {
      const snapshot = await api.createViewSnapshot(view.id, remark);
      toast(`快照 #${snapshot.id} 创建成功`, "success");
      if (showSnapshotDialog && snapshotTargetView?.id === view.id) {
        setSnapshots((prev) => [snapshot, ...prev]);
      }
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "创建快照失败", "error");
    }
  };

  const toggleColumn = (col: string) => {
    if (visibleColumns.includes(col)) {
      if (visibleColumns.length > 1) {
        setVisibleColumns(visibleColumns.filter((c) => c !== col));
      } else {
        toast("至少保留一列", "error");
        return;
      }
    } else {
      setVisibleColumns([...visibleColumns, col]);
    }
    // 不切回默认方案，仅标记 modified（由 useEffect 自动处理）
  };

  const uniqueTypes = useMemo(
    () => [...new Set(equipments.map((e) => e.type))].filter(Boolean),
    [equipments]
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const activeView = savedViews.find((v) => v.id === activeViewId) || null;
  const myViews = useMemo(
    () => savedViews.filter((v) => v.is_owner),
    [savedViews]
  );
  const otherViews = useMemo(
    () => savedViews.filter((v) => !v.is_owner),
    [savedViews]
  );

  const getSortIcon = (col: string) => {
    if (sortBy !== col)
      return <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />;
    return sortOrder === "asc" ? (
      <ChevronUp className="w-3.5 h-3.5 text-teal-700" />
    ) : (
      <ChevronDown className="w-3.5 h-3.5 text-teal-700" />
    );
  };

  const currentViewDisplay = () => {
    if (activeView) {
      const modifiedBadge = viewModified ? (
        <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 border border-amber-200">
          已修改
        </span>
      ) : null;
      return {
        icon: <Bookmark className="w-4 h-4 text-teal-700" />,
        text: (
          <>
            {activeView.name} <span className="font-mono text-xs opacity-80">v{activeView.version}</span>
            {modifiedBadge}
          </>
        ),
        textClass: "text-teal-700 font-medium",
      };
    }
    if (appliedReadOnlyView) {
      const modifiedBadge = viewModified ? (
        <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 border border-amber-200">
          已修改
        </span>
      ) : null;
      return {
        icon: <Bookmark className="w-4 h-4 text-gray-500" />,
        text: (
          <>
            {appliedReadOnlyView.name}
            <span className="ml-1 text-xs opacity-70">（只读）</span>
            {modifiedBadge}
          </>
        ),
        textClass: "text-gray-600",
      };
    }
    return {
      icon: <BookmarkPlus className="w-4 h-4" />,
      text: "视图方案",
      textClass: "",
    };
  };

  const currentViewForPanel = activeView || appliedReadOnlyView;

  const viewInfoPanel = currentViewForPanel ? (
    <div className="bg-gradient-to-r from-teal-50 to-white border border-teal-100 rounded-xl p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Bookmark
                className={`w-5 h-5 ${
                  currentViewForPanel.is_owner ? "text-teal-600" : "text-gray-500"
                }`}
              />
              <span
                className={`text-base font-semibold ${
                  currentViewForPanel.is_owner ? "text-teal-900" : "text-gray-700"
                }`}
              >
                {currentViewForPanel.name}
              </span>
            </div>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-teal-100 text-teal-700">
              v{currentViewForPanel.version}
            </span>
            {!currentViewForPanel.is_owner && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
                只读共享
              </span>
            )}
            {viewModified && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200">
                <AlertTriangle className="w-3 h-3 mr-1" />
                当前条件已偏离方案
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div className="flex items-center gap-1.5 text-gray-600">
              <Clock className="w-3.5 h-3.5 text-gray-400" />
              <span>更新于 {currentViewForPanel.updated_at}</span>
            </div>
            <div className="flex items-center gap-1.5 text-gray-600">
              <User className="w-3.5 h-3.5 text-gray-400" />
              <span>
                {currentViewForPanel.is_owner
                  ? "我创建的方案"
                  : `他人共享方案`}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-gray-600">
              <Settings className="w-3.5 h-3.5 text-gray-400" />
              <span>
                排序: {currentViewForPanel.sort_by
                  ? `${currentViewForPanel.sort_by} ${currentViewForPanel.sort_order || "desc"}`
                  : "默认"}
                {" · "}分页: {currentViewForPanel.page_size || 20}/页
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-gray-500">当前筛选条件:</span>
            {Object.keys(currentViewForPanel.filters).length === 0 ? (
              <span className="text-gray-400 italic">（无筛选）</span>
            ) : (
              Object.entries(currentViewForPanel.filters).map(([k, v]) => (
                <span
                  key={k}
                  className="inline-flex items-center px-2 py-0.5 rounded bg-white border border-gray-200 text-gray-700"
                >
                  <span className="text-gray-500 mr-1">{k}:</span>
                  <span className="font-medium">{String(v)}</span>
                </span>
              ))
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {viewModified && (
            <button
              onClick={revertToViewOriginal}
              className="px-3 py-1.5 text-xs bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 flex items-center gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              撤销修改
            </button>
          )}
          {currentViewForPanel.is_owner && (
            <>
              <button
                onClick={() => openSnapshotDialog(currentViewForPanel)}
                className="px-3 py-1.5 text-xs bg-white border border-indigo-200 text-indigo-700 rounded-lg hover:bg-indigo-50 flex items-center gap-1"
              >
                <History className="w-3.5 h-3.5" />
                版本历史
              </button>
              <button
                onClick={handleUpdateView}
                className="px-3 py-1.5 text-xs bg-teal-700 text-white rounded-lg hover:bg-teal-800 flex items-center gap-1"
              >
                <Save className="w-3.5 h-3.5" />
                保存为新版本
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-gray-900">
          设备台账
          {totalCount > 0 && (
            <span className="ml-2 text-sm font-normal text-gray-500">
              共 {totalCount} 条
            </span>
          )}
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <button
              onClick={() => setShowViewDropdown(!showViewDropdown)}
              className="btn-outline flex items-center gap-1.5 text-sm"
            >
              <>
                {currentViewDisplay().icon}
                <span className={currentViewDisplay().textClass}>
                  {currentViewDisplay().text}
                </span>
              </>
              <ChevronDown className="w-4 h-4" />
            </button>
            {showViewDropdown && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowViewDropdown(false)}
                />
                <div className="absolute right-0 top-full mt-1 w-72 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                  <div className="px-3 py-2 border-b border-gray-100">
                    <button
                      onClick={() => {
                        resetToDefaultView();
                        setShowViewDropdown(false);
                      }}
                      className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 ${
                        !activeViewId && !appliedReadOnlyView
                          ? "bg-teal-50 text-teal-700 font-medium"
                          : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <RotateCcw className="w-4 h-4" />
                      默认视图
                    </button>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {myViews.length > 0 && (
                      <div>
                        <div className="px-3 py-1.5 text-xs font-medium text-gray-400 uppercase tracking-wider">
                          我的方案
                        </div>
                        {myViews.map((view) => (
                          <div
                            key={view.id}
                            className={`px-3 py-2 flex items-center justify-between group ${
                              view.id === activeViewId ? "bg-teal-50" : "hover:bg-gray-50"
                            }`}
                          >
                            <button
                              onClick={() => handleApplyView(view)}
                              className="flex-1 text-left flex items-center gap-1.5"
                            >
                              <Bookmark
                                className={`w-4 h-4 ${
                                  view.id === activeViewId
                                    ? "text-teal-700"
                                    : "text-gray-400"
                                }`}
                              />
                              <div className="flex flex-col items-start">
                                <span
                                  className={`text-sm ${
                                    view.id === activeViewId
                                      ? "text-teal-700 font-medium"
                                      : "text-gray-700"
                                  }`}
                                >
                                  {view.name}
                                  {view.is_default && (
                                    <span className="ml-1 text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                                      默认
                                    </span>
                                  )}
                                </span>
                                <span className="text-xs text-gray-400">v{view.version}</span>
                              </div>
                            </button>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openSnapshotDialog(view);
                                  setShowViewDropdown(false);
                                }}
                                className="p-1 text-gray-400 hover:text-indigo-500"
                                title="历史快照/回滚"
                              >
                                <History className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleManualSnapshot(view);
                                }}
                                className="p-1 text-gray-400 hover:text-teal-600"
                                title="创建快照"
                              >
                                <Camera className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (
                                    confirm(`确定要删除方案「${view.name}」吗？`)
                                  ) {
                                    handleDeleteView(view.id);
                                  }
                                }}
                                className="p-1 text-gray-400 hover:text-red-500"
                                title="删除方案"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {otherViews.length > 0 && (
                      <div className={myViews.length > 0 ? "border-t border-gray-100" : ""}>
                        <div className="px-3 py-1.5 text-xs font-medium text-gray-400 uppercase tracking-wider">
                          可套用方案
                        </div>
                        {otherViews.map((view) => (
                          <div
                            key={view.id}
                            className={`px-3 py-2 flex items-center justify-between group ${
                              appliedReadOnlyView?.id === view.id ? "bg-gray-100" : "hover:bg-gray-50"
                            }`}
                          >
                            <button
                              onClick={() => handleApplyView(view)}
                              className="flex-1 text-left flex items-center gap-1.5"
                            >
                              <Bookmark
                                className={`w-4 h-4 ${
                                  appliedReadOnlyView?.id === view.id
                                    ? "text-gray-600"
                                    : "text-gray-400"
                                }`}
                              />
                              <div className="flex flex-col items-start">
                                <span
                                  className={`text-sm ${
                                    appliedReadOnlyView?.id === view.id
                                      ? "text-gray-700 font-medium"
                                      : "text-gray-700"
                                  }`}
                                >
                                  {view.name}
                                </span>
                                <span className="text-xs text-gray-400">v{view.version} · 只读</span>
                              </div>
                            </button>
                            {isAdmin && (
                              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openSnapshotDialog(view);
                                    setShowViewDropdown(false);
                                  }}
                                  className="p-1 text-gray-400 hover:text-indigo-500"
                                  title="查看历史快照"
                                >
                                  <History className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="border-t border-gray-100 px-3 py-2 space-y-1">
                    <button
                      onClick={() => {
                        setShowSaveDialog(true);
                        setShowViewDropdown(false);
                      }}
                      className="w-full text-left px-2 py-1.5 rounded text-sm text-teal-700 hover:bg-teal-50 flex items-center gap-2"
                    >
                      <Save className="w-4 h-4" />
                      另存为新方案...
                    </button>
                    {activeView && activeView.is_owner && (
                      <button
                        onClick={() => {
                          handleUpdateView();
                          setShowViewDropdown(false);
                        }}
                        className="w-full text-left px-2 py-1.5 rounded text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                      >
                        <Check className="w-4 h-4" />
                        更新当前方案...
                      </button>
                    )}
                    {appliedReadOnlyView && (
                      <div className="px-2 py-1.5 text-xs text-gray-500 bg-gray-50 rounded">
                        已套用只读方案，修改后请「另存为新方案」
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => setShowColumnMenu(!showColumnMenu)}
              className="btn-outline flex items-center gap-1.5 text-sm"
              title="列显示设置"
            >
              <Settings className="w-4 h-4" />
              列设置
            </button>
            {showColumnMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowColumnMenu(false)}
                />
                <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                  {ALL_COLUMNS.map((col) => (
                    <label
                      key={col.key}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={visibleColumns.includes(col.key)}
                        onChange={() => toggleColumn(col.key)}
                        className="rounded border-gray-300 text-teal-700 focus:ring-teal-700"
                      />
                      {col.label}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>

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

      {viewInfoPanel}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center gap-3">
          <div className="flex gap-1">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => {
                  setStatusFilter(tab.value);
                  setCurrentPage(1);
                  // 不切回默认方案，仅标记 modified（由 useEffect 自动处理）
                }}
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
                onChange={(e) => {
                  setNameSearch(e.target.value);
                  setCurrentPage(1);
                  // 不切回默认方案，仅标记 modified（由 useEffect 自动处理）
                }}
                placeholder="搜索设备名称"
                className="pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-sm w-44"
              />
            </div>
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setCurrentPage(1);
                // 不切回默认方案，仅标记 modified（由 useEffect 自动处理）
              }}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white"
            >
              <option value="">全部类型</option>
              {uniqueTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600">
                {visibleColumns.includes("name") && (
                  <th
                    className="text-left px-5 py-3 font-medium cursor-pointer select-none hover:bg-gray-100 transition-colors"
                    onClick={() => handleSort("name")}
                  >
                    <span className="flex items-center gap-1">
                      名称
                      {getSortIcon("name")}
                    </span>
                  </th>
                )}
                {visibleColumns.includes("type") && (
                  <th
                    className="text-left px-5 py-3 font-medium cursor-pointer select-none hover:bg-gray-100 transition-colors"
                    onClick={() => handleSort("type")}
                  >
                    <span className="flex items-center gap-1">
                      类型
                      {getSortIcon("type")}
                    </span>
                  </th>
                )}
                {visibleColumns.includes("status") && (
                  <th
                    className="text-left px-5 py-3 font-medium cursor-pointer select-none hover:bg-gray-100 transition-colors"
                    onClick={() => handleSort("status")}
                  >
                    <span className="flex items-center gap-1">
                      状态
                      {getSortIcon("status")}
                    </span>
                  </th>
                )}
                {visibleColumns.includes("deposit_amount") && (
                  <th
                    className="text-left px-5 py-3 font-medium cursor-pointer select-none hover:bg-gray-100 transition-colors"
                    onClick={() => handleSort("deposit_amount")}
                  >
                    <span className="flex items-center gap-1">
                      押金金额
                      {getSortIcon("deposit_amount")}
                    </span>
                  </th>
                )}
                {visibleColumns.includes("notes") && (
                  <th className="text-left px-5 py-3 font-medium">备注</th>
                )}
                {visibleColumns.includes("created_at") && (
                  <th
                    className="text-left px-5 py-3 font-medium cursor-pointer select-none hover:bg-gray-100 transition-colors"
                    onClick={() => handleSort("created_at")}
                  >
                    <span className="flex items-center gap-1">
                      创建时间
                      {getSortIcon("created_at")}
                    </span>
                  </th>
                )}
                <th className="text-left px-5 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={visibleColumns.length + 1}
                    className="text-center py-12 text-gray-400"
                  >
                    加载中...
                  </td>
                </tr>
              ) : equipments.length === 0 ? (
                <tr>
                  <td
                    colSpan={visibleColumns.length + 1}
                    className="text-center py-12 text-gray-400"
                  >
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
                    {visibleColumns.includes("name") && (
                      <td className="px-5 py-3 font-medium text-gray-900">
                        {eq.name}
                      </td>
                    )}
                    {visibleColumns.includes("type") && (
                      <td className="px-5 py-3 text-gray-600">{eq.type}</td>
                    )}
                    {visibleColumns.includes("status") && (
                      <td className="px-5 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${EQUIPMENT_STATUS_COLORS[eq.status]}`}
                        >
                          {EQUIPMENT_STATUS_LABELS[eq.status]}
                        </span>
                      </td>
                    )}
                    {visibleColumns.includes("deposit_amount") && (
                      <td className="px-5 py-3 text-gray-900">
                        {formatAmount(eq.deposit_amount)}
                      </td>
                    )}
                    {visibleColumns.includes("notes") && (
                      <td className="px-5 py-3 text-gray-500 max-w-xs truncate">
                        {eq.notes || "-"}
                      </td>
                    )}
                    {visibleColumns.includes("created_at") && (
                      <td className="px-5 py-3 text-gray-500 text-xs">
                        {eq.created_at}
                      </td>
                    )}
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

        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>每页显示</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
                // 不切回默认方案，仅标记 modified（由 useEffect 自动处理）
              }}
              className="px-2 py-1 border border-gray-300 rounded text-sm bg-white"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span>条</span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="p-1.5 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 py-1 text-sm text-gray-600">
              第 {currentPage} / {totalPages} 页
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="p-1.5 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {showSaveDialog && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">保存视图方案</h3>
              <button
                onClick={() => setShowSaveDialog(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  方案名称
                </label>
                <input
                  type="text"
                  value={saveViewName}
                  onChange={(e) => setSaveViewName(e.target.value)}
                  placeholder="例如：仅看可用轮椅"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-700/30 focus:border-teal-700"
                  autoFocus
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveAsDefault}
                  onChange={(e) => setSaveAsDefault(e.target.checked)}
                  className="rounded border-gray-300 text-teal-700 focus:ring-teal-700"
                />
                设为默认方案（下次进入自动应用）
              </label>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={() => setShowSaveDialog(false)}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                取消
              </button>
              <button
                onClick={handleSaveView}
                className="px-4 py-2 text-sm text-white bg-teal-700 rounded-lg hover:bg-teal-800"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {showUpdateRemarkDialog && snapshotTargetView && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">更新方案「{snapshotTargetView.name}」</h3>
              <button
                onClick={() => {
                  setShowUpdateRemarkDialog(false);
                  setSnapshotTargetView(null);
                  setUpdateRemark("");
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                <Camera className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-amber-700">更新前将自动创建快照</p>
                  <p className="text-amber-600 mt-1">当前版本 v{activeViewVersion ?? snapshotTargetView.version}，可在下方填写备注以便日后追溯回滚。</p>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  快照备注（可选）
                </label>
                <textarea
                  value={updateRemark}
                  onChange={(e) => setUpdateRemark(e.target.value)}
                  placeholder="例如：调整为按押金降序展示"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-700/30 focus:border-teal-700 resize-none"
                  rows={3}
                />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowUpdateRemarkDialog(false);
                  setSnapshotTargetView(null);
                  setUpdateRemark("");
                }}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                取消
              </button>
              <button
                onClick={confirmUpdateView}
                className="px-4 py-2 text-sm text-white bg-teal-700 rounded-lg hover:bg-teal-800"
              >
                确认更新
              </button>
            </div>
          </div>
        </div>
      )}

      {showSnapshotDialog && snapshotTargetView && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">
                  历史快照 — 「{snapshotTargetView.name}」
                </h3>
                <p className="text-xs text-gray-500 mt-1">选择一个历史版本即可将方案回滚到该状态</p>
              </div>
              <div className="flex items-center gap-2">
                {snapshotTargetView.is_owner && (
                  <button
                    onClick={() => handleManualSnapshot(snapshotTargetView)}
                    className="px-3 py-1.5 text-xs bg-teal-50 text-teal-700 rounded-lg hover:bg-teal-100 flex items-center gap-1"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    新建快照
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowSnapshotDialog(false);
                    setSnapshotTargetView(null);
                    setSnapshots([]);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {snapshotsLoading ? (
                <div className="text-center py-12 text-gray-400">加载中...</div>
              ) : snapshots.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <History className="w-12 h-12 mx-auto mb-3 opacity-40" />
                  <p>暂无历史快照</p>
                  <p className="text-xs mt-1">每次更新方案都会自动创建快照</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {snapshots.map((s) => (
                    <div
                      key={s.id}
                      className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700">
                              快照 #{s.id}
                            </span>
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                              v{s.version}
                            </span>
                            <span className="text-xs text-gray-500 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {s.created_at}
                            </span>
                            <span className="text-xs text-gray-500 flex items-center gap-1">
                              <User className="w-3 h-3" />
                              {s.operator_name}
                            </span>
                          </div>
                          {s.remark && (
                            <p className="text-sm text-gray-700 mt-2 bg-gray-50 rounded p-2 border border-gray-100">
                              📝 {s.remark}
                            </p>
                          )}
                          <div className="mt-2 text-xs text-gray-500 space-y-0.5">
                            <p>筛选：{Object.keys(s.filters).length > 0 ? JSON.stringify(s.filters) : '(无)'}</p>
                            <p>排序：{s.sort_by ? `${s.sort_by} ${s.sort_order}` : '(默认)'}</p>
                            <p>分页：{s.page_size} 条/页</p>
                            <p>显示列：{s.visible_columns?.length ? s.visible_columns.join(', ') : '(默认)'}</p>
                          </div>
                        </div>
                        {snapshotTargetView.is_owner && (
                          <button
                            onClick={() => handleRollback(s)}
                            className="px-3 py-1.5 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 flex items-center gap-1 flex-shrink-0"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            回滚到此版本
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showConflictDialog && conflictInfo && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-5 py-4 border-b border-amber-200 bg-amber-50 flex items-center gap-3 rounded-t-xl">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-semibold text-amber-800">检测到并发冲突</h3>
                <p className="text-xs text-amber-700 mt-0.5">该方案已被他人修改过</p>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="text-sm text-gray-700 space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-500">您的版本：</span>
                  <span className="font-mono">v{conflictInfo.submitted_version}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">最新版本：</span>
                  <span className="font-mono font-medium text-red-600">v{conflictInfo.latest_version}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">最后更新：</span>
                  <span>{conflictInfo.latest_updated_at}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">修改者：</span>
                  <span>{conflictInfo.latest_operator.operator_name}</span>
                </div>
              </div>
              <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
                💡 建议：先刷新查看最新方案内容，确认是否需要合并对方的修改后再提交。您可以通过「历史快照」功能查看和回滚到任意历史版本。
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
              <button
                onClick={async () => {
                  setShowConflictDialog(false);
                  setConflictInfo(null);
                  await loadViews();
                }}
                className="px-4 py-2 text-sm text-white bg-teal-700 rounded-lg hover:bg-teal-800"
              >
                我知道了，刷新视图
              </button>
            </div>
          </div>
        </div>
      )}

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
          onRefresh={() => {
            if (drawerDetail?.equipment?.id) {
              handleRowClick(drawerDetail.equipment.id);
            }
            fetchEquipments();
          }}
        />
      )}
    </div>
  );
}
