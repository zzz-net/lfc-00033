import { Router, type Request, type Response } from 'express'
import db from '../db.js'
import { authMiddleware, adminMiddleware } from '../middleware/auth.js'
import { resolveExpiredLocks, autoLockNextIfNeeded } from './reservations.js'

const router = Router()

interface OfflineSignoffRecord {
  id: number
  type: 'borrow' | 'return' | 'damage'
  status: 'pending' | 'syncing' | 'failed' | 'completed'
  equipment_id: number
  equipment_snapshot: string | null
  borrower_name: string
  borrower_phone: string
  damage_description: string
  signer_name: string
  notes: string
  error_message: string
  conflict_info: string | null
  server_record_id: number | null
  operator_id: number
  operator_name: string
  created_at: string
  synced_at: string | null
  updated_at: string
}

function parseJsonField<T>(value: string | null): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function formatRecord(row: OfflineSignoffRecord) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    equipment_id: row.equipment_id,
    equipment_snapshot: parseJsonField(row.equipment_snapshot),
    borrower_name: row.borrower_name,
    borrower_phone: row.borrower_phone,
    damage_description: row.damage_description,
    signer_name: row.signer_name,
    notes: row.notes,
    error_message: row.error_message,
    conflict_info: parseJsonField(row.conflict_info),
    server_record_id: row.server_record_id,
    operator_id: row.operator_id,
    operator_name: row.operator_name,
    created_at: row.created_at,
    synced_at: row.synced_at,
    updated_at: row.updated_at,
  }
}

router.get('/', authMiddleware, (req: Request, res: Response): void => {
  const { status, type, equipment_id, operator_id } = req.query
  const isAdmin = req.user!.role === 'admin'

  let sql = `SELECT * FROM offline_signoff_records WHERE 1=1`
  const params: unknown[] = []

  if (status) {
    sql += ' AND status = ?'
    params.push(status)
  }
  if (type) {
    sql += ' AND type = ?'
    params.push(type)
  }
  if (equipment_id) {
    sql += ' AND equipment_id = ?'
    params.push(Number(equipment_id))
  }
  if (isAdmin && operator_id) {
    sql += ' AND operator_id = ?'
    params.push(Number(operator_id))
  }
  if (!isAdmin) {
    sql += ' AND operator_id = ?'
    params.push(req.user!.id)
  }

  sql += ' ORDER BY created_at DESC'

  const rows = db.prepare(sql).all(...params) as OfflineSignoffRecord[]
  res.json({ success: true, data: rows.map(formatRecord) })
})

router.get('/stats', authMiddleware, (req: Request, res: Response): void => {
  const isAdmin = req.user!.role === 'admin'

  let whereClause = 'WHERE 1=1'
  const params: unknown[] = []

  if (!isAdmin) {
    whereClause += ' AND operator_id = ?'
    params.push(req.user!.id)
  }

  const statuses = ['pending', 'syncing', 'failed', 'completed']
  const stats: Record<string, number> = {}

  for (const status of statuses) {
    const row = db.prepare(
      `SELECT COUNT(*) as count FROM offline_signoff_records ${whereClause} AND status = ?`
    ).get(...params, status) as { count: number }
    stats[status] = row.count
  }

  const totalRow = db.prepare(
    `SELECT COUNT(*) as count FROM offline_signoff_records ${whereClause}`
  ).get(...params) as { count: number }
  stats.total = totalRow.count

  res.json({ success: true, data: stats })
})

router.get('/:id', authMiddleware, (req: Request, res: Response): void => {
  const { id } = req.params
  const isAdmin = req.user!.role === 'admin'

  let sql = 'SELECT * FROM offline_signoff_records WHERE id = ?'
  const params: unknown[] = [Number(id)]

  if (!isAdmin) {
    sql += ' AND operator_id = ?'
    params.push(req.user!.id)
  }

  const row = db.prepare(sql).get(...params) as OfflineSignoffRecord | undefined

  if (!row) {
    res.status(404).json({ success: false, error: '记录不存在或无权限查看' })
    return
  }

  res.json({ success: true, data: formatRecord(row) })
})

