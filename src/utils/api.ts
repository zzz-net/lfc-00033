import type {
  LoginResponse,
  User,
  Equipment,
  EquipmentDetail,
  BorrowRecord,
  DepositTransaction,
  SavedView,
  ViewSnapshot,
  ViewOperationLog,
  PaginatedEquipments,
} from "@/types";

const BASE_URL = "/api";

function getToken(): string | null {
  return localStorage.getItem("token");
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const body = await res.json().catch(() => ({} as ApiResponse<T>));

  if (!res.ok) {
    throw new Error(body.error || `请求失败 (${res.status})`);
  }

  if (body.success !== undefined && body.data !== undefined) {
    if (body.total !== undefined) {
      return body as T;
    }
    return body.data as T;
  }
  if (body.success !== undefined) {
    return undefined as unknown as T;
  }
  return body as T;
}

async function downloadFile(path: string, filename: string, params?: Record<string, string>): Promise<void> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  let url = `${BASE_URL}${path}`;
  if (params) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) qs.set(k, v);
    });
    const query = qs.toString();
    if (query) url += `?${query}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `导出失败 (${res.status})`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(objectUrl);
}

export const api = {
  login: (username: string, password: string) =>
    request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  getMe: () => request<User>("/auth/me"),

  getEquipments: (params?: {
    status?: string;
    name?: string;
    type?: string;
    sort_by?: string;
    sort_order?: "asc" | "desc";
    page?: number;
    page_size?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.name) qs.set("name", params.name);
    if (params?.type) qs.set("type", params.type);
    if (params?.sort_by) qs.set("sort_by", params.sort_by);
    if (params?.sort_order) qs.set("sort_order", params.sort_order);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.page_size) qs.set("page_size", String(params.page_size));
    const query = qs.toString();
    return request<PaginatedEquipments>(`/equipments${query ? `?${query}` : ""}`);
  },

  createEquipment: (data: Partial<Equipment>) =>
    request<Equipment>("/equipments", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateEquipment: (id: number, data: Partial<Equipment>) =>
    request<Equipment>(`/equipments/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  getEquipmentDetail: (id: number) =>
    request<EquipmentDetail>(`/equipments/${id}/detail`),

  createBorrow: (data: {
    equipment_id: number;
    borrower_name: string;
    borrower_phone: string;
  }) =>
    request<{ record: BorrowRecord; deposit_transaction: DepositTransaction }>(
      "/borrows",
      { method: "POST", body: JSON.stringify(data) }
    ),

  returnBorrow: (id: number) =>
    request<{ record: BorrowRecord; deposit_transaction: DepositTransaction }>(
      `/borrows/${id}/return`,
      { method: "PUT" }
    ),

  reportDamage: (id: number, damage_description: string) =>
    request<BorrowRecord>(`/borrows/${id}/damage`, {
      method: "PUT",
      body: JSON.stringify({ damage_description }),
    }),

  confirmDamage: (id: number, deposit_deducted: number) =>
    request<{
      record: BorrowRecord;
      deposit_transaction?: DepositTransaction;
    }>(`/borrows/${id}/confirm-damage`, {
      method: "PUT",
      body: JSON.stringify({ deposit_deducted }),
    }),

  getBorrows: (params?: {
    status?: string;
    borrower_name?: string;
    equipment_name?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.borrower_name) qs.set("borrower_name", params.borrower_name);
    if (params?.equipment_name)
      qs.set("equipment_name", params.equipment_name);
    const query = qs.toString();
    return request<BorrowRecord[]>(`/borrows${query ? `?${query}` : ""}`);
  },

  getDeposits: (params?: {
    borrower_name?: string;
    equipment_name?: string;
    type?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.borrower_name) qs.set("borrower_name", params.borrower_name);
    if (params?.equipment_name)
      qs.set("equipment_name", params.equipment_name);
    if (params?.type) qs.set("type", params.type);
    const query = qs.toString();
    return request<DepositTransaction[]>(
      `/deposits${query ? `?${query}` : ""}`
    );
  },

  exportEquipments: (params?: {
    status?: string;
    name?: string;
    type?: string;
    sort_by?: string;
    sort_order?: "asc" | "desc";
  }) =>
    downloadFile("/export/equipments", "设备台账.csv", params as Record<string, string>),
  exportBorrows: (params?: { status?: string; borrower_name?: string; equipment_name?: string }) =>
    downloadFile("/export/borrows", "借还记录.csv", params as Record<string, string>),
  exportDeposits: (params?: { borrower_name?: string; equipment_name?: string; type?: string }) =>
    downloadFile("/export/deposits", "押金流水.csv", params as Record<string, string>),

  getViews: (page: string = "equipments", includeAll: boolean = false) => {
    const qs = new URLSearchParams();
    qs.set("page", page);
    if (includeAll) qs.set("include_all", "true");
    return request<SavedView[]>(`/views?${qs.toString()}`);
  },

  createView: (data: {
    page?: string;
    name: string;
    filters: Record<string, string>;
    sort_by?: string | null;
    sort_order?: "asc" | "desc" | null;
    page_size?: number;
    visible_columns?: string[] | null;
    is_default?: boolean;
  }) =>
    request<SavedView>("/views", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateView: (
    id: number,
    data: {
      name?: string;
      filters?: Record<string, string>;
      sort_by?: string | null;
      sort_order?: "asc" | "desc" | null;
      page_size?: number;
      visible_columns?: string[] | null;
      is_default?: boolean;
      expected_version?: number;
      snapshot_remark?: string;
    }
  ) =>
    request<{ data: SavedView; snapshot_created?: number }>(`/views/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  deleteView: (id: number) =>
    request<void>(`/views/${id}`, {
      method: "DELETE",
    }),

  applyView: (id: number) =>
    request<SavedView>(`/views/${id}/apply`, {
      method: "POST",
    }),

  getViewSnapshots: (viewId: number) =>
    request<ViewSnapshot[]>(`/views/${viewId}/snapshots`, {
      method: "GET",
    }),

  createViewSnapshot: (viewId: number, remark?: string) =>
    request<ViewSnapshot>(`/views/${viewId}/snapshot`, {
      method: "POST",
      body: JSON.stringify({ remark }),
    }),

  rollbackView: (viewId: number, snapshotId: number) =>
    request<{ data: SavedView; rollback_from_snapshot: number }>(
      `/views/${viewId}/rollback/${snapshotId}`,
      { method: "POST" }
    ),

  getViewLogs: (limit?: number) => {
    const qs = new URLSearchParams();
    if (limit) qs.set("limit", String(limit));
    return request<ViewOperationLog[]>(`/views/logs?${qs.toString()}`);
  },
};
