import { Router, type Request, type Response } from 'express'
import db from '../db.js'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()

function logViewOperation(
  viewId: number | null,
  viewName: string,
  action: 'create' | 'update' | 'delete' | 'apply',
  operatorId: number,
  operatorName: string,
  detail: string = ''
): void {
  db.prepare(
    'INSERT INTO view_operation_logs (view_id, view_name, action, operator_id, operator_name, detail) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(viewId, viewName, action, operatorId, operatorName, detail)
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

  const views = rows.map((r) => ({
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
    created_at: r.created_at,
    updated_at: r.updated_at,
  }))

  res.json({ success: true, data: views })
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
      `INSERT INTO saved_views (user_id, page, name, filters, sort_by, sort_order, page_size, visible_columns, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    data: {
      id: view.id,
      user_id: view.user_id,
      page: view.page,
      name: view.name,
      filters: view.filters ? JSON.parse(String(view.filters)) : {},
      sort_by: view.sort_by,
      sort_order: view.sort_order,
      page_size: view.page_size,
      visible_columns: view.visible_columns ? JSON.parse(String(view.visible_columns)) : null,
      is_default: view.is_default === 1,
      created_at: view.created_at,
      updated_at: view.updated_at,
    },
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

  logViewOperation(Number(id), newName, 'update', userId, username, `更新方案：${newName}`)

  const view = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id) as Record<string, unknown>
  res.json({
    success: true,
    data: {
      id: view.id,
      user_id: view.user_id,
      page: view.page,
      name: view.name,
      filters: view.filters ? JSON.parse(String(view.filters)) : {},
      sort_by: view.sort_by,
      sort_order: view.sort_order,
      page_size: view.page_size,
      visible_columns: view.visible_columns ? JSON.parse(String(view.visible_columns)) : null,
      is_default: view.is_default === 1,
      created_at: view.created_at,
      updated_at: view.updated_at,
    },
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
    data: {
      id: existing.id,
      user_id: existing.user_id,
      page: existing.page,
      name: existing.name,
      filters: existing.filters ? JSON.parse(String(existing.filters)) : {},
      sort_by: existing.sort_by,
      sort_order: existing.sort_order,
      page_size: existing.page_size,
      visible_columns: existing.visible_columns ? JSON.parse(String(existing.visible_columns)) : null,
      is_default: existing.is_default === 1,
      created_at: existing.created_at,
      updated_at: existing.updated_at,
    },
  })
})

router.get('/logs', authMiddleware, (req: Request, res: Response): void => {
  const userId = req.user!.id
  const { limit = 50 } = req.query

  const rows = db
    .prepare('SELECT * FROM view_operation_logs WHERE operator_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, Number(limit))

  res.json({ success: true, data: rows })
})

export default router