router.post('/', authMiddleware, (req: Request, res: Response): void => {
  const { type, equipment_id, borrower_name, borrower_phone, damage_description, signer_name, notes } = req.body

  if (!type || !equipment_id || !borrower_name || !borrower_phone) {
    res.status(400).json({ success: false, error: '类型、设备ID、借用人姓名和电话为必填项' })
    return
  }

  if (!['borrow', 'return', 'damage'].includes(type)) {
    res.status(400).json({ success: false, error: '无效的记录类型' })
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

  const operator = req.user!
  const equipmentSnapshot = JSON.stringify(equipment)

  const result = db.prepare(
    `INSERT INTO offline_signoff_records 
     (type, equipment_id, equipment_snapshot, borrower_name, borrower_phone, 
      damage_description, signer_name, notes, operator_id, operator_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    type,
    equipment_id,
    equipmentSnapshot,
    borrower_name.trim(),
    borrower_phone.trim(),
    damage_description || '',
    signer_name || '',
    notes || '',
    operator.id,
    operator.username
  )

  const newRecord = db.prepare('SELECT * FROM offline_signoff_records WHERE id = ?').get(result.lastInsertRowid) as OfflineSignoffRecord

  db.prepare(
    `INSERT INTO operation_logs (equipment_id, action, operator_id, operator_name, detail)
     VALUES (?, 'offline_signoff_create', ?, ?, ?)`
  ).run(
    equipment_id,
    operator.id,
    operator.username,
    `创建离线${type === 'borrow' ? '借出' : type === 'return' ? '归还' : '损坏'}补录记录 #${result.lastInsertRowid}，设备：${equipment.name}`
  )

  res.status(201).json({ success: true, data: formatRecord(newRecord) })
})

function syncBorrowRecord(
  record: OfflineSignoffRecord,
  operator: { id: number; username: string; role: string },
  force = false
) {
  const equipment = db.prepare('SELECT * FROM equipments WHERE id = ?').get(record.equipment_id) as {
    id: number
    name: string
    type: string
    status: string
    deposit_amount: number
    locked_reservation_id: number | null
  } | undefined

  if (!equipment) {
    throw new Error('SYNC_ERROR:设备不存在')
  }

  if (!force) {
    const snapshot = parseJsonField<{ status: string }>(record.equipment_snapshot)
    if (snapshot && snapshot.status !== equipment.status) {
      const conflict = {
        type: 'equipment_status_changed',
        snapshot_status: snapshot.status,
        current_status: equipment.status,
        equipment_name: equipment.name,
        equipment_id: equipment.id,
      }
      const err: Error & { conflict?: typeof conflict } = new Error('CONFLICT:设备状态已变更')
      err.conflict = conflict
      throw err
    }

    if (equipment.status !== 'available' && equipment.status !== 'reserved') {
      const statusLabels: Record<string, string> = {
        available: '可借', borrowed: '已借出', reserved: '已预约',
        damaged: '已损坏', pending_confirm: '待确认',
      }
      const label = statusLabels[equipment.status] || equipment.status
      throw new Error(`SYNC_ERROR:该设备当前不可借出，状态为「${label}」`)
    }
  }

  if (equipment.status === 'reserved') {
    resolveExpiredLocks(record.equipment_id, operator.id, operator.username)

    const refreshedEquip = db.prepare('SELECT locked_reservation_id FROM equipments WHERE id = ?').get(record.equipment_id) as { locked_reservation_id: number | null }

    if (refreshedEquip.locked_reservation_id && !force) {
      const lockedReservation = db.prepare(
        'SELECT * FROM reservations WHERE id = ? AND status = \'locked\''
      ).get(refreshedEquip.locked_reservation_id) as { id: number; borrower_name: string; borrower_phone: string } | undefined

      if (lockedReservation) {
        if (lockedReservation.borrower_name !== record.borrower_name.trim() ||
            lockedReservation.borrower_phone !== record.borrower_phone.trim()) {
          const conflict = {
            type: 'pickup_lock_mismatch',
            locked_reservation_id: lockedReservation.id,
            locked_borrower_name: lockedReservation.borrower_name,
            locked_borrower_phone: lockedReservation.borrower_phone,
          }
          const err: Error & { conflict?: typeof conflict } = new Error('CONFLICT:取件锁定身份不匹配')
          err.conflict = conflict
          throw err
        }
      }
    }
  }

  const borrow = db.transaction(() => {
    const recheck = db.prepare('SELECT status, locked_reservation_id FROM equipments WHERE id = ?').get(record.equipment_id) as { status: string; locked_reservation_id: number | null } | undefined
    if (!force) {
      if (!recheck || (recheck.status !== 'available' && recheck.status !== 'reserved')) {
        throw new Error('CONCURRENT_CHANGE')
      }

      if (recheck.locked_reservation_id) {
        const currentLocked = db.prepare('SELECT borrower_name, borrower_phone FROM reservations WHERE id = ? AND status = \'locked\'').get(recheck.locked_reservation_id) as { borrower_name: string; borrower_phone: string } | undefined
        if (currentLocked && (currentLocked.borrower_name !== record.borrower_name.trim() || currentLocked.borrower_phone !== record.borrower_phone.trim())) {
          throw new Error('LOCK_CONFLICT')
        }
      }
    }

    const recordResult = db.prepare(
      `INSERT INTO borrow_records (equipment_id, borrower_name, borrower_phone, status, deposit_frozen)
       VALUES (?, ?, ?, 'borrowed', ?)`
    ).run(record.equipment_id, record.borrower_name, record.borrower_phone, equipment.deposit_amount)

    db.prepare(
      `INSERT INTO deposit_transactions (borrow_record_id, equipment_id, equipment_name, borrower_name, type, amount, operator_id, operator_name)
       VALUES (?, ?, ?, ?, 'freeze', ?, ?, ?)`
    ).run(recordResult.lastInsertRowid, record.equipment_id, equipment.name, record.borrower_name, equipment.deposit_amount, operator.id, operator.username)

    db.prepare(
      `UPDATE equipments SET status = 'borrowed', locked_reservation_id = NULL, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(record.equipment_id)

    db.prepare(
      `INSERT INTO operation_logs (borrow_record_id, equipment_id, action, operator_id, operator_name, detail)
       VALUES (?, ?, 'borrow', ?, ?, ?)`
    ).run(recordResult.lastInsertRowid, record.equipment_id, operator.id, operator.username,
      `离线补录同步：借出设备 ${equipment.name} 给 ${record.borrower_name}，冻结押金 ${equipment.deposit_amount}（来源：离线补录记录#${record.id}）`)

    const matchingReservation = db.prepare(
      `SELECT * FROM reservations 
       WHERE equipment_id = ? AND borrower_name = ? AND borrower_phone = ? 
         AND status IN ('queued', 'notified', 'locked')
       ORDER BY queue_order ASC LIMIT 1`
    ).get(record.equipment_id, record.borrower_name, record.borrower_phone) as { id: number; queue_order: number; status: string } | undefined

    if (matchingReservation) {
      db.prepare(
        `UPDATE reservations SET status = 'completed', completed_at = datetime('now', 'localtime'),
         version = version + 1, updated_at = datetime('now', 'localtime') WHERE id = ?`
      ).run(matchingReservation.id)

      db.prepare(
        `UPDATE reservations SET queue_order = queue_order - 1 
         WHERE equipment_id = ? AND status IN ('queued', 'notified', 'locked') AND queue_order > ?`
      ).run(record.equipment_id, matchingReservation.queue_order)

      db.prepare(
        `INSERT INTO operation_logs (equipment_id, action, operator_id, operator_name, detail)
         VALUES (?, 'reservation_auto_complete', ?, ?, ?)`
      ).run(
        record.equipment_id,
        operator.id,
        operator.username,
        `离线补录同步：预约人 ${record.borrower_name} 已实际取件设备 ${equipment.name}，自动完成对应预约`
      )
    }

    return db.prepare('SELECT * FROM borrow_records WHERE id = ?').get(recordResult.lastInsertRowid)
  })()

  return borrow as { id: number }
}

function syncReturnRecord(
  record: OfflineSignoffRecord,
  operator: { id: number; username: string; role: string },
  force = false
) {
  const equipment = db.prepare('SELECT * FROM equipments WHERE id = ?').get(record.equipment_id) as {
    id: number
    name: string
    status: string
  }

  if (!equipment) {
    throw new Error('SYNC_ERROR:设备不存在')
  }

  if (!force) {
    const snapshot = parseJsonField<{ status: string }>(record.equipment_snapshot)
    if (snapshot && snapshot.status !== equipment.status) {
      const conflict = {
        type: 'equipment_status_changed',
        snapshot_status: snapshot.status,
        current_status: equipment.status,
        equipment_name: equipment.name,
        equipment_id: equipment.id,
      }
      const err: Error & { conflict?: typeof conflict } = new Error('CONFLICT:设备状态已变更')
      err.conflict = conflict
      throw err
    }
  }

  const borrowRecords = db.prepare(
    `SELECT * FROM borrow_records 
     WHERE equipment_id = ? AND borrower_name = ? AND borrower_phone = ? AND status = 'borrowed'
     ORDER BY created_at DESC LIMIT 1`
  ).get(record.equipment_id, record.borrower_name, record.borrower_phone) as {
    id: number
    equipment_id: number
    borrower_name: string
    status: string
    deposit_frozen: number
    deposit_deducted: number
  } | undefined

  if (!borrowRecords) {
    throw new Error('SYNC_ERROR:未找到匹配的借出记录，可能已归还或信息不匹配')
  }

  const updated = db.transaction(() => {
    const refundAmount = borrowRecords.deposit_frozen - borrowRecords.deposit_deducted

    db.prepare(
      `UPDATE borrow_records SET status = 'returned', return_time = datetime('now', 'localtime'), deposit_refunded = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(refundAmount, borrowRecords.id)

    db.prepare(
      `INSERT INTO deposit_transactions (borrow_record_id, equipment_id, equipment_name, borrower_name, type, amount, operator_id, operator_name)
       VALUES (?, ?, ?, ?, 'refund', ?, ?, ?)`
    ).run(borrowRecords.id, record.equipment_id, equipment.name, record.borrower_name, refundAmount, operator.id, operator.username)

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
    ).run(borrowRecords.id, record.equipment_id, operator.id, operator.username,
      `离线补录同步：归还设备 ${equipment.name}，退还押金 ${refundAmount}（来源：离线补录记录#${record.id}）`)

    const borrowRecord = db.prepare('SELECT * FROM borrow_records WHERE id = ?').get(borrowRecords.id)
    return { borrowRecord, lockedReservation }
  })()

  return updated.borrowRecord as { id: number }
}

function syncDamageRecord(
  record: OfflineSignoffRecord,
  operator: { id: number; username: string; role: string },
  force = false
) {
  const equipment = db.prepare('SELECT * FROM equipments WHERE id = ?').get(record.equipment_id) as {
    id: number
    name: string
    status: string
  }

  if (!equipment) {
    throw new Error('SYNC_ERROR:设备不存在')
  }

  if (!force) {
    const snapshot = parseJsonField<{ status: string }>(record.equipment_snapshot)
    if (snapshot && snapshot.status !== equipment.status) {
      const conflict = {
        type: 'equipment_status_changed',
        snapshot_status: snapshot.status,
        current_status: equipment.status,
        equipment_name: equipment.name,
        equipment_id: equipment.id,
      }
      const err: Error & { conflict?: typeof conflict } = new Error('CONFLICT:设备状态已变更')
      err.conflict = conflict
      throw err
    }
  }

  const borrowRecords = db.prepare(
    `SELECT * FROM borrow_records 
     WHERE equipment_id = ? AND borrower_name = ? AND borrower_phone = ? AND status = 'borrowed'
     ORDER BY created_at DESC LIMIT 1`
  ).get(record.equipment_id, record.borrower_name, record.borrower_phone) as {
    id: number
    equipment_id: number
    borrower_name: string
    status: string
  } | undefined

  if (!borrowRecords) {
    throw new Error('SYNC_ERROR:未找到匹配的借出记录，无法登记损坏')
  }

  const updated = db.transaction(() => {
    db.prepare(
      `UPDATE borrow_records SET status = 'pending_confirm', damage_description = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(record.damage_description || '', borrowRecords.id)

    db.prepare(
      "UPDATE equipments SET status = 'pending_confirm', updated_at = datetime('now', 'localtime') WHERE id = ?"
    ).run(record.equipment_id)

    db.prepare(
      `INSERT INTO operation_logs (borrow_record_id, equipment_id, action, operator_id, operator_name, detail)
       VALUES (?, ?, 'damage_report', ?, ?, ?)`
    ).run(borrowRecords.id, record.equipment_id, operator.id, operator.username,
      `离线补录同步：报告设备 ${equipment.name} 损坏：${record.damage_description || '无描述'}（来源：离线补录记录#${record.id}）`)

    return db.prepare('SELECT * FROM borrow_records WHERE id = ?').get(borrowRecords.id)
  })()

  return updated as { id: number }
}

router.post('/:id/sync', authMiddleware, (req: Request, res: Response): void => {
  const { id } = req.params
  const isAdmin = req.user!.role === 'admin'
  const operator = req.user!

  let sql = 'SELECT * FROM offline_signoff_records WHERE id = ?'
  const params: unknown[] = [Number(id)]

  if (!isAdmin) {
    sql += ' AND operator_id = ?'
    params.push(operator.id)
  }

  const record = db.prepare(sql).get(...params) as OfflineSignoffRecord | undefined

  if (!record) {
    res.status(404).json({ success: false, error: '记录不存在或无权限操作' })
    return
  }

  if (record.status === 'completed') {
    res.status(400).json({ success: false, error: '该记录已完成同步' })
    return
  }

  if (record.status === 'syncing') {
    res.status(409).json({ success: false, error: '该记录正在同步中，请稍候' })
    return
  }

  db.prepare(
    `UPDATE offline_signoff_records SET status = 'syncing', updated_at = datetime('now', 'localtime') WHERE id = ?`
  ).run(record.id)

  try {
    let serverRecordId: number

    if (record.type === 'borrow') {
      serverRecordId = syncBorrowRecord(record, operator).id
    } else if (record.type === 'return') {
      serverRecordId = syncReturnRecord(record, operator).id
    } else {
      serverRecordId = syncDamageRecord(record, operator).id
    }

    db.prepare(
      `UPDATE offline_signoff_records 
       SET status = 'completed', server_record_id = ?, synced_at = datetime('now', 'localtime'), 
           error_message = '', conflict_info = NULL, updated_at = datetime('now', 'localtime')
       WHERE id = ?`
    ).run(serverRecordId, record.id)

    const updatedRecord = db.prepare('SELECT * FROM offline_signoff_records WHERE id = ?').get(record.id) as OfflineSignoffRecord

    db.prepare(
      `INSERT INTO operation_logs (equipment_id, action, operator_id, operator_name, detail)
       VALUES (?, 'offline_signoff_sync', ?, ?, ?)`
    ).run(
      record.equipment_id,
      operator.id,
      operator.username,
      `离线补录记录 #${record.id} 同步成功，生成服务端记录 #${serverRecordId}`
    )

    res.json({ success: true, data: formatRecord(updatedRecord) })
  } catch (err: unknown) {
    const error = err as Error & { conflict?: unknown }

    let errorMessage = error.message
    let conflictInfo = error.conflict || null
    let statusCode = 500

    if (error.message.startsWith('CONFLICT:')) {
      statusCode = 409
      errorMessage = error.message.replace('CONFLICT:', '')
    } else if (error.message.startsWith('SYNC_ERROR:')) {
      statusCode = 400
      errorMessage = error.message.replace('SYNC_ERROR:', '')
    } else if (error.message === 'CONCURRENT_CHANGE' || error.message === 'LOCK_CONFLICT') {
      statusCode = 409
      errorMessage = '提交时检测到并发冲突，请重试'
      conflictInfo = { type: 'concurrent_conflict' }
    }

    db.prepare(
      `UPDATE offline_signoff_records 
       SET status = 'failed', error_message = ?, conflict_info = ?, updated_at = datetime('now', 'localtime')
       WHERE id = ?`
    ).run(errorMessage, conflictInfo ? JSON.stringify(conflictInfo) : null, record.id)

    const failedRecord = db.prepare('SELECT * FROM offline_signoff_records WHERE id = ?').get(record.id) as OfflineSignoffRecord

    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      conflict: conflictInfo,
      data: formatRecord(failedRecord),
    })
  }
})

router.post('/batch-sync', authMiddleware, (req: Request, res: Response): void => {
  const isAdmin = req.user!.role === 'admin'
  const operator = req.user!

  let sql = `SELECT * FROM offline_signoff_records WHERE status IN ('pending', 'failed')`
  const params: unknown[] = []

  if (!isAdmin) {
    sql += ' AND operator_id = ?'
    params.push(operator.id)
  }

  sql += ' ORDER BY created_at ASC'

  const records = db.prepare(sql).all(...params) as OfflineSignoffRecord[]

  if (records.length === 0) {
    res.json({ success: true, data: { total: 0, success: 0, failed: 0, results: [] } })
    return
  }

  const results: { id: number; status: 'success' | 'failed'; error?: string; conflict?: unknown }[] = []
  let successCount = 0
  let failedCount = 0

  for (const record of records) {
    try {
      db.prepare(
        `UPDATE offline_signoff_records SET status = 'syncing', updated_at = datetime('now', 'localtime') WHERE id = ?`
      ).run(record.id)

      let serverRecordId: number

      if (record.type === 'borrow') {
        serverRecordId = syncBorrowRecord(record, operator).id
      } else if (record.type === 'return') {
        serverRecordId = syncReturnRecord(record, operator).id
      } else {
        serverRecordId = syncDamageRecord(record, operator).id
      }

      db.prepare(
        `UPDATE offline_signoff_records 
         SET status = 'completed', server_record_id = ?, synced_at = datetime('now', 'localtime'), 
             error_message = '', conflict_info = NULL, updated_at = datetime('now', 'localtime')
         WHERE id = ?`
      ).run(serverRecordId, record.id)

      results.push({ id: record.id, status: 'success' })
      successCount++
    } catch (err: unknown) {
      const error = err as Error & { conflict?: unknown }
      let errorMessage = error.message
      let conflictInfo = error.conflict || null

      if (error.message.startsWith('CONFLICT:')) {
        errorMessage = error.message.replace('CONFLICT:', '')
      } else if (error.message.startsWith('SYNC_ERROR:')) {
        errorMessage = error.message.replace('SYNC_ERROR:', '')
      } else if (error.message === 'CONCURRENT_CHANGE' || error.message === 'LOCK_CONFLICT') {
        errorMessage = '提交时检测到并发冲突'
        conflictInfo = { type: 'concurrent_conflict' }
      }

      db.prepare(
        `UPDATE offline_signoff_records 
         SET status = 'failed', error_message = ?, conflict_info = ?, updated_at = datetime('now', 'localtime')
         WHERE id = ?`
      ).run(errorMessage, conflictInfo ? JSON.stringify(conflictInfo) : null, record.id)

      results.push({ id: record.id, status: 'failed', error: errorMessage, conflict: conflictInfo })
      failedCount++
    }
  }

  res.json({
    success: true,
    data: {
      total: records.length,
      success: successCount,
      failed: failedCount,
      results,
    },
  })
})

router.post('/:id/resolve', authMiddleware, adminMiddleware, (req: Request, res: Response): void => {
  const { id } = req.params
  const { action, force } = req.body

  const record = db.prepare('SELECT * FROM offline_signoff_records WHERE id = ?').get(Number(id)) as OfflineSignoffRecord | undefined

  if (!record) {
    res.status(404).json({ success: false, error: '记录不存在' })
    return
  }

  if (record.status !== 'failed') {
    res.status(400).json({ success: false, error: '只有失败状态的记录才能解决冲突' })
    return
  }

  const operator = req.user!

  if (action === 'retry') {
    db.prepare(
      `UPDATE offline_signoff_records SET status = 'pending', error_message = '', conflict_info = NULL, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(record.id)

    db.prepare(
      `INSERT INTO operation_logs (equipment_id, action, operator_id, operator_name, detail)
       VALUES (?, 'offline_signoff_resolve', ?, ?, ?)`
    ).run(
      record.equipment_id,
      operator.id,
      operator.username,
      `管理员重置离线补录记录 #${record.id} 为待同步状态`
    )

    const updatedRecord = db.prepare('SELECT * FROM offline_signoff_records WHERE id = ?').get(record.id) as OfflineSignoffRecord
    res.json({ success: true, data: formatRecord(updatedRecord) })
    return
  }

  if (action === 'force' && force) {
    try {
      db.prepare(
        `UPDATE offline_signoff_records SET status = 'syncing', updated_at = datetime('now', 'localtime') WHERE id = ?`
      ).run(record.id)

      let serverRecordId: number

      if (record.type === 'borrow') {
        serverRecordId = syncBorrowRecord(record, operator, true).id
      } else if (record.type === 'return') {
        serverRecordId = syncReturnRecord(record, operator, true).id
      } else {
        serverRecordId = syncDamageRecord(record, operator, true).id
      }

      db.prepare(
        `UPDATE offline_signoff_records 
         SET status = 'completed', server_record_id = ?, synced_at = datetime('now', 'localtime'), 
             error_message = '', conflict_info = NULL, updated_at = datetime('now', 'localtime')
         WHERE id = ?`
      ).run(serverRecordId, record.id)

      db.prepare(
        `INSERT INTO operation_logs (equipment_id, action, operator_id, operator_name, detail)
         VALUES (?, 'offline_signoff_force_sync', ?, ?, ?)`
      ).run(
        record.equipment_id,
        operator.id,
        operator.username,
        `管理员强制同步离线补录记录 #${record.id}，生成服务端记录 #${serverRecordId}`
      )

      const updatedRecord = db.prepare('SELECT * FROM offline_signoff_records WHERE id = ?').get(record.id) as OfflineSignoffRecord
      res.json({ success: true, data: formatRecord(updatedRecord) })
    } catch (err: unknown) {
      const error = err as Error
      db.prepare(
        `UPDATE offline_signoff_records 
         SET status = 'failed', error_message = ?, updated_at = datetime('now', 'localtime')
         WHERE id = ?`
      ).run(error.message, record.id)

      res.status(400).json({ success: false, error: error.message })
    }
    return
  }

  if (action === 'discard') {
    db.prepare('DELETE FROM offline_signoff_records WHERE id = ?').run(record.id)

    db.prepare(
      `INSERT INTO operation_logs (equipment_id, action, operator_id, operator_name, detail)
       VALUES (?, 'offline_signoff_discard', ?, ?, ?)`
    ).run(
      record.equipment_id,
      operator.id,
      operator.username,
      `管理员放弃并删除离线补录记录 #${record.id}`
    )

    res.json({ success: true, data: { id: record.id, deleted: true } })
    return
  }

  res.status(400).json({ success: false, error: '无效的解决动作' })
})

router.delete('/:id', authMiddleware, adminMiddleware, (req: Request, res: Response): void => {
  const { id } = req.params

  const record = db.prepare('SELECT * FROM offline_signoff_records WHERE id = ?').get(Number(id)) as OfflineSignoffRecord | undefined

  if (!record) {
    res.status(404).json({ success: false, error: '记录不存在' })
    return
  }

  if (record.status === 'syncing') {
    res.status(400).json({ success: false, error: '正在同步的记录不可删除' })
    return
  }

  db.prepare('DELETE FROM offline_signoff_records WHERE id = ?').run(record.id)

  const operator = req.user!
  db.prepare(
    `INSERT INTO operation_logs (equipment_id, action, operator_id, operator_name, detail)
     VALUES (?, 'offline_signoff_delete', ?, ?, ?)`
  ).run(
    record.equipment_id,
    operator.id,
    operator.username,
    `管理员删除离线补录记录 #${record.id}`
  )

  res.json({ success: true, data: { id: record.id, deleted: true } })
})

router.get('/export/json', authMiddleware, (req: Request, res: Response): void => {
  const isAdmin = req.user!.role === 'admin'

  let sql = 'SELECT * FROM offline_signoff_records WHERE 1=1'
  const params: unknown[] = []

  if (!isAdmin) {
    sql += ' AND operator_id = ?'
    params.push(req.user!.id)
  }

  sql += ' ORDER BY created_at ASC'

  const rows = db.prepare(sql).all(...params) as OfflineSignoffRecord[]
  const records = rows.map(formatRecord)

  const exportData = {
    version: 1,
    exported_at: new Date().toISOString(),
    exported_by: { id: req.user!.id, username: req.user!.username },
    count: records.length,
    records,
  }

  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Content-Disposition', 'attachment; filename="offline-signoffs.json"')
  res.json(exportData)
})

router.post('/import/json', authMiddleware, adminMiddleware, (req: Request, res: Response): void => {
  const { records } = req.body

  if (!Array.isArray(records) || records.length === 0) {
    res.status(400).json({ success: false, error: '无效的导入数据' })
    return
  }

  const operator = req.user!
  let imported = 0
  let skipped = 0
  const results: { original_id: number; new_id: number; status: string }[] = []

  const insertStmt = db.prepare(
    `INSERT INTO offline_signoff_records 
     (type, status, equipment_id, equipment_snapshot, borrower_name, borrower_phone,
      damage_description, signer_name, notes, operator_id, operator_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  const tx = db.transaction(() => {
    for (const record of records) {
      if (!record.type || !record.equipment_id || !record.borrower_name || !record.borrower_phone) {
        skipped++
        results.push({ original_id: record.id, new_id: 0, status: 'skipped: missing required fields' })
        continue
      }

      const equipment = db.prepare('SELECT id FROM equipments WHERE id = ?').get(record.equipment_id)
      if (!equipment) {
        skipped++
        results.push({ original_id: record.id, new_id: 0, status: 'skipped: equipment not found' })
        continue
      }

      const createdAt = record.created_at || new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')
      const result = insertStmt.run(
        record.type,
        'pending',
        record.equipment_id,
        record.equipment_snapshot ? JSON.stringify(record.equipment_snapshot) : null,
        record.borrower_name,
        record.borrower_phone,
        record.damage_description || '',
        record.signer_name || '',
        record.notes || '',
        operator.id,
        operator.username,
        createdAt
      )

      imported++
      results.push({ original_id: record.id, new_id: result.lastInsertRowid as number, status: 'imported' })
    }
  })

  tx()

  db.prepare(
    `INSERT INTO operation_logs (action, operator_id, operator_name, detail)
     VALUES ('offline_signoff_import', ?, ?, ?)`
  ).run(
    operator.id,
    operator.username,
    `批量导入离线补录记录 ${imported} 条，跳过 ${skipped} 条`
  )

  res.json({
    success: true,
    data: {
      imported,
      skipped,
      total: records.length,
      results,
    },
  })
})

export default router
