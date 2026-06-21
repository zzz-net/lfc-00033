import { Router, type Request, type Response } from 'express'
import db from '../db.js'
import { authMiddleware, adminMiddleware } from '../middleware/auth.js'

const router = Router()

const PICKUP_LOCK_TIMEOUT_MINUTES = parseInt(process.env.PICKUP_LOCK_TIMEOUT_MINUTES || '30', 10)

const RESERVATION_STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  notified: '已通知',
  locked: '已锁定',
  completed: '已完成',
  cancelled: '已取消',
  expired: '已超时',
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

function resolveExpiredLocks(equipmentId: number, operatorId?: number, operatorName?: string): void {
  const equipment = db.prepare('SELECT locked_reservation_id FROM equipments WHERE id = ?').get(equipmentId) as {
    locked_reservation_id: number | null
  } | undefined
  if (!equipment || !equipment.locked_reservation_id) return

  const locked = db.prepare('SELECT * FROM reservations WHERE id = ?').get(equipment.locked_reservation_id) as {
    id: number
    status: string
    lock_expires_at: string | null
    borrower_name: string
    equipment_id: number
  } | undefined

  if (!locked || locked.status !== 'locked' || !locked.lock_expires_at) return

  const now = new Date()
  const expiresAt = new Date(locked.lock_expires_at + 'Z')
  if (now < expiresAt) return

  const equipName = (db.prepare('SELECT name FROM equipments WHERE id = ?').get(equipmentId) as { name: string }).name

  db.transaction(() => {
    db.prepare(
      `UPDATE reservations SET status = 'expired', expired_at = datetime('now', 'localtime'),
       version = version + 1, updated_at = datetime('now', 'localtime') WHERE id = ? AND status = 'locked'`
    ).run(locked.id)

    db.prepare(
      `UPDATE reservations SET queue_order = queue_order - 1
       WHERE equipment_id = ? AND status IN ('queued', 'notified') AND queue_order > (
         SELECT queue_order FROM reservations WHERE id = ?
       )`
    ).run(equipmentId, locked.id)

    db.prepare(
      'UPDATE equipments SET locked_reservation_id = NULL, updated_at = datetime(\'now\', \'localtime\') WHERE id = ?'
    ).run(equipmentId)

    db.prepare(
      `INSERT INTO operation_logs (equipment_id, action, operator_id, operator_name, detail)
       VALUES (?, 'reservation_lock_expired', ?, ?, ?)`
    ).run(
      equipmentId,
      operatorId || 1,
      operatorName || 'system',
      `预约人 ${locked.borrower_name} 对设备 ${equipName} 的取件锁定已超时失效`
    )

    autoLockNextIfNeeded(equipmentId, operatorId || 1, operatorName || 'system', equipName)
  })()
}

