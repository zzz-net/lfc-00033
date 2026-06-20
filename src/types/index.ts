export interface User {
  id: number;
  username: string;
  role: "admin" | "front_desk";
}

export interface Equipment {
  id: number;
  name: string;
  type: string;
  status: "available" | "borrowed" | "damaged" | "pending_confirm";
  deposit_amount: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface BorrowRecord {
  id: number;
  equipment_id: number;
  equipment_name: string;
  borrower_name: string;
  borrower_phone: string;
  status: "borrowed" | "returned" | "damaged" | "pending_confirm";
  borrow_time: string;
  return_time: string | null;
  damage_description: string | null;
  deposit_frozen: number;
  deposit_refunded: number;
  deposit_deducted: number;
  created_at: string;
  updated_at: string;
}

export interface DepositTransaction {
  id: number;
  borrow_record_id: number;
  equipment_id: number;
  equipment_name: string;
  borrower_name: string;
  type: "freeze" | "refund" | "deduct";
  amount: number;
  operator_id: number;
  operator_name: string;
  created_at: string;
}

export interface OperationLog {
  id: number;
  borrow_record_id: number | null;
  equipment_id: number | null;
  action: string;
  operator_id: number;
  operator_name: string;
  detail: string;
  created_at: string;
}

export interface EquipmentDetail {
  equipment: Equipment;
  deposit_timeline: DepositTransaction[];
  operation_logs: OperationLog[];
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface SavedViewFilters {
  status?: string;
  name?: string;
  type?: string;
}

export interface SavedView {
  id: number;
  user_id: number;
  page: string;
  name: string;
  filters: SavedViewFilters;
  sort_by: string | null;
  sort_order: "asc" | "desc" | null;
  page_size: number;
  visible_columns: string[] | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface ViewOperationLog {
  id: number;
  view_id: number | null;
  view_name: string;
  action: "create" | "update" | "delete" | "apply";
  operator_id: number;
  operator_name: string;
  detail: string;
  created_at: string;
}

export interface PaginatedEquipments {
  data: Equipment[];
  total: number;
  page: number;
  page_size: number;
}
