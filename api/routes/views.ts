import { Router } from 'express'
import type { Request, Response } from 'express'
import db from '../db.js'
import { authMiddleware, adminMiddleware } from '../middleware/auth.js'

const router = Router()

function logViewOperation(
  viewId: number | null,
  viewName: string,
  action: 'create' | 'update' | 'delete' | 'apply' | 'snapshot' | 'rollback' | 'conflict',
  operatorId: number,
  operatorName: string,
  detail: string = ''
): void {
  db.prepare(
    'INSERT INTO view_operation_logs (view_id, view_name, action, operator_id, operator_name, detail) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(viewId, viewName, action, operatorId, operatorName, detail)
}

function rowToView(r: Record<string, unknown>, userId: number) {
  return {
    id: r.id,
    user_id: r.user_id,
    page: r.page,
    name: r.name,
    filters: r.filters ? JSON.parse(String(r.filters)) : {},
    sort_by: r.sort_by,
    sort_order: r.sort_order,
    page_size: r.page_size,
    visible_columns: r.visible_columns ? JSON.parse(String(r.visible_columns)) : null,
    is_default: r.is_default === 1,
    is_owner: Number(r.user_id) === userId,
    version: Number(r.version),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

function rowToSnapshot(r: Record<string, unknown>) {
  return {
    id: r.id,
    view_id: r.view_id,
    view_name: r.view_name,
    version: Number(r.version),
    filters: r.filters ? JSON.parse(String(r.filters)) : {},
    sort_by: r.sort_by,
    sort_order: r.sort_order,
    page_size: r.page_size,
    visible_columns: r.visible_columns ? JSON.parse(String(r.visible_columns)) : null,
    is_default: r.is_default === 1,
    operator_id: r.operator_id,
    operator_name: r.operator_name,
    remark: r.remark ?? '',
    created_at: r.created_at,
  }
}

function createSnapshot(
  viewId: number,
  view: Record<string, unknown>,
  operatorId: number,
  operatorName: string,
  remark: string = ''
): number {
  const result = db
    .prepare(
      `INSERT INTO view_snapshots
       (view_id, view_name, version, filters, sort_by, sort_order, page_size, visible_columns, is_default, operator_id, operator_name, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      viewId,
      view.name,
      view.version,
      view.filters,
      view.sort_by,
      view.sort_order,
      view.page_size,
      view.visible_columns,
      view.is_default,
      operatorId,
      operatorName,
      remark
    )
  return Number(result.lastInsertRowid)
}

router.get('/', authMiddleware, (req: Request, res: Response): void => {
  const userId = req.user!.id
  const { page = 'equipments', include_all = 'false' } = req.query

  const includeAll = include_all === 'true'

  let sql = 'SELECT * FROM saved_views WHERE page = ?'
  const params: unknown[] = [page]

  if (!includeAll) {
    sql += ' AND user_id = ?'
    params.push(userId)
  }

  sql += ' ORDER BY is_default DESC, created_at DESC'

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]

  const views = rows.map((r) => rowToView(r, userId))

  res.json({ success: true, data: views })
})

router.get('/logs', authMiddleware, (req: Request, res: Response): void => {
  const userId = req.user!.id
  const { limit = 50 } = req.query

  const rows = db
    .prepare('SELECT * FROM view_operation_logs WHERE operator_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, Number(limit))

  res.json({ success: true, data: rows })
})

router.get('/:id', authMiddleware, (req: Request, res: Response): void => {
  const userId = req.user!.id
  const { id } = req.params

  const existing = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined

  if (!existing) {
    res.status(404).json({ success: false, error: '方案不存在' })
    return
  }

  res.json({ success: true, data: rowToView(existing, userId) })
})

router.get('/:id/snapshots', authMiddleware, (req: Request, res: Response): void => {
  const userId = req.user!.id
  const { id } = req.params

  const view = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined

  if (!view) {
    res.status(404).json({ success: false, error: '方案不存在' })
    return
  }

  const isOwner = Number(view.user_id) === userId
  const isAdmin = req.user!.role === 'admin'
  const canViewSnapshots = isOwner || isAdmin

  if (!canViewSnapshots) {
    res.status(403).json({ success: false, error: '仅方案所有者或管理员可查看快照' })
    return
  }

  const rows = db
    .prepare('SELECT * FROM view_snapshots WHERE view_id = ? ORDER BY version DESC, id DESC')
    .all(id) as Record<string, unknown>[]

  const snapshots = rows.map(rowToSnapshot)
  res.json({ success: true, data: snapshots })
})

router.post('/', authMiddleware, (req: Request, res: Response): void => {
  const userId = req.user!.id
  const username = req.user!.username
  const {
    page = 'equipments',
    name,
    filters = {},
    sort_by = null,
    sort_order = null,
    page_size = 20,
    visible_columns = null,
    is_default = false,
  } = req.body

  if (!name || !name.trim()) {
    res.status(400).json({ success: false, error: '方案名称不能为空' })
    return
  }

  const existing = db
    .prepare('SELECT id FROM saved_views WHERE user_id = ? AND page = ? AND name = ?')
    .get(userId, page, name.trim())

  if (existing) {
    res.status(409).json({ success: false, error: `已存在同名方案「${name.trim()}」，请换一个名称` })
    return
  }

  if (is_default) {
    db.prepare('UPDATE saved_views SET is_default = 0 WHERE user_id = ? AND page = ?').run(userId, page)
  }

  const result = db
    .prepare(
      `INSERT INTO saved_views (user_id, page, name, filters, sort_by, sort_order, page_size, visible_columns, is_default, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(
      userId,
      page,
      name.trim(),
      JSON.stringify(filters),
      sort_by,
      sort_order,
      page_size,
      visible_columns ? JSON.stringify(visible_columns) : null,
      is_default ? 1 : 0
    )

  const viewId = Number(result.lastInsertRowid)
  logViewOperation(viewId, name.trim(), 'create', userId, username, `创建方案：${name.trim()}`)

  const view = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(viewId) as Record<string, unknown>
  res.status(201).json({
    success: true,
    data: rowToView(view, userId),
  })
})

router.put('/:id', authMiddleware, (req: Request, res: Response): void => {
  const userId = req.user!.id
  const username = req.user!.username
  const { id } = req.params
  const {
    name,
    filters,
    sort_by,
    sort_order,
    page_size,
    visible_columns,
    is_default,
    expected_version,
    snapshot_remark = '',
  } = req.body

  const existing = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined

  if (!existing) {
    res.status(404).json({ success: false, error: '方案不存在' })
    return
  }

  if (existing.user_id !== userId) {
    res.status(403).json({ success: false, error: '只能修改自己创建的方案' })
    return
  }

  const currentVersion = Number(existing.version)
  if (expected_version !== undefined && Number(expected_version) !== currentVersion) {
    logViewOperation(
      Number(id),
      String(existing.name),
      'conflict',
      userId,
      username,
      `冲突检测失败：提交版本 ${expected_version}，当前版本 ${currentVersion}`
    )
    res.status(409).json({
      success: false,
      error: `方案「${existing.name}」已被他人修改（当前版本 ${currentVersion}，你提交的是版本 ${expected_version}），请刷新后重试`,
      conflict: {
        current_version: currentVersion,
        submitted_version: Number(expected_version),
        latest_version: currentVersion,
        latest_updated_at: existing.updated_at,
        latest_operator: {
          operator_id: Number(existing.user_id),
          operator_name: existing.user_id === userId ? username : '其他用户',
        },
      },
    })
    return
  }

  const snapshotId = createSnapshot(
    Number(id),
    existing,
    userId,
    username,
    snapshot_remark || `更新前自动备份（版本 ${currentVersion}）`
  )
  logViewOperation(
    Number(id),
    String(existing.name),
    'snapshot',
    userId,
    username,
    `创建快照 #${snapshotId}：${snapshot_remark || '更新前自动备份'}`
  )

  if (name && name.trim() && name.trim() !== existing.name) {
    const duplicate = db
      .prepare('SELECT id FROM saved_views WHERE user_id = ? AND page = ? AND name = ? AND id != ?')
      .get(userId, existing.page, name.trim(), id)
    if (duplicate) {
      res.status(409).json({ success: false, error: `已存在同名方案「${name.trim()}」，请换一个名称` })
      return
    }
  }

  if (is_default) {
    db.prepare('UPDATE saved_views SET is_default = 0 WHERE user_id = ? AND page = ?').run(userId, existing.page)
  }

  const newName = name && name.trim() ? name.trim() : String(existing.name)

  db.prepare(
    `UPDATE saved_views SET
      name = COALESCE(?, name),
      filters = COALESCE(?, filters),
      sort_by = ?,
      sort_order = ?,
      page_size = COALESCE(?, page_size),
      visible_columns = ?,
      is_default = COALESCE(?, is_default),
      version = version + 1,
      updated_at = datetime('now', 'localtime')
    WHERE id = ?`
  ).run(
    name && name.trim() ? name.trim() : null,
    filters ? JSON.stringify(filters) : null,
    sort_by ?? null,
    sort_order ?? null,
    page_size ?? null,
    visible_columns !== undefined ? (visible_columns ? JSON.stringify(visible_columns) : null) : undefined,
    is_default !== undefined ? (is_default ? 1 : 0) : null,
    id
  )

  logViewOperation(
    Number(id),
    newName,
    'update',
    userId,
    username,
    `更新方案：${newName}（从版本 ${currentVersion} 升级到 ${currentVersion + 1}）`
  )

  const view = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id) as Record<string, unknown>
  res.json({
    success: true,
    data: rowToView(view, userId),
    snapshot_created: snapshotId,
  })
})

router.post('/:id/snapshot', authMiddleware, (req: Request, res: Response): void => {
  const userId = req.user!.id
  const username = req.user!.username
  const { id } = req.params
  const { remark = '' } = req.body

  const existing = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined

  if (!existing) {
    res.status(404).json({ success: false, error: '方案不存在' })
    return
  }

  if (existing.user_id !== userId) {
    res.status(403).json({ success: false, error: '只能为自己创建的方案创建快照' })
    return
  }

  const snapshotId = createSnapshot(
    Number(id),
    existing,
    userId,
    username,
    remark || `手动快照（版本 ${existing.version}）`
  )

  logViewOperation(
    Number(id),
    String(existing.name),
    'snapshot',
    userId,
    username,
    `手动创建快照 #${snapshotId}：${remark || '手动快照'}`
  )

  const snapshot = db.prepare('SELECT * FROM view_snapshots WHERE id = ?').get(snapshotId) as Record<string, unknown>
  res.status(201).json({
    success: true,
    data: rowToSnapshot(snapshot),
  })
})

router.post('/:id/rollback/:snapshotId', authMiddleware, (req: Request, res: Response): void => {
  const userId = req.user!.id
  const username = req.user!.username
  const { id, snapshotId } = req.params

  const existing = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined

  if (!existing) {
    res.status(404).json({ success: false, error: '方案不存在' })
    return
  }

  if (existing.user_id !== userId) {
    res.status(403).json({ success: false, error: '只能回滚自己创建的方案' })
    return
  }

  const snapshot = db.prepare('SELECT * FROM view_snapshots WHERE id = ? AND view_id = ?').get(
    snapshotId,
    id
  ) as Record<string, unknown> | undefined

  if (!snapshot) {
    res.status(404).json({ success: false, error: '快照不存在或不属于该方案' })
    return
  }

  const oldVersion = Number(existing.version)
  const targetVersion = Number(snapshot.version)

  createSnapshot(
    Number(id),
    existing,
    userId,
    username,
    `回滚前自动备份（版本 ${oldVersion} → ${targetVersion}）`
  )

  db.prepare(
    `UPDATE saved_views SET
      name = ?,
      filters = ?,
      sort_by = ?,
      sort_order = ?,
      page_size = ?,
      visible_columns = ?,
      is_default = ?,
      version = version + 1,
      updated_at = datetime('now', 'localtime')
    WHERE id = ?`
  ).run(
    snapshot.view_name,
    snapshot.filters,
    snapshot.sort_by,
    snapshot.sort_order,
    snapshot.page_size,
    snapshot.visible_columns,
    snapshot.is_default,
    id
  )

  logViewOperation(
    Number(id),
    String(snapshot.view_name),
    'rollback',
    userId,
    username,
    `回滚到快照 #${snapshotId}（版本 ${targetVersion}，当前升级到版本 ${oldVersion + 1}）`
  )

  const view = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id) as Record<string, unknown>
  res.json({
    success: true,
    data: rowToView(view, userId),
    rollback_from_snapshot: Number(snapshotId),
  })
})

router.delete('/:id', authMiddleware, (req: Request, res: Response): void => {
  const userId = req.user!.id
  const username = req.user!.username
  const { id } = req.params

  const existing = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined

  if (!existing) {
    res.status(404).json({ success: false, error: '方案不存在' })
    return
  }

  if (existing.user_id !== userId) {
    res.status(403).json({ success: false, error: '只能删除自己创建的方案' })
    return
  }

  const viewName = String(existing.name)
  db.prepare('DELETE FROM view_snapshots WHERE view_id = ?').run(id)
  db.prepare('UPDATE view_operation_logs SET view_id = NULL WHERE view_id = ?').run(id)
  db.prepare('DELETE FROM saved_views WHERE id = ?').run(id)
  logViewOperation(null, viewName, 'delete', userId, username, `删除方案：${viewName}`)

  res.json({ success: true, data: null })
})

router.post('/:id/apply', authMiddleware, (req: Request, res: Response): void => {
  const userId = req.user!.id
  const username = req.user!.username
  const { id } = req.params

  const existing = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined

  if (!existing) {
    res.status(404).json({ success: false, error: '方案不存在' })
    return
  }

  logViewOperation(Number(id), String(existing.name), 'apply', userId, username, `应用方案：${existing.name}`)

  res.json({
    success: true,
    data: rowToView(existing, userId),
  })
})

export default router
