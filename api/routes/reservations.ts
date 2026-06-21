import { Router, type Request, type Response } from 'express'
import db from '../db.js'
import { authMiddleware, adminMiddleware } from '../middleware/auth.js'

const router = Router()

const RESERVATION_STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  notified: '已通知',
  completed: '已完成',
  cancelled: '已取消',
}

function buildReservationConflictError(
  reservation: { version: number; updated_at: string; operator_id: number; operator_name: string },
  submittedVersion: number
) {
  return {
    success: false,
    error: '预约记录已被其他操作更新，请刷新后重试',
    conflict: {
      current_version: reservation.version,
      submitted_version: submittedVersion,
      latest_version: reservation.version,
      latest_updated_at: reservation.updated_at,
      latest_operator: {
        operator_id: reservation.operator_id,
        operator_name: reservation.operator_name,
      },
    },
  }
}

router.get('/', authMiddleware, (req: Request, res: Response): void => {
  const { status, equipment_id, borrower_name, equipment_name } = req.query
  const operator = req.user!

  let sql = `SELECT r.*, e.name as equipment_name, e.type as equipment_type
    FROM reservations r
    JOIN equipments e ON r.equipment_id = e.id
    WHERE 1=1`
  const params: unknown[] = []

  if (status) {
    sql += ' AND r.status = ?'
    params.push(status)
  }
  if (equipment_id) {
    sql += ' AND r.equipment_id = ?'
    params.push(equipment_id)
  }
  if (borrower_name) {
    sql += ' AND r.borrower_name LIKE ?'
    params.push(`%${borrower_name}%`)
  }
  if (equipment_name) {
    sql += ' AND e.name LIKE ?'
    params.push(`%${equipment_name}%`)
  }

  if (operator.role !== 'admin') {
    sql += ' AND r.operator_id = ?'
    params.push(operator.id)
  }

  sql += ' ORDER BY r.equipment_id ASC, r.queue_order ASC, r.created_at ASC'

  const rows = db.prepare(sql).all(...params)
  res.json({ success: true, data: rows })
})

router.post('/', authMiddleware, (req: Request, res: Response): void => {
  const { equipment_id, borrower_name, borrower_phone, expected_pickup_time, notes } = req.body
  const operator = req.user!

  if (!equipment_id || !borrower_name?.trim() || !borrower_phone?.trim()) {
    res.status(400).json({ success: false, error: '设备ID、借用人姓名和手机号为必填项' })
    return
  }

  const equipment = db.prepare('SELECT * FROM equipments WHERE id = ?').get(equipment_id) as {
    id: number
    name: string
  } | undefined

  if (!equipment) {
    res.status(404).json({ success: false, error: '设备不存在' })
    return
  }

  const existing = db.prepare(
    `SELECT * FROM reservations 
     WHERE equipment_id = ? AND borrower_name = ? AND borrower_phone = ? 
       AND status IN ('queued', 'notified')`
  ).get(equipment_id, borrower_name.trim(), borrower_phone.trim()) as { id: number } | undefined

  if (existing) {
    res.status(409).json({ success: false, error: '该借用人已在此设备上有有效预约，不能重复预约' })
    return
  }

  const result = db.transaction(() => {
    const maxOrder = db.prepare(
      "SELECT COALESCE(MAX(queue_order), -1) as max_order FROM reservations WHERE equipment_id = ? AND status IN ('queued', 'notified')"
    ).get(equipment_id) as { max_order: number }
    const nextOrder = maxOrder.max_order + 1

    const insertResult = db.prepare(
      `INSERT INTO reservations 
       (equipment_id, borrower_name, borrower_phone, expected_pickup_time, notes, 
        status, queue_order, operator_id, operator_name)
       VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)`
    ).run(
      equipment_id,
      borrower_name.trim(),
      borrower_phone.trim(),
      expected_pickup_time || null,
      notes || '',
      nextOrder,
      operator.id,
      operator.username
    )

    db.prepare(
      `INSERT INTO operation_logs (equipment_id, action, operator_id, operator_name, detail)
       VALUES (?, 'reservation_create', ?, ?, ?)`
    ).run(
      equipment_id,
      operator.id,
      operator.username,
      `为 ${borrower_name.trim()}(${borrower_phone.trim()}) 创建设备 ${equipment.name} 的预约，排队顺位 #${nextOrder + 1}`
    )

    return db.prepare('SELECT * FROM reservations WHERE id = ?').get(insertResult.lastInsertRowid)
  })()

  res.status(201).json({ success: true, data: result })
})