function autoLockNextIfNeeded(equipmentId: number, operatorId: number, operatorName: string, equipmentName: string): void {
  const nextInQueue = db.prepare(
    "SELECT * FROM reservations WHERE equipment_id = ? AND status IN ('queued', 'notified') ORDER BY queue_order ASC LIMIT 1"
  ).get(equipmentId) as {
    id: number
    borrower_name: string
    borrower_phone: string
    queue_order: number
  } | undefined

  if (!nextInQueue) {
    const equip = db.prepare('SELECT status FROM equipments WHERE id = ?').get(equipmentId) as { status: string } | undefined
    if (equip && equip.status === 'reserved') {
      db.prepare(
        "UPDATE equipments SET status = 'available', locked_reservation_id = NULL, updated_at = datetime('now', 'localtime') WHERE id = ?"
      ).run(equipmentId)
    }
    return
  }

  const expiresAt = new Date(Date.now() + PICKUP_LOCK_TIMEOUT_MINUTES * 60 * 1000)
  const expiresAtStr = expiresAt.toISOString().replace('Z', '').replace('T', ' ').substring(0, 19)

  db.prepare(
    `UPDATE reservations SET status = 'locked', locked_at = datetime('now', 'localtime'),
     lock_expires_at = ?, notified_at = COALESCE(notified_at, datetime('now', 'localtime')),
     version = version + 1, updated_at = datetime('now', 'localtime') WHERE id = ?`
  ).run(expiresAtStr, nextInQueue.id)

  db.prepare(
    `UPDATE equipments SET status = 'reserved', locked_reservation_id = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
  ).run(nextInQueue.id, equipmentId)

  db.prepare(
    `INSERT INTO operation_logs (equipment_id, action, operator_id, operator_name, detail)
     VALUES (?, 'reservation_auto_lock', ?, ?, ?)`
  ).run(
    equipmentId,
    operatorId,
    operatorName,
    `自动锁定下一位预约人 ${nextInQueue.borrower_name}(${nextInQueue.borrower_phone}) 为设备 ${equipmentName} 的唯一取件对象，超时时间 ${PICKUP_LOCK_TIMEOUT_MINUTES} 分钟`
  )
}

function checkAndUpdateReservedEquipment(equipmentId: number): void {
  const activeCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM reservations WHERE equipment_id = ? AND status IN ('queued', 'notified', 'locked')"
  ).get(equipmentId) as { cnt: number }

  const equipment = db.prepare('SELECT status FROM equipments WHERE id = ?').get(equipmentId) as { status: string } | undefined
  if (!equipment) return

  if (activeCount.cnt === 0 && equipment.status === 'reserved') {
    db.prepare(
      "UPDATE equipments SET status = 'available', locked_reservation_id = NULL, updated_at = datetime('now', 'localtime') WHERE id = ?"
    ).run(equipmentId)
  }
}

router.get('/', authMiddleware, (req: Request, res: Response): void => {
  const { status, equipment_id, borrower_name, equipment_name } = req.query
  const operator = req.user!

  let sql = `SELECT r.*, e.name as equipment_name, e.type as equipment_type, e.status as equipment_status, e.locked_reservation_id
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
    status: string
  } | undefined

  if (!equipment) {
    res.status(404).json({ success: false, error: '设备不存在' })
    return
  }

  if (equipment.status !== 'borrowed') {
    const statusLabels: Record<string, string> = {
      available: '可借', borrowed: '已借出', reserved: '已预约',
      damaged: '已损坏', pending_confirm: '待确认',
    }
    const label = statusLabels[equipment.status] || equipment.status
    res.status(400).json({ success: false, error: `只有「已借出」的设备才能登记预约，当前设备状态为「${label}」` })
    return
  }

  const existing = db.prepare(
    `SELECT * FROM reservations 
     WHERE equipment_id = ? AND borrower_name = ? AND borrower_phone = ? 
       AND status IN ('queued', 'notified', 'locked')`
  ).get(equipment_id, borrower_name.trim(), borrower_phone.trim()) as { id: number } | undefined

  if (existing) {
    res.status(409).json({ success: false, error: '该借用人已在此设备上有有效预约，不能重复预约' })
    return
  }

  let result
  try {
    result = db.transaction(() => {
      const recheck = db.prepare('SELECT status FROM equipments WHERE id = ?').get(equipment_id) as { status: string } | undefined
      if (!recheck || recheck.status !== 'borrowed') {
        throw new Error('CONCURRENT_CHANGE')
      }

      const maxOrder = db.prepare(
        "SELECT COALESCE(MAX(queue_order), -1) as max_order FROM reservations WHERE equipment_id = ? AND status IN ('queued', 'notified', 'locked')"
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
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'CONCURRENT_CHANGE') {
      res.status(409).json({
        success: false,
        error: '设备状态在提交时已变更，请刷新后重试',
        conflict: { type: 'equipment_status_changed' },
      })
      return
    }
    throw err
  }

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
    operator_id: number
    queue_order: number
  } | undefined

  if (!reservation) {
    res.status(404).json({ success: false, error: '预约记录不存在' })
    return
  }

  if (operator.role !== 'admin' && reservation.operator_id !== operator.id) {
    res.status(403).json({ success: false, error: '只能通知自己经手的预约' })
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

router.put('/:id/lock', authMiddleware, adminMiddleware, (req: Request, res: Response): void => {
  const { id } = req.params
  const operator = req.user!

  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id) as {
    id: number
    equipment_id: number
    borrower_name: string
    borrower_phone: string
    status: string
    queue_order: number
    version: number
    updated_at: string
  } | undefined

  if (!reservation) {
    res.status(404).json({ success: false, error: '预约记录不存在' })
    return
  }

  if (reservation.status !== 'queued' && reservation.status !== 'notified') {
    const statusLabel = RESERVATION_STATUS_LABELS[reservation.status] || reservation.status
    res.status(400).json({ success: false, error: `当前预约状态为「${statusLabel}」，不可执行锁定操作` })
    return
  }

  const equipment = db.prepare('SELECT * FROM equipments WHERE id = ?').get(reservation.equipment_id) as {
    name: string
    status: string
    locked_reservation_id: number | null
  }

  resolveExpiredLocks(reservation.equipment_id, operator.id, operator.username)

  if (equipment.status === 'reserved' && equipment.locked_reservation_id && equipment.locked_reservation_id !== reservation.id) {
    const lockedResv = db.prepare('SELECT borrower_name FROM reservations WHERE id = ?').get(equipment.locked_reservation_id) as { borrower_name: string } | undefined
    res.status(409).json({
      success: false,
      error: `该设备已锁定给预约人 ${lockedResv?.borrower_name || '他人'}，请先释放当前锁定`,
      conflict: { type: 'equipment_already_locked', locked_reservation_id: equipment.locked_reservation_id },
    })
    return
  }

  const expiresAt = new Date(Date.now() + PICKUP_LOCK_TIMEOUT_MINUTES * 60 * 1000)
  const expiresAtStr = expiresAt.toISOString().replace('Z', '').replace('T', ' ').substring(0, 19)

  const updated = db.transaction(() => {
    db.prepare(
      `UPDATE reservations SET status = 'locked', locked_at = datetime('now', 'localtime'),
       lock_expires_at = ?, notified_at = COALESCE(notified_at, datetime('now', 'localtime')),
       version = version + 1, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(expiresAtStr, id)

    db.prepare(
      `UPDATE equipments SET status = 'reserved', locked_reservation_id = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(reservation.id, reservation.equipment_id)

    db.prepare(
      `INSERT INTO operation_logs (equipment_id, action, operator_id, operator_name, detail)
       VALUES (?, 'reservation_manual_lock', ?, ?, ?)`
    ).run(
      reservation.equipment_id,
      operator.id,
      operator.username,
      `管理员手动锁定预约人 ${reservation.borrower_name}(${reservation.borrower_phone}) 为设备 ${equipment.name} 的唯一取件对象，超时时间 ${PICKUP_LOCK_TIMEOUT_MINUTES} 分钟`
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
    queue_order: number
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

  if (reservation.status !== 'queued' && reservation.status !== 'notified' && reservation.status !== 'locked') {
    const statusLabel = RESERVATION_STATUS_LABELS[reservation.status] || reservation.status
    res.status(400).json({ success: false, error: `当前预约状态为「${statusLabel}」，不可执行完成操作` })
    return
  }

  const equipment = db.prepare('SELECT name, status, locked_reservation_id FROM equipments WHERE id = ?').get(reservation.equipment_id) as { name: string; status: string; locked_reservation_id: number | null }

  const updated = db.transaction(() => {
    db.prepare(
      `UPDATE reservations SET status = 'completed', completed_at = datetime('now', 'localtime'),
       version = version + 1, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(id)

    db.prepare(
      `UPDATE reservations SET queue_order = queue_order - 1
       WHERE equipment_id = ? AND status IN ('queued', 'notified', 'locked') AND queue_order > ?`
    ).run(reservation.equipment_id, reservation.queue_order)

    if (equipment.locked_reservation_id === reservation.id) {
      db.prepare(
        "UPDATE equipments SET locked_reservation_id = NULL, updated_at = datetime('now', 'localtime') WHERE id = ?"
      ).run(reservation.equipment_id)
    }

    db.prepare(
      `INSERT INTO operation_logs (equipment_id, action, operator_id, operator_name, detail)
       VALUES (?, 'reservation_complete', ?, ?, ?)`
    ).run(
      reservation.equipment_id,
      operator.id,
      operator.username,
      `预约人 ${reservation.borrower_name} 已完成设备 ${equipment.name} 的取用`
    )

    if (equipment.status === 'reserved') {
      autoLockNextIfNeeded(reservation.equipment_id, operator.id, operator.username, equipment.name)
      checkAndUpdateReservedEquipment(reservation.equipment_id)
    }

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

  if (reservation.status === 'completed' || reservation.status === 'cancelled' || reservation.status === 'expired') {
    const statusLabel = RESERVATION_STATUS_LABELS[reservation.status] || reservation.status
    res.status(400).json({ success: false, error: `当前预约状态为「${statusLabel}」，不可执行取消操作` })
    return
  }

  const equipment = db.prepare('SELECT name, status, locked_reservation_id FROM equipments WHERE id = ?').get(reservation.equipment_id) as { name: string; status: string; locked_reservation_id: number | null }
  const wasLocked = reservation.status === 'locked'

  const updated = db.transaction(() => {
    db.prepare(
      `UPDATE reservations SET status = 'cancelled', cancelled_at = datetime('now', 'localtime'),
       cancel_reason = ?, version = version + 1, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(cancel_reason || '', id)

    db.prepare(
      `UPDATE reservations SET queue_order = queue_order - 1 
       WHERE equipment_id = ? AND status IN ('queued', 'notified', 'locked') AND queue_order > ?`
    ).run(reservation.equipment_id, reservation.queue_order)

    if (wasLocked && equipment.locked_reservation_id === reservation.id) {
      db.prepare(
        "UPDATE equipments SET locked_reservation_id = NULL, updated_at = datetime('now', 'localtime') WHERE id = ?"
      ).run(reservation.equipment_id)
    }

    db.prepare(
      `INSERT INTO operation_logs (equipment_id, action, operator_id, operator_name, detail)
       VALUES (?, 'reservation_cancel', ?, ?, ?)`
    ).run(
      reservation.equipment_id,
      operator.id,
      operator.username,
      `取消 ${reservation.borrower_name} 对设备 ${equipment.name} 的预约${wasLocked ? '（释放取件锁定）' : ''}${cancel_reason ? `，原因：${cancel_reason}` : ''}`
    )

    if (wasLocked && equipment.status === 'reserved') {
      autoLockNextIfNeeded(reservation.equipment_id, operator.id, operator.username, equipment.name)
    }

    checkAndUpdateReservedEquipment(reservation.equipment_id)

    return db.prepare('SELECT * FROM reservations WHERE id = ?').get(id)
  })()

  res.json({ success: true, data: updated })
})

router.put('/:id/release-lock', authMiddleware, adminMiddleware, (req: Request, res: Response): void => {
  const { id } = req.params
  const operator = req.user!

  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id) as {
    id: number
    equipment_id: number
    borrower_name: string
    status: string
    version: number
    updated_at: string
    queue_order: number
  } | undefined

  if (!reservation) {
    res.status(404).json({ success: false, error: '预约记录不存在' })
    return
  }

  if (reservation.status !== 'locked') {
    const statusLabel = RESERVATION_STATUS_LABELS[reservation.status] || reservation.status
    res.status(400).json({ success: false, error: `当前预约状态为「${statusLabel}」，不可执行释放锁定操作` })
    return
  }

  const { expected_version } = req.body
  if (expected_version !== undefined && Number(expected_version) !== reservation.version) {
    res.status(409).json(buildReservationConflictError(reservation, Number(expected_version)))
    return
  }

  const equipment = db.prepare('SELECT name, status, locked_reservation_id FROM equipments WHERE id = ?').get(reservation.equipment_id) as { name: string; status: string; locked_reservation_id: number | null }

  const updated = db.transaction(() => {
    db.prepare(
      `UPDATE reservations SET status = 'cancelled', cancelled_at = datetime('now', 'localtime'),
       cancel_reason = '管理员手动释放取件锁定', version = version + 1, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(id)

    db.prepare(
      `UPDATE reservations SET queue_order = queue_order - 1
       WHERE equipment_id = ? AND status IN ('queued', 'notified', 'locked') AND queue_order > ?`
    ).run(reservation.equipment_id, reservation.queue_order)

    if (equipment.locked_reservation_id === reservation.id) {
      db.prepare(
        "UPDATE equipments SET locked_reservation_id = NULL, updated_at = datetime('now', 'localtime') WHERE id = ?"
      ).run(reservation.equipment_id)
    }

    db.prepare(
      `INSERT INTO operation_logs (equipment_id, action, operator_id, operator_name, detail)
       VALUES (?, 'reservation_release_lock', ?, ?, ?)`
    ).run(
      reservation.equipment_id,
      operator.id,
      operator.username,
      `管理员手动释放预约人 ${reservation.borrower_name} 对设备 ${equipment.name} 的取件锁定`
    )

    if (equipment.status === 'reserved') {
      autoLockNextIfNeeded(reservation.equipment_id, operator.id, operator.username, equipment.name)
    }

    checkAndUpdateReservedEquipment(reservation.equipment_id)

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
         WHERE id = ? AND status IN ('queued', 'notified', 'locked')`
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
       WHERE r.equipment_id = ? AND r.status IN ('queued', 'notified', 'locked') 
       ORDER BY r.queue_order ASC`
    ).all(equipment_id)
  })()

  res.json({ success: true, data: result })
})

function recoverReservationLocksOnStartup(): {
  expired_count: number; relocked_count: number; fixed_orphan_equipment: number } {
  const now = new Date()
  let expiredCount = 0
  let relockedCount = 0
  let fixedOrphanEquipment = 0

  const allLocked = db.prepare(
    "SELECT * FROM reservations WHERE status = 'locked'"
  ).all() as { id: number; equipment_id: number; lock_expires_at: string | null; borrower_name: string }[]

  for (const locked of allLocked) {
    if (locked.lock_expires_at) {
      const expiresAt = new Date(locked.lock_expires_at + 'Z')
      if (now > expiresAt) {
        resolveExpiredLocks(locked.equipment_id)
        expiredCount++
      }
    }
  }

  const reservedEquipments = db.prepare(
    "SELECT id, locked_reservation_id FROM equipments WHERE status = 'reserved'"
  ).all() as { id: number; locked_reservation_id: number | null }[]

  for (const equip of reservedEquipments) {
    const equipName = (db.prepare('SELECT name FROM equipments WHERE id = ?').get(equip.id) as { name: string }).name
    if (equip.locked_reservation_id) {
      const resv = db.prepare(
        "SELECT status, lock_expires_at FROM reservations WHERE id = ?"
      ).get(equip.locked_reservation_id) as { status: string; lock_expires_at: string | null } | undefined
      if (!resv) {
        db.prepare(
          "UPDATE equipments SET locked_reservation_id = NULL, updated_at = datetime('now', 'localtime') WHERE id = ?"
        ).run(equip.id)
        const activeResvs = db.prepare(
          "SELECT COUNT(*) as cnt FROM reservations WHERE equipment_id = ? AND status IN ('queued', 'notified', 'locked')"
        ).get(equip.id) as { cnt: number }
        if (activeResvs.cnt === 0) {
          db.prepare(
            "UPDATE equipments SET status = 'available', updated_at = datetime('now', 'localtime') WHERE id = ?"
          ).run(equip.id)
        } else {
          autoLockNextIfNeeded(equip.id, 1, 'system', equipName)
          relockedCount++
        }
        fixedOrphanEquipment++
      } else if (resv.status !== 'locked') {
        db.prepare(
          "UPDATE equipments SET locked_reservation_id = NULL, updated_at = datetime('now', 'localtime') WHERE id = ?"
        ).run(equip.id)
        if (resv.status === 'queued' || resv.status === 'notified') {
          autoLockNextIfNeeded(equip.id, 1, 'system', equipName)
          relockedCount++
        } else {
          const activeCount = db.prepare(
            "SELECT COUNT(*) as cnt FROM reservations WHERE equipment_id = ? AND status IN ('queued', 'notified', 'locked')"
          ).get(equip.id) as { cnt: number }
          if (activeCount.cnt === 0) {
            db.prepare(
              "UPDATE equipments SET status = 'available', updated_at = datetime('now', 'localtime') WHERE id = ?"
            ).run(equip.id)
          }
        }
        fixedOrphanEquipment++
      }
    }
  }

  const noLockedEquip = db.prepare(
    `SELECT e.id FROM equipments e
     WHERE e.status = 'reserved' AND e.locked_reservation_id IS NULL
     AND EXISTS (SELECT 1 FROM reservations r WHERE r.equipment_id = e.id AND r.status IN ('queued', 'notified', 'locked'))`
  ).all() as { id: number }[]

  for (const equip of noLockedEquip) {
    const equipName = (db.prepare('SELECT name FROM equipments WHERE id = ?').get(equip.id) as { name: string }).name
    autoLockNextIfNeeded(equip.id, 1, 'system', equipName)
    relockedCount++
  }

  db.prepare(
    `INSERT INTO operation_logs (equipment_id, action, operator_id, operator_name, detail)
    VALUES (NULL, 'system_recovery', 1, 'system', ?)`
  ).run(
    `预约锁定台启动恢复：释放过期锁定 ${expiredCount} 项，重建锁定 ${relockedCount} 项，修复孤立设备 ${fixedOrphanEquipment} 项`
  )

  return {
    expired_count: expiredCount,
    relocked_count: relockedCount,
    fixed_orphan_equipment: fixedOrphanEquipment,
  }
}

function runPeriodicLockCleanup(): number {
  const candidates = db.prepare(
    "SELECT DISTINCT equipment_id FROM reservations WHERE status = 'locked' AND lock_expires_at IS NOT NULL"
  ).all() as { equipment_id: number }[]

  let cleaned = 0
  for (const { equipment_id } of candidates) {
    const before = db.prepare("SELECT status FROM reservations WHERE equipment_id = ? AND status = 'locked'").get(equipment_id)
    resolveExpiredLocks(equipment_id)
    const after = db.prepare("SELECT status FROM reservations WHERE equipment_id = ? AND status = 'locked'").get(equipment_id)
    if (!after && before) {
      cleaned++
    }
  }
  return cleaned
}

let cleanupTimer: NodeJS.Timeout | null = null

function startPeriodicLockCleanup(intervalMs: number = 60 * 1000): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
  }
  cleanupTimer = setInterval(() => {
    try {
      runPeriodicLockCleanup()
    } catch (e) {
      console.error('[Periodic Cleanup] 定时清理超时锁定出错:', e)
    }
  }, intervalMs)
  console.log(`[Periodic Cleanup] 已启动预约锁定超时定时清理任务，间隔 ${intervalMs / 1000} 秒`)
}

function stopPeriodicLockCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
    console.log('[Periodic Cleanup] 已停止定时清理任务')
  }
}

export default router
export {
  resolveExpiredLocks, autoLockNextIfNeeded, PICKUP_LOCK_TIMEOUT_MINUTES, recoverReservationLocksOnStartup, runPeriodicLockCleanup, startPeriodicLockCleanup, stopPeriodicLockCleanup
}
