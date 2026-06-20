import { Router, type Request, type Response } from 'express'
import db from '../db.js'
import { authMiddleware, adminMiddleware } from '../middleware/auth.js'

const router = Router()

router.post('/', authMiddleware, (req: Request, res: Response): void => {
  const { equipment_id, borrower_name, borrower_phone } = req.body

  if (!equipment_id || !borrower_name || !borrower_phone) {
    res.status(400).json({ success: false, error: '设备ID、借用人姓名和手机号为必填项' })
    return
  }

  const equipment = db.prepare('SELECT * FROM equipments WHERE id = ?').get(equipment_id) as {
    id: number
    name: string
    type: string
    status: string
    deposit_amount: number
  } | undefined

  if (!equipment) {
    res.status(404).json({ success: false, error: '设备不存在' })
    return
  }

  if (equipment.status !== 'available') {
    res.status(400).json({ success: false, error: '该设备当前不可借出' })
    return
  }

  const operator = req.user!

  const borrow = db.transaction(() => {
    const recordResult = db.prepare(
      `INSERT INTO borrow_records (equipment_id, borrower_name, borrower_phone, status, deposit_frozen)
       VALUES (?, ?, ?, 'borrowed', ?)`
    ).run(equipment_id, borrower_name, borrower_phone, equipment.deposit_amount)

    db.prepare(
      `INSERT INTO deposit_transactions (borrow_record_id, equipment_id, equipment_name, borrower_name, type, amount, operator_id, operator_name)
       VALUES (?, ?, ?, ?, 'freeze', ?, ?, ?)`
    ).run(recordResult.lastInsertRowid, equipment_id, equipment.name, borrower_name, equipment.deposit_amount, operator.id, operator.username)

    db.prepare(
      "UPDATE equipments SET status = 'borrowed', updated_at = datetime('now', 'localtime') WHERE id = ?"
    ).run(equipment_id)

    db.prepare(
      `INSERT INTO operation_logs (borrow_record_id, equipment_id, action, operator_id, operator_name, detail)
       VALUES (?, ?, 'borrow', ?, ?, ?)`
    ).run(recordResult.lastInsertRowid, equipment_id, operator.id, operator.username, `借出设备 ${equipment.name} 给 ${borrower_name}，冻结押金 ${equipment.deposit_amount}`)

    return db.prepare('SELECT * FROM borrow_records WHERE id = ?').get(recordResult.lastInsertRowid)
  })()

  res.status(201).json({ success: true, data: borrow })
})

