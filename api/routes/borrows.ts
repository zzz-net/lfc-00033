import { Router, type Request, type Response } from 'express'
import db from '../db.js'
import { authMiddleware, adminMiddleware } from '../middleware/auth.js'
import { resolveExpiredLocks, autoLockNextIfNeeded, PICKUP_LOCK_TIMEOUT_MINUTES } from './reservations.js'

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
    locked_reservation_id: number | null
  } | undefined

  if (!equipment) {
    res.status(404).json({ success: false, error: '设备不存在' })
    return
  }

  if (equipment.status !== 'available' && equipment.status !== 'reserved') {
    const statusLabels: Record<string, string> = {
      available: '可借', borrowed: '已借出', reserved: '已预约',
      damaged: '已损坏', pending_confirm: '待确认',
    }
    const label = statusLabels[equipment.status] || equipment.status
    res.status(400).json({ success: false, error: `该设备当前不可借出，状态为「${label}」` })
    return
  }

  if (equipment.status === 'reserved') {
    resolveExpiredLocks(equipment_id, req.user!.id, req.user!.username)

    const refreshedEquip = db.prepare('SELECT locked_reservation_id FROM equipments WHERE id = ?').get(equipment_id) as { locked_reservation_id: number | null }

    if (refreshedEquip.locked_reservation_id) {
      const lockedReservation = db.prepare(
        'SELECT * FROM reservations WHERE id = ? AND status = \'locked\''
      ).get(refreshedEquip.locked_reservation_id) as { id: number; borrower_name: string; borrower_phone: string; queue_order: number; lock_expires_at: string } | undefined

      if (lockedReservation) {
        if (lockedReservation.borrower_name !== borrower_name.trim() ||
            lockedReservation.borrower_phone !== borrower_phone.trim()) {
          res.status(403).json({
            success: false,
            error: `该设备已锁定给预约人 ${lockedReservation.borrower_name}(${lockedReservation.borrower_phone})，仅限该预约人取件，管理员也不可越权借出`,
            conflict: {
              type: 'pickup_lock_mismatch',
              locked_reservation_id: lockedReservation.id,
              locked_borrower_name: lockedReservation.borrower_name,
              locked_borrower_phone: lockedReservation.borrower_phone,
            },
          })
          return
        }
      } else {
        const anyLocked = db.prepare(
          "SELECT * FROM reservations WHERE equipment_id = ? AND status = 'locked' ORDER BY queue_order ASC LIMIT 1"
        ).get(equipment_id) as { id: number; borrower_name: string; borrower_phone: string } | undefined

        if (anyLocked) {
          if (anyLocked.borrower_name !== borrower_name.trim() ||
              anyLocked.borrower_phone !== borrower_phone.trim()) {
            res.status(403).json({
              success: false,
              error: `该设备已锁定给预约人 ${anyLocked.borrower_name}(${anyLocked.borrower_phone})，仅限该预约人取件`,
              conflict: { type: 'pickup_lock_mismatch', locked_reservation_id: anyLocked.id },
            })
            return
          }
        }
      }
    } else {
      const anyLocked = db.prepare(
        "SELECT * FROM reservations WHERE equipment_id = ? AND status = 'locked' ORDER BY queue_order ASC LIMIT 1"
      ).get(equipment_id) as { id: number; borrower_name: string; borrower_phone: string } | undefined

      if (anyLocked) {
        if (anyLocked.borrower_name !== borrower_name.trim() ||
            anyLocked.borrower_phone !== borrower_phone.trim()) {
          res.status(403).json({
            success: false,
            error: `该设备已锁定给预约人 ${anyLocked.borrower_name}(${anyLocked.borrower_phone})，仅限该预约人取件`,
            conflict: { type: 'pickup_lock_mismatch', locked_reservation_id: anyLocked.id },
          })
          return
        }
      } else {
        res.status(400).json({ success: false, error: '该设备处于预约状态但没有锁定的预约人，请刷新后重试' })
        return
      }
    }
  }

  const operator = req.user!

  let borrow
  try {
    borrow = db.transaction(() => {
      const recheck = db.prepare('SELECT status, locked_reservation_id FROM equipments WHERE id = ?').get(equipment_id) as { status: string; locked_reservation_id: number | null } | undefined
      if (!recheck || (recheck.status !== 'available' && recheck.status !== 'reserved')) {
        throw new Error('CONCURRENT_CHANGE')
      }

      if (recheck.locked_reservation_id) {
        const currentLocked = db.prepare('SELECT borrower_name, borrower_phone FROM reservations WHERE id = ? AND status = \'locked\'').get(recheck.locked_reservation_id) as { borrower_name: string; borrower_phone: string } | undefined
        if (currentLocked && (currentLocked.borrower_name !== borrower_name.trim() || currentLocked.borrower_phone !== borrower_phone.trim())) {
          throw new Error('LOCK_CONFLICT')
        }
      }

    const recordResult = db.prepare(
      `INSERT INTO borrow_records (equipment_id, borrower_name, borrower_phone, status, deposit_frozen)
       VALUES (?, ?, ?, 'borrowed', ?)`
    ).run(equipment_id, borrower_name, borrower_phone, equipment.deposit_amount)

    db.prepare(
      `INSERT INTO deposit_transactions (borrow_record_id, equipment_id, equipment_name, borrower_name, type, amount, operator_id, operator_name)
       VALUES (?, ?, ?, ?, 'freeze', ?, ?, ?)`
    ).run(recordResult.lastInsertRowid, equipment_id, equipment.name, borrower_name, equipment.deposit_amount, operator.id, operator.username)

    db.prepare(
      `UPDATE equipments SET status = 'borrowed', locked_reservation_id = NULL, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(equipment_id)

    db.prepare(
      `INSERT INTO operation_logs (borrow_record_id, equipment_id, action, operator_id, operator_name, detail)
       VALUES (?, ?, 'borrow', ?, ?, ?)`
    ).run(recordResult.lastInsertRowid, equipment_id, operator.id, operator.username,
      equipment.status === 'reserved'
        ? `锁定预约人 ${borrower_name} 取件设备 ${equipment.name}，冻结押金 ${equipment.deposit_amount}`
        : `借出设备 ${equipment.name} 给 ${borrower_name}，冻结押金 ${equipment.deposit_amount}`)

    const matchingReservation = db.prepare(
      `SELECT * FROM reservations 
       WHERE equipment_id = ? AND borrower_name = ? AND borrower_phone = ? 
         AND status IN ('queued', 'notified', 'locked')
       ORDER BY queue_order ASC LIMIT 1`
    ).get(equipment_id, borrower_name, borrower_phone) as { id: number; queue_order: number; status: string } | undefined

    if (matchingReservation) {
      db.prepare(
        `UPDATE reservations SET status = 'completed', completed_at = datetime('now', 'localtime'),
         version = version + 1, updated_at = datetime('now', 'localtime') WHERE id = ?`
      ).run(matchingReservation.id)

      db.prepare(
        `UPDATE reservations SET queue_order = queue_order - 1 
         WHERE equipment_id = ? AND status IN ('queued', 'notified', 'locked') AND queue_order > ?`
      ).run(equipment_id, matchingReservation.queue_order)

      db.prepare(
        `INSERT INTO operation_logs (equipment_id, action, operator_id, operator_name, detail)
         VALUES (?, 'reservation_auto_complete', ?, ?, ?)`
      ).run(
        equipment_id,
        operator.id,
        operator.username,
        `锁定预约人 ${borrower_name} 已实际取件设备 ${equipment.name}，自动完成对应预约`
      )
    }

    return db.prepare('SELECT * FROM borrow_records WHERE id = ?').get(recordResult.lastInsertRowid)
  })()
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'CONCURRENT_CHANGE') {
      res.status(409).json({
        success: false,
        error: '设备状态在提交时已变更，请刷新后重试',
        conflict: { type: 'equipment_status_changed' },
      })
      return
    }
    if (err instanceof Error && err.message === 'LOCK_CONFLICT') {
      res.status(409).json({
        success: false,
        error: '该设备取件锁定在提交时已变更，请刷新后重试',
        conflict: { type: 'pickup_lock_changed' },
      })
      return
    }
    throw err
  }

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
    const statusMap: Record<string, string> = { returned: '已归还', damaged: '已损坏', pending_confirm: '待确认损坏' }
    const statusLabel = statusMap[record.status] || record.status
    res.status(400).json({ success: false, error: `该记录当前状态为「${statusLabel}」，不可执行归还操作` })
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

    const hasActiveReservations = db.prepare(
      "SELECT COUNT(*) as cnt FROM reservations WHERE equipment_id = ? AND status IN ('queued', 'notified', 'locked')"
    ).get(record.equipment_id) as { cnt: number }

    let lockedReservation = null
    if (hasActiveReservations.cnt > 0) {
      db.prepare(
        "UPDATE equipments SET status = 'reserved', updated_at = datetime('now', 'localtime') WHERE id = ?"
      ).run(record.equipment_id)

      autoLockNextIfNeeded(record.equipment_id, operator.id, operator.username, equipment.name)

      const equipAfter = db.prepare('SELECT locked_reservation_id FROM equipments WHERE id = ?').get(record.equipment_id) as { locked_reservation_id: number | null }
      if (equipAfter.locked_reservation_id) {
        lockedReservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(equipAfter.locked_reservation_id)
      }
    } else {
      db.prepare(
        "UPDATE equipments SET status = 'available', locked_reservation_id = NULL, updated_at = datetime('now', 'localtime') WHERE id = ?"
      ).run(record.equipment_id)
    }

    db.prepare(
      `INSERT INTO operation_logs (borrow_record_id, equipment_id, action, operator_id, operator_name, detail)
       VALUES (?, ?, 'return', ?, ?, ?)`
    ).run(id, record.equipment_id, operator.id, operator.username,
      `归还设备 ${equipment.name}，退还押金 ${refundAmount}${lockedReservation ? `，已自动锁定下一位预约人` : ''}`)

    const borrowRecord = db.prepare('SELECT * FROM borrow_records WHERE id = ?').get(id)
    return { borrowRecord, lockedReservation }
  })()

  res.json({ success: true, data: updated.borrowRecord, next_reservation: updated.lockedReservation })
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
    const statusMap: Record<string, string> = { returned: '已归还', damaged: '已损坏', pending_confirm: '待确认损坏' }
    const statusLabel = statusMap[record.status] || record.status
    res.status(400).json({ success: false, error: `该记录当前状态为「${statusLabel}」，不可执行报损操作` })
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
    const statusMap: Record<string, string> = { borrowed: '借出中', returned: '已归还', damaged: '已损坏' }
    const statusLabel = statusMap[record.status] || record.status
    res.status(400).json({ success: false, error: `该记录当前状态为「${statusLabel}」，不可执行确认损坏操作` })
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