router.put('/:id/notify', authMiddleware, (req: Request, res: Response): void => {
  const { id } = req.params
  const operator = req.user!

  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id) as {
    id: number
    equipment_id: number
    borrower_name: string
    status: string
    queue_order: number
  } | undefined

  if (!reservation) {
    res.status(404).json({ success: false, error: '预约记录不存在' })
    return
  }

  if (reservation.status !== 'queued') {
    const statusLabel = RESERVATION_STATUS_LABELS[reservation.status] || reservation.status
    res.status(400).json({ success: false, error: `当前预约状态为「${statusLabel}」，不可执行通知操作` })
    return
  }

  const equipment = db.prepare('SELECT name FROM equipments WHERE id = ?').get(reservation.equipment_id) as { name: string }

  const updated = db.transaction(() => {
    db.prepare(
      `UPDATE reservations SET status = 'notified', notified_at = datetime('now', 'localtime'), 
       version = version + 1, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(id)

    db.prepare(
      `INSERT INTO operation_logs (equipment_id, action, operator_id, operator_name, detail)
       VALUES (?, 'reservation_notify', ?, ?, ?)`
    ).run(
      reservation.equipment_id,
      operator.id,
      operator.username,
      `已通知预约人 ${reservation.borrower_name} 取用设备 ${equipment.name}`
    )

    return db.prepare('SELECT * FROM reservations WHERE id = ?').get(id)
  })()

  res.json({ success: true, data: updated })
})

router.put('/:id/complete', authMiddleware, (req: Request, res: Response): void => {
  const { id } = req.params
  const { expected_version } = req.body
  const operator = req.user!

  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id) as {
    id: number
    equipment_id: number
    borrower_name: string
    status: string
    operator_id: number
    operator_name: string
    version: number
    updated_at: string
  } | undefined

  if (!reservation) {
    res.status(404).json({ success: false, error: '预约记录不存在' })
    return
  }

  if (operator.role !== 'admin' && reservation.operator_id !== operator.id) {
    res.status(403).json({ success: false, error: '只能完成自己经手的预约' })
    return
  }

  if (expected_version !== undefined && Number(expected_version) !== reservation.version) {
    res.status(409).json(buildReservationConflictError(reservation, Number(expected_version)))
    return
  }

  if (reservation.status !== 'queued' && reservation.status !== 'notified') {
    const statusLabel = RESERVATION_STATUS_LABELS[reservation.status] || reservation.status
    res.status(400).json({ success: false, error: `当前预约状态为「${statusLabel}」，不可执行完成操作` })
    return
  }

  const equipment = db.prepare('SELECT name FROM equipments WHERE id = ?').get(reservation.equipment_id) as { name: string }

  const updated = db.transaction(() => {
    db.prepare(
      `UPDATE reservations SET status = 'completed', completed_at = datetime('now', 'localtime'),
       version = version + 1, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(id)

    db.prepare(
      `INSERT INTO operation_logs (equipment_id, action, operator_id, operator_name, detail)
       VALUES (?, 'reservation_complete', ?, ?, ?)`
    ).run(
      reservation.equipment_id,
      operator.id,
      operator.username,
      `预约人 ${reservation.borrower_name} 已完成设备 ${equipment.name} 的取用`
    )

    return db.prepare('SELECT * FROM reservations WHERE id = ?').get(id)
  })()

  res.json({ success: true, data: updated })
})