router.put('/:id/return', authMiddleware, (req: Request, res: Response): void => {
  const { id } = req.params

  const record = db.prepare('SELECT * FROM borrow_records WHERE id = ?').get(id) as {
    id: number
    equipment_id: number
    borrower_name: string
    status: string
    deposit_frozen: number
    deposit_deducted: number
  } | undefined

  if (!record) {
    res.status(404).json({ success: false, error: '借还记录不存在' })
    return
  }

  if (record.status !== 'borrowed') {
    res.status(400).json({ success: false, error: '该记录已归还，不可重复操作' })
    return
  }

  const equipment = db.prepare('SELECT * FROM equipments WHERE id = ?').get(record.equipment_id) as {
    id: number
    name: string
  }

  const operator = req.user!
  const refundAmount = record.deposit_frozen - record.deposit_deducted

  const updated = db.transaction(() => {
    db.prepare(
      `UPDATE borrow_records SET status = 'returned', return_time = datetime('now', 'localtime'), deposit_refunded = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(refundAmount, id)

    db.prepare(
      `INSERT INTO deposit_transactions (borrow_record_id, equipment_id, equipment_name, borrower_name, type, amount, operator_id, operator_name)
       VALUES (?, ?, ?, ?, 'refund', ?, ?, ?)`
    ).run(id, record.equipment_id, equipment.name, record.borrower_name, refundAmount, operator.id, operator.username)

    db.prepare(
      "UPDATE equipments SET status = 'available', updated_at = datetime('now', 'localtime') WHERE id = ?"
    ).run(record.equipment_id)

    db.prepare(
      `INSERT INTO operation_logs (borrow_record_id, equipment_id, action, operator_id, operator_name, detail)
       VALUES (?, ?, 'return', ?, ?, ?)`
    ).run(id, record.equipment_id, operator.id, operator.username, `归还设备 ${equipment.name}，退还押金 ${refundAmount}`)

    return db.prepare('SELECT * FROM borrow_records WHERE id = ?').get(id)
  })()

  res.json({ success: true, data: updated })
})

router.put('/:id/damage', authMiddleware, (req: Request, res: Response): void => {
  const { id } = req.params
  const { damage_description } = req.body

  const record = db.prepare('SELECT * FROM borrow_records WHERE id = ?').get(id) as {
    id: number
    equipment_id: number
    borrower_name: string
    status: string
  } | undefined

  if (!record) {
    res.status(404).json({ success: false, error: '借还记录不存在' })
    return
  }

  if (record.status !== 'borrowed') {
    res.status(400).json({ success: false, error: '该记录不处于借出状态，无法报损' })
    return
  }

  const equipment = db.prepare('SELECT * FROM equipments WHERE id = ?').get(record.equipment_id) as {
    id: number
    name: string
  }

  const operator = req.user!

  const updated = db.transaction(() => {
    db.prepare(
      `UPDATE borrow_records SET status = 'pending_confirm', damage_description = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(damage_description || '', id)

    db.prepare(
      "UPDATE equipments SET status = 'pending_confirm', updated_at = datetime('now', 'localtime') WHERE id = ?"
    ).run(record.equipment_id)

    db.prepare(
      `INSERT INTO operation_logs (borrow_record_id, equipment_id, action, operator_id, operator_name, detail)
       VALUES (?, ?, 'damage_report', ?, ?, ?)`
    ).run(id, record.equipment_id, operator.id, operator.username, `报告设备 ${equipment.name} 损坏：${damage_description || '无描述'}`)

    return db.prepare('SELECT * FROM borrow_records WHERE id = ?').get(id)
  })()

  res.json({ success: true, data: updated })
})

router.put('/:id/confirm-damage', authMiddleware, adminMiddleware, (req: Request, res: Response): void => {
  const { id } = req.params
  const { deposit_deducted } = req.body

  const record = db.prepare('SELECT * FROM borrow_records WHERE id = ?').get(id) as {
    id: number
    equipment_id: number
    borrower_name: string
    status: string
    deposit_frozen: number
    deposit_refunded: number
    deposit_deducted: number
  } | undefined

  if (!record) {
    res.status(404).json({ success: false, error: '借还记录不存在' })
    return
  }

  if (record.status !== 'pending_confirm') {
    res.status(400).json({ success: false, error: '该记录不处于待确认状态' })
    return
  }

  const deductAmount = Number(deposit_deducted) || 0
  const equipment = db.prepare('SELECT * FROM equipments WHERE id = ?').get(record.equipment_id) as {
    id: number
    name: string
  }

  const operator = req.user!

  const updated = db.transaction(() => {
    if (deductAmount > 0) {
      db.prepare(
        `INSERT INTO deposit_transactions (borrow_record_id, equipment_id, equipment_name, borrower_name, type, amount, operator_id, operator_name)
         VALUES (?, ?, ?, ?, 'deduct', ?, ?, ?)`
      ).run(id, record.equipment_id, equipment.name, record.borrower_name, deductAmount, operator.id, operator.username)
    }

    const refundAmount = record.deposit_frozen - deductAmount
    if (refundAmount > 0) {
      db.prepare(
        `INSERT INTO deposit_transactions (borrow_record_id, equipment_id, equipment_name, borrower_name, type, amount, operator_id, operator_name)
         VALUES (?, ?, ?, ?, 'refund', ?, ?, ?)`
      ).run(id, record.equipment_id, equipment.name, record.borrower_name, refundAmount, operator.id, operator.username)
    }

    db.prepare(
      `UPDATE borrow_records SET status = 'damaged', deposit_deducted = ?, deposit_refunded = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(deductAmount, refundAmount, id)

    db.prepare(
      "UPDATE equipments SET status = 'damaged', updated_at = datetime('now', 'localtime') WHERE id = ?"
    ).run(record.equipment_id)

    db.prepare(
      `INSERT INTO operation_logs (borrow_record_id, equipment_id, action, operator_id, operator_name, detail)
       VALUES (?, ?, 'confirm_damage', ?, ?, ?)`
    ).run(id, record.equipment_id, operator.id, operator.username, `确认设备 ${equipment.name} 损坏，扣除押金 ${deductAmount}，退还押金 ${refundAmount}`)

    return db.prepare('SELECT * FROM borrow_records WHERE id = ?').get(id)
  })()

  res.json({ success: true, data: updated })
})

router.get('/', authMiddleware, (req: Request, res: Response): void => {
  const { status, borrower_name, equipment_name } = req.query

  let sql = `SELECT br.*, e.name as equipment_name, e.type as equipment_type
    FROM borrow_records br
    JOIN equipments e ON br.equipment_id = e.id
    WHERE 1=1`
  const params: unknown[] = []

  if (status) {
    sql += ' AND br.status = ?'
    params.push(status)
  }
  if (borrower_name) {
    sql += ' AND br.borrower_name LIKE ?'
    params.push(`%${borrower_name}%`)
  }
  if (equipment_name) {
    sql += ' AND e.name LIKE ?'
    params.push(`%${equipment_name}%`)
  }

  sql += ' ORDER BY br.created_at DESC'

  const rows = db.prepare(sql).all(...params)
  res.json({ success: true, data: rows })
})

export default router
