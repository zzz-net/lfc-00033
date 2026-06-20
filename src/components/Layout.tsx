import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Package,
  ArrowLeftRight,
  Wallet,
  LogOut,
  Download,
  Stethoscope,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { api } from "@/utils/api";
import { toast } from "@/components/Toast";

const NAV_ITEMS = [
  { to: "/", label: "设备台账", icon: Package },
  { to: "/borrow-return", label: "借还操作", icon: ArrowLeftRight },
  { to: "/deposit-log", label: "押金流水", icon: Wallet },
];

const ADMIN_NAV_ITEMS = [
  { to: "#export-equipments", label: "导出设备", icon: Download, action: "exportEquipments" as const },
  { to: "#export-borrows", label: "导出借还", icon: Download, action: "exportBorrows" as const },
  { to: "#export-deposits", label: "导出押金", icon: Download, action: "exportDeposits" as const },
];

export default function Layout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin";

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const handleExport = async (action: "exportEquipments" | "exportBorrows" | "exportDeposits") => {
    try {
      await api[action]();
      toast("导出成功", "success");
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "导出失败", "error");
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col shadow-sm flex-shrink-0">
        <div className="h-16 flex items-center gap-2 px-5 border-b border-gray-100">
          <Stethoscope className="w-7 h-7 text-teal-700" />
          <span className="font-bold text-lg text-teal-800">设备借还</span>
        </div>

        <nav className="flex-1 py-4 px-3 space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-teal-50 text-teal-700"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`
              }
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </NavLink>
          ))}

          {isAdmin && (
            <>
              <div className="pt-4 pb-2 px-3">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  导出记录
                </span>
              </div>
              {ADMIN_NAV_ITEMS.map((item) => (
                <button
                  key={item.action}
                  onClick={() => handleExport(item.action)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors w-full text-left"
                >
                  <item.icon className="w-5 h-5" />
                  {item.label}
                </button>
              ))}
            </>
          )}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 shadow-sm flex-shrink-0">
          <div />
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">
              {user?.username}
              <span className="ml-1 text-xs text-gray-400">
                ({isAdmin ? "管理员" : "前台"})
              </span>
            </span>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-red-500 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              退出
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
