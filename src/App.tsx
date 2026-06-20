import { useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { initToast } from "@/components/Toast";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import EquipmentPage from "@/pages/Equipment";
import BorrowReturnPage from "@/pages/BorrowReturn";
import DepositLogPage from "@/pages/DepositLog";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, fetchMe, user } = useAuthStore();
  const location = useLocation();

  useEffect(() => {
    if (isAuthenticated && !user) {
      fetchMe();
    }
  }, [isAuthenticated, user, fetchMe]);

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<EquipmentPage />} />
        <Route path="/borrow-return" element={<BorrowReturnPage />} />
        <Route path="/deposit-log" element={<DepositLogPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  const { loadFromStorage } = useAuthStore();

  useEffect(() => {
    loadFromStorage();
    initToast();
  }, [loadFromStorage]);

  return (
    <Router>
      <AppRoutes />
    </Router>
  );
}