router.put('/:id/cancel', authMiddleware, (req: Request, res: Response): void => {
  const { id } = req.params
  const { cancel_reason, expected_version } = req.body
  const operator = req.user!

  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id) as {
    id: number
    equipment_id: number
    borrower_name: string
    status: string
    operator_id: number
    operator_name: string
    version: number
    updated_at: string
    queue_order: number
  } | undefined

  if (!reservation) {
    res.status(404).json({ success: false, error: '预约记录不存在' })
    return
  }

  if (operator.role !== 'admin' && reservation.operator_id !== operator.id) {
    res.status(403).json({ success: false, error: '只能取消自己经手的预约' })
    return
  }

  if (expected_version !== undefined && Number(expected_version) !== reservation.version) {
    res.status(409).json(buildReservationConflictError(reservation, Number(expected_version)))
    return
  }

  if (reservation.status === 'completed' || reservation.status === 'cancelled') {
    const statusLabel = RESERVATION_STATUS_LABELS[reservation.status] || reservation.status
    res.status(400).json({ success: false, error: `当前预约状态为「${statusLabel}」，不可执行取消操作` })
    return
  }

  const equipment = db.prepare('SELECT name FROM equipments WHERE id = ?').get(reservation.equipment_id) as { name: string }

  const updated = db.transaction(() => {
    db.prepare(
      `UPDATE reservations SET status = 'cancelled', cancelled_at = datetime('now', 'localtime'),
       cancel_reason = ?, version = version + 1, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(cancel_reason || '', id)

    db.prepare(
      `UPDATE reservations SET queue_order = queue_order - 1 
       WHERE equipment_id = ? AND status IN ('queued', 'notified') AND queue_order > ?`
    ).run(reservation.equipment_id, reservation.queue_order)

    db.prepare(
      `INSERT INTO operation_logs (equipment_id, action, operator_id, operator_name, detail)
       VALUES (?, 'reservation_cancel', ?, ?, ?)`
    ).run(
      reservation.equipment_id,
      operator.id,
      operator.username,
      `取消 ${reservation.borrower_name} 对设备 ${equipment.name} 的预约${cancel_reason ? `，原因：${cancel_reason}` : ''}`
    )

    return db.prepare('SELECT * FROM reservations WHERE id = ?').get(id)
  })()

  res.json({ success: true, data: updated })
})

router.put('/reorder', authMiddleware, adminMiddleware, (req: Request, res: Response): void => {
  const { equipment_id, orders } = req.body as { equipment_id: number; orders: { id: number; queue_order: number }[] }
  const operator = req.user!

  if (!equipment_id || !Array.isArray(orders) || orders.length === 0) {
    res.status(400).json({ success: false, error: '设备ID和排序列表为必填项' })
    return
  }

  const equipment = db.prepare('SELECT name FROM equipments WHERE id = ?').get(equipment_id) as { name: string } | undefined
  if (!equipment) {
    res.status(404).json({ success: false, error: '设备不存在' })
    return
  }

  const result = db.transaction(() => {
    for (const { id, queue_order } of orders) {
      db.prepare(
        `UPDATE reservations SET queue_order = ?, version = version + 1, updated_at = datetime('now', 'localtime') 
         WHERE id = ? AND status IN ('queued', 'notified')`
      ).run(queue_order, id)
    }

    db.prepare(
      `INSERT INTO operation_logs (equipment_id, action, operator_id, operator_name, detail)
       VALUES (?, 'reservation_reorder', ?, ?, ?)`
    ).run(
      equipment_id,
      operator.id,
      operator.username,
      `调整设备 ${equipment.name} 的预约排队顺序，涉及 ${orders.length} 条预约`
    )

    return db.prepare(
      `SELECT r.*, e.name as equipment_name FROM reservations r 
       JOIN equipments e ON r.equipment_id = e.id 
       WHERE r.equipment_id = ? AND r.status IN ('queued', 'notified') 
       ORDER BY r.queue_order ASC`
    ).all(equipment_id)
  })()

  res.json({ success: true, data: result })
})

export default router
