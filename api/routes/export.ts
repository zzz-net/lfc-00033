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
  const rows = db.prepare('SELECT * FROM equipments ORDER BY created_at DESC').all() as Record<string, unknown>[]
  const header = toCsvRow(['ID', '名称', '类型', '状态', '押金金额', '备注', '创建时间', '更新时间'])
  const statusMap: Record<string, string> = { available: '可用', borrowed: '借出', damaged: '损坏', pending_confirm: '待确认' }
  const csvRows = rows.map(r => toCsvRow([
    r.id, r.name, r.type, statusMap[String(r.status)] || r.status,
    r.deposit_amount, r.notes, r.created_at, r.updated_at
  ]))
  sendCsv(res, 'equipments.csv', header, csvRows)
})

router.get('/borrows', authMiddleware, adminMiddleware, (req: Request, res: Response): void => {
  const rows = db.prepare(
    `SELECT br.*, e.name as equipment_name, e.type as equipment_type
     FROM borrow_records br
     JOIN equipments e ON br.equipment_id = e.id
     ORDER BY br.created_at DESC`
  ).all() as Record<string, unknown>[]
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
  const rows = db.prepare('SELECT * FROM deposit_transactions ORDER BY created_at DESC').all() as Record<string, unknown>[]
  const header = toCsvRow(['ID', '借还记录ID', '设备ID', '设备名称', '借用人', '类型', '金额', '操作人ID', '操作人', '创建时间'])
  const typeMap: Record<string, string> = { freeze: '冻结', refund: '退还', deduct: '扣除' }
  const csvRows = rows.map(r => toCsvRow([
    r.id, r.borrow_record_id, r.equipment_id, r.equipment_name, r.borrower_name,
    typeMap[String(r.type)] || r.type, r.amount, r.operator_id, r.operator_name, r.created_at
  ]))
  sendCsv(res, 'deposits.csv', header, csvRows)
})

export default router
