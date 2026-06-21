export interface User {
  id: number;
  username: string;
  role: "admin" | "front_desk";
}

export interface Equipment {
  id: number;
  name: string;
  type: string;
  status: "available" | "borrowed" | "reserved" | "damaged" | "pending_confirm";
  deposit_amount: number;
  notes: string;
  locked_reservation_id: number | null;
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
  reservations: Reservation[];
}

export type ReservationStatus = "queued" | "notified" | "locked" | "completed" | "cancelled" | "expired";

export interface Reservation {
  id: number;
  equipment_id: number;
  equipment_name?: string;
  equipment_type?: string;
  borrower_name: string;
  borrower_phone: string;
  expected_pickup_time: string | null;
  notes: string;
  status: ReservationStatus;
  queue_order: number;
  operator_id: number;
  operator_name: string;
  version: number;
  notified_at: string | null;
  locked_at: string | null;
  lock_expires_at: string | null;
  expired_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string;
  created_at: string;
  updated_at: string;
}

export interface ReservationConflictError {
  success: false;
  error: string;
  conflict: {
    current_version: number;
    submitted_version: number;
    latest_version: number;
    latest_updated_at: string;
    latest_operator: {
      operator_id: number;
      operator_name: string;
    };
  };
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
  is_owner?: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ViewSnapshot {
  id: number;
  view_id: number;
  view_name: string;
  version: number;
  filters: SavedViewFilters;
  sort_by: string | null;
  sort_order: "asc" | "desc" | null;
  page_size: number;
  visible_columns: string[] | null;
  is_default: boolean;
  operator_id: number;
  operator_name: string;
  remark: string;
  created_at: string;
}

export interface ViewOperationLog {
  id: number;
  view_id: number | null;
  view_name: string;
  action: "create" | "update" | "delete" | "apply" | "snapshot" | "rollback" | "conflict";
  operator_id: number;
  operator_name: string;
  detail: string;
  created_at: string;
}

export interface ViewConflictError {
  success: false;
  error: string;
  conflict: {
    current_version: number;
    submitted_version: number;
    latest_version: number;
    latest_updated_at: string;
    latest_operator: {
      operator_id: number;
      operator_name: string;
    };
  };
}

export interface PaginatedEquipments {
  data: Equipment[];
  total: number;
  page: number;
  page_size: number;
}

export type OfflineSignoffType = "borrow" | "return" | "damage";
export type OfflineSignoffStatus = "pending" | "syncing" | "failed" | "completed";

export interface OfflineSignoffConflictInfo {
  type: string;
  snapshot_status?: string;
  current_status?: string;
  equipment_name?: string;
  equipment_id?: number;
  locked_reservation_id?: number;
  locked_borrower_name?: string;
  locked_borrower_phone?: string;
}

export interface OfflineSignoffRecord {
  id: number;
  type: OfflineSignoffType;
  status: OfflineSignoffStatus;
  equipment_id: number;
  equipment_snapshot: Equipment | null;
  borrower_name: string;
  borrower_phone: string;
  damage_description: string;
  signer_name: string;
  notes: string;
  error_message: string;
  conflict_info: OfflineSignoffConflictInfo | null;
  server_record_id: number | null;
  operator_id: number;
  operator_name: string;
  created_at: string;
  synced_at: string | null;
  updated_at: string;
}

export interface OfflineSignoffStats {
  pending: number;
  syncing: number;
  failed: number;
  completed: number;
  total: number;
}

export interface OfflineSignoffExportData {
  version: number;
  exported_at: string;
  exported_by: { id: number; username: string };
  count: number;
  records: OfflineSignoffRecord[];
}
