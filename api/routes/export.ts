import { Router, type Request, type Response } from 'express'
import db from '../db.js'
import { authMiddleware, adminMiddleware } from '../middleware/auth.js'

const router = Router()

function toCsvRow(values: unknown[]): string {
  return values.map(v => {
    const s = String(v ?? '')
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }).join(',')
}

function sendCsv(res: Response, filename: string, header: string, rows: string[]): void {
  const bom = '\uFEFF'
  const csv = bom + header + '\n' + rows.join('\n')
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
  res.send(csv)
}

router.get('/equipments', authMiddleware, adminMiddleware, (req: Request, res: Response): void => {
  const { status, name, type, sort_by, sort_order } = req.query
  let whereSql = ' WHERE 1=1'
  const params: unknown[] = []

  if (status) { whereSql += ' AND status = ?'; params.push(status) }
  if (name) { whereSql += ' AND name LIKE ?'; params.push(`%${name}%`) }
  if (type) { whereSql += ' AND type = ?'; params.push(type) }

  const validSortColumns = ['id', 'name', 'type', 'status', 'deposit_amount', 'created_at', 'updated_at']
  const sortBy = validSortColumns.includes(String(sort_by)) ? String(sort_by) : 'created_at'
  const sortOrder = sort_order === 'asc' ? 'ASC' : 'DESC'

  const sql = 'SELECT * FROM equipments' + whereSql + ` ORDER BY ${sortBy} ${sortOrder}`
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
  const header = toCsvRow(['ID', '名称', '类型', '状态', '押金金额', '备注', '创建时间', '更新时间'])
  const statusMap: Record<string, string> = { available: '可用', borrowed: '借出', reserved: '已预约', damaged: '损坏', pending_confirm: '待确认' }
  const csvRows = rows.map(r => toCsvRow([
    r.id, r.name, r.type, statusMap[String(r.status)] || r.status,
    r.deposit_amount, r.notes, r.created_at, r.updated_at
  ]))
  sendCsv(res, 'equipments.csv', header, csvRows)
})

router.get('/borrows', authMiddleware, adminMiddleware, (req: Request, res: Response): void => {
  const { status, borrower_name, equipment_name } = req.query
  let sql = `SELECT br.*, e.name as equipment_name, e.type as equipment_type
    FROM borrow_records br
    JOIN equipments e ON br.equipment_id = e.id
    WHERE 1=1`
  const params: unknown[] = []

  if (status) { sql += ' AND br.status = ?'; params.push(status) }
  if (borrower_name) { sql += ' AND br.borrower_name LIKE ?'; params.push(`%${borrower_name}%`) }
  if (equipment_name) { sql += ' AND e.name LIKE ?'; params.push(`%${equipment_name}%`) }

  sql += ' ORDER BY br.created_at DESC'

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
  const header = toCsvRow(['ID', '设备名称', '设备类型', '借用人', '联系电话', '状态', '借出时间', '归还时间', '损坏描述', '冻结押金', '退还押金', '扣除押金'])
  const statusMap: Record<string, string> = { borrowed: '借出', returned: '已归还', damaged: '损坏', pending_confirm: '待确认' }
  const csvRows = rows.map(r => toCsvRow([
    r.id, r.equipment_name, r.equipment_type, r.borrower_name, r.borrower_phone,
    statusMap[String(r.status)] || r.status, r.borrow_time, r.return_time,
    r.damage_description, r.deposit_frozen, r.deposit_refunded, r.deposit_deducted
  ]))
  sendCsv(res, 'borrows.csv', header, csvRows)
})

router.get('/deposits', authMiddleware, adminMiddleware, (req: Request, res: Response): void => {
  const { borrower_name, equipment_name, type } = req.query
  let sql = 'SELECT * FROM deposit_transactions WHERE 1=1'
  const params: unknown[] = []

  if (borrower_name) { sql += ' AND borrower_name LIKE ?'; params.push(`%${borrower_name}%`) }
  if (equipment_name) { sql += ' AND equipment_name LIKE ?'; params.push(`%${equipment_name}%`) }
  if (type) { sql += ' AND type = ?'; params.push(type) }

  sql += ' ORDER BY created_at DESC'

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
  const header = toCsvRow(['ID', '借还记录ID', '设备ID', '设备名称', '借用人', '类型', '金额', '操作人ID', '操作人', '创建时间'])
  const typeMap: Record<string, string> = { freeze: '冻结', refund: '退还', deduct: '扣除' }
  const csvRows = rows.map(r => toCsvRow([
    r.id, r.borrow_record_id, r.equipment_id, r.equipment_name, r.borrower_name,
    typeMap[String(r.type)] || r.type, r.amount, r.operator_id, r.operator_name, r.created_at
  ]))
  sendCsv(res, 'deposits.csv', header, csvRows)
})

router.get('/reservations', authMiddleware, adminMiddleware, (req: Request, res: Response): void => {
  const { status, equipment_id, borrower_name, equipment_name } = req.query
  let sql = `SELECT r.*, e.name as equipment_name, e.type as equipment_type
    FROM reservations r
    JOIN equipments e ON r.equipment_id = e.id
    WHERE 1=1`
  const params: unknown[] = []

  if (status) { sql += ' AND r.status = ?'; params.push(status) }
  if (equipment_id) { sql += ' AND r.equipment_id = ?'; params.push(equipment_id) }
  if (borrower_name) { sql += ' AND r.borrower_name LIKE ?'; params.push(`%${borrower_name}%`) }
  if (equipment_name) { sql += ' AND e.name LIKE ?'; params.push(`%${equipment_name}%`) }

  sql += ' ORDER BY r.equipment_id ASC, r.queue_order ASC, r.created_at ASC'

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
  const header = toCsvRow(['ID', '设备名称', '设备类型', '借用人', '联系电话', '预计取用时间', '排队顺位', '状态', '备注', '操作人', '创建时间', '通知时间', '完成时间', '取消时间', '取消原因'])
  const statusMap: Record<string, string> = { queued: '排队中', notified: '已通知', completed: '已完成', cancelled: '已取消' }
  const csvRows = rows.map(r => toCsvRow([
    r.id, r.equipment_name, r.equipment_type, r.borrower_name, r.borrower_phone,
    r.expected_pickup_time,
    (r.status === 'queued' || r.status === 'notified') ? `#${Number(r.queue_order) + 1}` : '-',
    statusMap[String(r.status)] || r.status,
    r.notes, r.operator_name, r.created_at, r.notified_at, r.completed_at, r.cancelled_at, r.cancel_reason
  ]))
  sendCsv(res, 'reservations.csv', header, csvRows)
})

export default router
