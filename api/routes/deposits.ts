import { Router, type Request, type Response } from 'express'
import db from '../db.js'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()

router.get('/', authMiddleware, (req: Request, res: Response): void => {
  const { borrower_name, equipment_name, type } = req.query

  let sql = 'SELECT * FROM deposit_transactions WHERE 1=1'
  const params: unknown[] = []

  if (borrower_name) {
    sql += ' AND borrower_name LIKE ?'
    params.push(`%${borrower_name}%`)
  }
  if (equipment_name) {
    sql += ' AND equipment_name LIKE ?'
    params.push(`%${equipment_name}%`)
  }
  if (type) {
    sql += ' AND type = ?'
    params.push(type)
  }

  sql += ' ORDER BY created_at DESC'

  const rows = db.prepare(sql).all(...params)
  res.json({ success: true, data: rows })
})

export default router
