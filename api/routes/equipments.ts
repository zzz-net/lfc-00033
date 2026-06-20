import { Router, type Request, type Response } from 'express'
import db from '../db.js'
import { authMiddleware, adminMiddleware } from '../middleware/auth.js'

const router = Router()

router.get('/', (req: Request, res: Response): void => {
  const { status, name, type } = req.query

  let sql = 'SELECT * FROM equipments WHERE 1=1'
  const params: unknown[] = []

  if (status) {
    sql += ' AND status = ?'
    params.push(status)
  }
  if (name) {
    sql += ' AND name LIKE ?'
    params.push(`%${name}%`)
  }
  if (type) {
    sql += ' AND type = ?'
    params.push(type)
  }

  sql += ' ORDER BY created_at DESC'

  const rows = db.prepare(sql).all(...params)
  res.json({ success: true, data: rows })
})

router.post('/', authMiddleware, adminMiddleware, (req: Request, res: Response): void => {
  const { name, type, deposit_amount, notes } = req.body

  if (!name || !type || deposit_amount === undefined) {
    res.status(400).json({ success: false, error: '设备名称、类型和押金金额为必填项' })
    return
  }

  const result = db.prepare(
    'INSERT INTO equipments (name, type, deposit_amount, notes) VALUES (?, ?, ?, ?)'
  ).run(name, type, deposit_amount, notes || '')

  const equipment = db.prepare('SELECT * FROM equipments WHERE id = ?').get(result.lastInsertRowid)
  res.status(201).json({ success: true, data: equipment })
})

router.put('/:id', authMiddleware, adminMiddleware, (req: Request, res: Response): void => {
  const { id } = req.params
  const { name, type, deposit_amount, notes, status } = req.body

  const existing = db.prepare('SELECT * FROM equipments WHERE id = ?').get(id) as {
    id: number
  } | undefined

  if (!existing) {
    res.status(404).json({ success: false, error: '设备不存在' })
    return
  }

  db.prepare(
    `UPDATE equipments SET
      name = COALESCE(?, name),
      type = COALESCE(?, type),
      deposit_amount = COALESCE(?, deposit_amount),
      notes = COALESCE(?, notes),
      status = COALESCE(?, status),
      updated_at = datetime('now', 'localtime')
    WHERE id = ?`
  ).run(name ?? null, type ?? null, deposit_amount ?? null, notes ?? null, status ?? null, id)

  const equipment = db.prepare('SELECT * FROM equipments WHERE id = ?').get(id)
  res.json({ success: true, data: equipment })
})

router.get('/:id/detail', authMiddleware, (req: Request, res: Response): void => {
  const { id } = req.params

  const equipment = db.prepare('SELECT * FROM equipments WHERE id = ?').get(id) as {
    id: number
  } | undefined

  if (!equipment) {
    res.status(404).json({ success: false, error: '设备不存在' })
    return
  }

  const depositTimeline = db.prepare(
    `SELECT dt.*, br.borrower_name as borrower_name_col
     FROM deposit_transactions dt
     JOIN borrow_records br ON dt.borrow_record_id = br.id
     WHERE dt.equipment_id = ?
     ORDER BY dt.created_at DESC`
  ).all(id)

  const operationLogs = db.prepare(
    'SELECT * FROM operation_logs WHERE equipment_id = ? ORDER BY created_at DESC'
  ).all(id)

  res.json({
    success: true,
    data: {
      equipment,
      deposit_timeline: depositTimeline,
      operation_logs: operationLogs,
    },
  })
})

export default router
