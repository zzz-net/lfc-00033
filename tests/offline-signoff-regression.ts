const BASE = 'http://localhost:3001/api'

let passed = 0
let failed = 0
const failures: string[] = []

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++
    console.log(`  ✅ ${label}`)
  } else {
    failed++
    failures.push(label)
    console.log(`  ❌ ${label}`)
  }
}

async function request(method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  return { status: res.status, data: json }
}

async function login(username: string, password: string) {
  const { status, data } = await request('POST', '/auth/login', { username, password })
  if (status !== 200) throw new Error(`Login failed for ${username}: ${JSON.stringify(data)}`)
  return data.data.token as string
}

async function getAdminToken() {
  return login('admin', 'admin123')
}

async function getFrontDeskToken() {
  return login('front_desk', 'front123')
}

async function createTestEquipment(token: string, name: string, status = 'available') {
  const { status: resStatus, data } = await request('POST', '/equipments', {
    name,
    type: '测试设备',
    deposit_amount: 100,
    status,
  }, token)
  if (resStatus !== 201) throw new Error(`Create equipment failed: ${JSON.stringify(data)}`)
  return data.data.id as number
}

async function borrowEquipment(token: string, equipmentId: number, name: string, phone: string) {
  const { status, data } = await request('POST', '/borrows', {
    equipment_id: equipmentId,
    borrower_name: name,
    borrower_phone: phone,
  }, token)
  if (status !== 201) throw new Error(`Borrow failed: ${JSON.stringify(data)}`)
  return data.data.id as number
}

async function getEquipmentStatus(token: string, equipmentId: number) {
  const { data } = await request('GET', `/equipments/${equipmentId}/detail`, undefined, token)
  return data.data.equipment.status as string
}

async function getEquipmentDetail(token: string, equipmentId: number) {
  const { data } = await request('GET', `/equipments/${equipmentId}/detail`, undefined, token)
  return data.data
}

async function getBorrowedBorrowId(token: string, equipmentId: number) {
  const { data } = await request('GET', '/borrows?status=borrowed', undefined, token)
  const record = data.data.find((r: any) => r.equipment_id === equipmentId)
  return record?.id as number | undefined
}

async function createOfflineSignoff(
  token: string,
  type: 'borrow' | 'return' | 'damage',
  equipmentId: number,
  borrowerName: string,
  borrowerPhone: string,
  extra?: Partial<{ damage_description: string; signer_name: string; notes: string }>
) {
  const { status, data } = await request('POST', '/offline-signoffs', {
    type,
    equipment_id: equipmentId,
    borrower_name: borrowerName,
    borrower_phone: borrowerPhone,
    ...extra,
  }, token)
  return { status, data }
}

async function getOfflineSignoffList(token: string, status?: string) {
  const path = status ? `/offline-signoffs?status=${status}` : '/offline-signoffs'
  const { data } = await request('GET', path, undefined, token)
  return data
}

async function getOfflineSignoffStats(token: string) {
  const { data } = await request('GET', '/offline-signoffs/stats', undefined, token)
  return data.data
}

async function syncOfflineSignoff(token: string, id: number) {
  const { status, data } = await request('POST', `/offline-signoffs/${id}/sync`, undefined, token)
  return { status, data }
}

async function batchSyncOfflineSignoffs(token: string) {
  const { status, data } = await request('POST', '/offline-signoffs/batch-sync', undefined, token)
  return { status, data }
}

async function resolveOfflineSignoff(
  token: string,
  id: number,
  action: 'retry' | 'force' | 'discard',
  forceSync = false
) {
  const { status, data } = await request('POST', `/offline-signoffs/${id}/resolve`, {
    action,
    force: forceSync,
  }, token)
  return { status, data }
}

async function deleteOfflineSignoff(token: string, id: number) {
  const { status, data } = await request('DELETE', `/offline-signoffs/${id}`, undefined, token)
  return { status, data }
}

async function exportOfflineSignoffs(token: string) {
  const res = await fetch(`${BASE}/offline-signoffs/export/json`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const text = await res.text()
  return { status: res.status, data: text }
}

async function importOfflineSignoffs(token: string, records: any[]) {
  const { status, data } = await request('POST', '/offline-signoffs/import/json', { records }, token)
  return { status, data }
}

async function clearTestOfflineSignoffs(token: string) {
  try {
    const { data } = await request('GET', '/offline-signoffs', undefined, token)
    const records = data.data || []
    for (const r of records) {
      if (r.equipment_snapshot?.name?.includes('离线补录') || r.equipment_snapshot?.name?.includes('冲突')) {
        await request('DELETE', `/offline-signoffs/${r.id}`, undefined, token)
      }
    }
  } catch {
    // ignore
  }
}

async function testCreateOfflineBorrowRecord() {
  console.log('\n📋 测试组 1：离线补录借出登记')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '离线补录借出测试设备')

  try {
    console.log('  → 创建离线借出补录记录')
    const res = await createOfflineSignoff(
      admin,
      'borrow',
      equipId,
      '离线借用人',
      '13900000001',
      { signer_name: '前台小王', notes: '测试离线借出' }
    )
    assert(res.status === 201, '创建离线借出记录成功')
    assert(res.data.data.status === 'pending', '初始状态为 pending')
    assert(res.data.data.type === 'borrow', '类型为 borrow')
    assert(!!res.data.data.equipment_snapshot, '包含设备快照')
    assert(res.data.data.equipment_snapshot.status === 'available', '快照中设备状态为 available')

    const stats = await getOfflineSignoffStats(admin)
    assert(stats.pending >= 1, '统计中待同步数量增加')

    console.log('  → 设备主状态未变（离线补录不影响主数据）')
    const equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'available', '设备主状态仍为 available')

    console.log('  → 记录包含操作人信息')
    assert(!!res.data.data.operator_id, '有操作人ID')
    assert(!!res.data.data.operator_name, '有操作人姓名')
  } finally {
    await clearTestOfflineSignoffs(admin)
    const { data: equipData } = await request('DELETE', `/equipments/${equipId}`, undefined, admin)
  }
}

async function testCreateOfflineReturnRecord() {
  console.log('\n📋 测试组 2：离线补录归还登记')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '离线补录归还测试设备')

  try {
    await borrowEquipment(admin, equipId, '原借用人', '13900000010')

    console.log('  → 创建离线归还补录记录')
    const res = await createOfflineSignoff(
      admin,
      'return',
      equipId,
      '原借用人',
      '13900000010',
      { signer_name: '前台小李', notes: '测试离线归还' }
    )
    assert(res.status === 201, '创建离线归还记录成功')
    assert(res.data.data.status === 'pending', '初始状态为 pending')
    assert(res.data.data.type === 'return', '类型为 return')
    assert(res.data.data.equipment_snapshot.status === 'borrowed', '快照中设备状态为 borrowed')

    console.log('  → 设备主状态未变')
    const equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'borrowed', '设备主状态仍为 borrowed')
  } finally {
    await clearTestOfflineSignoffs(admin)
    const borrowId = await getBorrowedBorrowId(admin, equipId)
    if (borrowId) {
      await request('PUT', `/borrows/${borrowId}/return`, {}, admin)
    }
    await request('DELETE', `/equipments/${equipId}`, undefined, admin)
  }
}

async function testCreateOfflineDamageRecord() {
  console.log('\n📋 测试组 3：离线补录损坏登记')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '离线补录损坏测试设备')

  try {
    await borrowEquipment(admin, equipId, '损坏借用人', '13900000020')

    console.log('  → 创建离线损坏补录记录')
    const res = await createOfflineSignoff(
      admin,
      'damage',
      equipId,
      '损坏借用人',
      '13900000020',
      { damage_description: '屏幕有划痕，外壳有磕碰', signer_name: '前台小张' }
    )
    assert(res.status === 201, '创建离线损坏记录成功')
    assert(res.data.data.type === 'damage', '类型为 damage')
    assert(res.data.data.damage_description === '屏幕有划痕，外壳有磕碰', '损坏描述正确')

    console.log('  → 损坏记录创建时不改变主状态')
    const equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'borrowed', '设备主状态仍为 borrowed')
  } finally {
    await clearTestOfflineSignoffs(admin)
    const borrowId = await getBorrowedBorrowId(admin, equipId)
    if (borrowId) {
      await request('PUT', `/borrows/${borrowId}/return`, {}, admin)
    }
    await request('DELETE', `/equipments/${equipId}`, undefined, admin)
  }
}

async function testSyncBorrowRecord() {
  console.log('\n📋 测试组 4：同步借出补录记录')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '离线补录同步借出测试')

  try {
    const createRes = await createOfflineSignoff(
      admin,
      'borrow',
      equipId,
      '同步借出测试人',
      '13900000030',
      { signer_name: '前台小赵' }
    )
    const recordId = createRes.data.data.id

    console.log('  → 同步借出补录记录')
    const syncRes = await syncOfflineSignoff(admin, recordId)
    assert(syncRes.status === 200, '同步成功')
    assert(syncRes.data.data.status === 'completed', '同步后状态为 completed')
    assert(!!syncRes.data.data.server_record_id, '有服务端记录ID')
    assert(!!syncRes.data.data.synced_at, '有同步时间')

    console.log('  → 同步后设备主状态更新')
    const equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'borrowed', '设备变为 borrowed')

    console.log('  → 统计数据正确')
    const stats = await getOfflineSignoffStats(admin)
    assert(stats.completed >= 1, '已完成数量增加')

    console.log('  → 操作日志包含离线补录同步记录')
    const detail = await getEquipmentDetail(admin, equipId)
    const logs = detail.operation_logs
    const hasOfflineSyncLog = logs.some(
      (l: any) => l.action === 'offline_signoff_sync'
    )
    assert(hasOfflineSyncLog, '操作日志包含 offline_signoff_sync')
    const hasBorrowLog = logs.some((l: any) => l.action === 'borrow')
    assert(hasBorrowLog, '操作日志包含 borrow 记录')
  } finally {
    await clearTestOfflineSignoffs(admin)
    const borrowId = await getBorrowedBorrowId(admin, equipId)
    if (borrowId) {
      await request('PUT', `/borrows/${borrowId}/return`, {}, admin)
    }
    await request('DELETE', `/equipments/${equipId}`, undefined, admin)
  }
}

async function testSyncReturnRecord() {
  console.log('\n📋 测试组 5：同步归还补录记录')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '离线补录同步归还测试')

  try {
    await borrowEquipment(admin, equipId, '原借用人', '13900000040')

    const createRes = await createOfflineSignoff(
      admin,
      'return',
      equipId,
      '原借用人',
      '13900000040',
      { signer_name: '前台小钱' }
    )
    const recordId = createRes.data.data.id

    console.log('  → 同步归还补录记录')
    const syncRes = await syncOfflineSignoff(admin, recordId)
    assert(syncRes.status === 200, '同步成功')
    assert(syncRes.data.data.status === 'completed', '同步后状态为 completed')

    console.log('  → 同步后设备主状态更新')
    const equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'available', '设备变为 available')

    console.log('  → 操作日志包含离线归还同步记录')
    const detail = await getEquipmentDetail(admin, equipId)
    const logs = detail.operation_logs
    const hasOfflineSyncLog = logs.some(
      (l: any) => l.action === 'offline_signoff_sync'
    )
    assert(hasOfflineSyncLog, '操作日志包含 offline_signoff_sync')
    const hasReturnLog = logs.some((l: any) => l.action === 'return')
    assert(hasReturnLog, '操作日志包含 return 记录')
  } finally {
    await clearTestOfflineSignoffs(admin)
    const borrowId = await getBorrowedBorrowId(admin, equipId)
    if (borrowId) {
      await request('PUT', `/borrows/${borrowId}/return`, {}, admin)
    }
    await request('DELETE', `/equipments/${equipId}`, undefined, admin)
  }
}

async function testConflictDetection() {
  console.log('\n📋 测试组 6：冲突检测 - 设备状态变更')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '冲突检测设备-状态变更')

  try {
    console.log('  → 先创建离线借出补录（设备状态为 available）')
    const createRes = await createOfflineSignoff(
      admin,
      'borrow',
      equipId,
      '冲突借用人A',
      '13900000050'
    )
    const recordId = createRes.data.data.id

    console.log('  → 在补录同步前，先在线借出设备，改变状态')
    await borrowEquipment(admin, equipId, '在线借用人B', '13900000051')

    console.log('  → 尝试同步补录，应检测到冲突')
    const syncRes = await syncOfflineSignoff(admin, recordId)
    assert(syncRes.status === 409, '同步返回 409 冲突')
    assert(syncRes.data.conflict?.type === 'equipment_status_changed', '冲突类型为 equipment_status_changed')
    assert(!!syncRes.data.conflict.snapshot_status, '有快照状态')
    assert(!!syncRes.data.conflict.current_status, '有当前状态')

    console.log('  → 记录状态变为 failed，包含冲突信息')
    const listRes = await getOfflineSignoffList(admin, 'failed')
    const failedRecord = (listRes.data || []).find((r: any) => r.id === recordId)
    assert(!!failedRecord, '失败列表中有该记录')
    assert(failedRecord.status === 'failed', '状态为 failed')
    assert(!!failedRecord.conflict_info, '有冲突信息')
    assert(failedRecord.conflict_info.type === 'equipment_status_changed', '冲突类型正确')
    assert(!!failedRecord.error_message, '有错误信息')

    console.log('  → 统计数据正确')
    const stats = await getOfflineSignoffStats(admin)
    assert(stats.failed >= 1, '失败数量增加')
  } finally {
    await clearTestOfflineSignoffs(admin)
    const borrowId = await getBorrowedBorrowId(admin, equipId)
    if (borrowId) {
      await request('PUT', `/borrows/${borrowId}/return`, {}, admin)
    }
    await request('DELETE', `/equipments/${equipId}`, undefined, admin)
  }
}

async function testConflictResolutionRetry() {
  console.log('\n📋 测试组 7：冲突解决 - 重试同步')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '冲突重试设备')

  try {
    const createRes = await createOfflineSignoff(
      admin,
      'borrow',
      equipId,
      '重试借用人',
      '13900000060'
    )
    const recordId = createRes.data.data.id

    await borrowEquipment(admin, equipId, '干扰借用人', '13900000061')
    await syncOfflineSignoff(admin, recordId)

    const borrowId = await getBorrowedBorrowId(admin, equipId)
    if (borrowId) {
      await request('PUT', `/borrows/${borrowId}/return`, {}, admin)
    }

    console.log('  → 归还设备后，重试同步冲突记录')
    const resolveRes = await resolveOfflineSignoff(admin, recordId, 'retry')
    assert(resolveRes.status === 200, '重试解决成功')
    assert(resolveRes.data.data.status === 'pending', '记录重置为 pending')

    console.log('  → 再次同步应成功')
    const syncRes = await syncOfflineSignoff(admin, recordId)
    assert(syncRes.status === 200, '重试后同步成功')
    assert(syncRes.data.data.status === 'completed', '同步后为 completed')

    const equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'borrowed', '设备状态变为 borrowed')
  } finally {
    await clearTestOfflineSignoffs(admin)
    const borrowId = await getBorrowedBorrowId(admin, equipId)
    if (borrowId) {
      await request('PUT', `/borrows/${borrowId}/return`, {}, admin)
    }
    await request('DELETE', `/equipments/${equipId}`, undefined, admin)
  }
}

async function testConflictResolutionForce() {
  console.log('\n📋 测试组 8：冲突解决 - 强制同步')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '强制同步设备')

  try {
    const createRes = await createOfflineSignoff(
      admin,
      'borrow',
      equipId,
      '强制借用人',
      '13900000070'
    )
    const recordId = createRes.data.data.id

    console.log('  → 先在线借出设备，改变状态')
    await borrowEquipment(admin, equipId, '在线借出干扰人', '13900000071')

    console.log('  → 现在同步离线借出记录会冲突')
    const syncRes = await syncOfflineSignoff(admin, recordId)
    assert(syncRes.status === 409, '同步返回 409 冲突')
    assert(syncRes.data.conflict?.type === 'equipment_status_changed', '冲突类型为 equipment_status_changed')

    console.log('  → 管理员强制同步')
    const resolveRes = await resolveOfflineSignoff(admin, recordId, 'force', true)
    assert(resolveRes.status === 200, '强制同步成功')
    assert(resolveRes.data.data.status === 'completed', '状态变为 completed')
    assert(!!resolveRes.data.data.server_record_id, '有服务端记录ID')

    console.log('  → 操作日志包含强制同步记录')
    const detail = await getEquipmentDetail(admin, equipId)
    const logs = detail.operation_logs
    const hasForceLog = logs.some(
      (l: any) => l.action === 'offline_signoff_force_sync'
    )
    assert(hasForceLog, '操作日志包含 offline_signoff_force_sync')
  } finally {
    await clearTestOfflineSignoffs(admin)
    const borrowId = await getBorrowedBorrowId(admin, equipId)
    if (borrowId) {
      await request('PUT', `/borrows/${borrowId}/return`, {}, admin)
    }
    await request('DELETE', `/equipments/${equipId}`, undefined, admin)
  }
}

async function testConflictResolutionDiscard() {
  console.log('\n📋 测试组 9：冲突解决 - 放弃记录')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '放弃记录设备')

  try {
    const createRes = await createOfflineSignoff(
      admin,
      'borrow',
      equipId,
      '放弃借用人',
      '13900000080'
    )
    const recordId = createRes.data.data.id

    await borrowEquipment(admin, equipId, '干扰人', '13900000081')
    await syncOfflineSignoff(admin, recordId)

    console.log('  → 放弃冲突记录')
    const resolveRes = await resolveOfflineSignoff(admin, recordId, 'discard')
    assert(resolveRes.status === 200, '放弃操作成功')

    console.log('  → 记录被删除')
    const listRes = await getOfflineSignoffList(admin)
    const exists = (listRes.data || []).some((r: any) => r.id === recordId)
    assert(!exists, '记录已不存在')

    console.log('  → 设备状态未受影响')
    const equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'borrowed', '设备仍为 borrowed')
  } finally {
    await clearTestOfflineSignoffs(admin)
    const borrowId = await getBorrowedBorrowId(admin, equipId)
    if (borrowId) {
      await request('PUT', `/borrows/${borrowId}/return`, {}, admin)
    }
    await request('DELETE', `/equipments/${equipId}`, undefined, admin)
  }
}

async function testExportImportJson() {
  console.log('\n📋 测试组 10：导出导入 JSON')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '导出导入测试设备')

  try {
    console.log('  → 创建几条测试补录记录')
    await createOfflineSignoff(admin, 'borrow', equipId, '导出人1', '13900000100')
    await createOfflineSignoff(admin, 'borrow', equipId, '导出人2', '13900000101')

    console.log('  → 导出 JSON')
    const exportRes = await exportOfflineSignoffs(admin)
    assert(exportRes.status === 200, '导出成功')
    assert(exportRes.data.includes('records'), '导出数据包含 records 字段')

    const exportData = JSON.parse(exportRes.data)
    assert(Array.isArray(exportData.records), 'records 是数组')
    assert(exportData.records.length >= 2, '至少有2条记录')

    console.log('  → 先清空现有记录')
    const listBefore = await getOfflineSignoffList(admin)
    for (const r of listBefore.data || []) {
      if (r.equipment_snapshot?.name?.includes('导出导入')) {
        await deleteOfflineSignoff(admin, r.id)
      }
    }

    console.log('  → 导入 JSON 记录')
    const importRes = await importOfflineSignoffs(admin, exportData.records)
    assert(importRes.status === 200, '导入成功')
    assert(importRes.data.data.imported >= 2, '至少导入2条')

    console.log('  → 导入后记录存在且状态为 pending')
    const listAfter = await getOfflineSignoffList(admin, 'pending')
    const importedRecords = (listAfter.data || []).filter(
      (r: any) => r.equipment_snapshot?.name?.includes('导出导入')
    )
    assert(importedRecords.length >= 2, '导入的记录存在')
    assert(
      importedRecords.every((r: any) => r.status === 'pending'),
      '导入记录状态为 pending'
    )

    console.log('  → 导入记录保留原始信息')
    const record1 = importedRecords.find(
      (r: any) => r.borrower_name === '导出人1'
    )
    assert(!!record1, '找到导出人1的记录')
    assert(record1.equipment_id === equipId, '设备ID一致')
    assert(record1.equipment_snapshot?.status === 'available', '设备快照状态一致')
  } finally {
    await clearTestOfflineSignoffs(admin)
    await request('DELETE', `/equipments/${equipId}`, undefined, admin)
  }
}

async function testPermissionControl() {
  console.log('\n📋 测试组 11：权限控制')
  const admin = await getAdminToken()
  const frontDesk = await getFrontDeskToken()
  const equipId = await createTestEquipment(admin, '权限测试设备')

  try {
    console.log('  → 前台可以创建离线补录')
    const frontCreateRes = await createOfflineSignoff(
      frontDesk,
      'borrow',
      equipId,
      '前台创建人',
      '13900000110'
    )
    assert(frontCreateRes.status === 201, '前台可创建离线补录')
    const frontRecordId = frontCreateRes.data.data.id

    console.log('  → 前台只能看到自己的记录')
    const adminListRes = await getOfflineSignoffList(admin)
    const frontListRes = await getOfflineSignoffList(frontDesk)
    const adminCount = adminListRes.data?.length || 0
    const frontCount = frontListRes.data?.length || 0
    assert(frontCount >= 1, '前台能看到自己的记录')
    assert(adminCount >= frontCount, '管理员看到的不少于前台')

    console.log('  → 前台可以同步自己的记录')
    const frontSyncRes = await syncOfflineSignoff(frontDesk, frontRecordId)
    assert(frontSyncRes.status === 200, '前台可同步自己的记录')

    await createOfflineSignoff(admin, 'borrow', equipId, '管理员创建人', '13900000111')
    const adminRecordId = (await getOfflineSignoffList(admin, 'pending')).data?.[0]?.id

    console.log('  → 前台不能删除记录')
    if (adminRecordId) {
      const delRes = await deleteOfflineSignoff(frontDesk, adminRecordId)
      assert(delRes.status === 403, '前台删除返回 403')
    }

    console.log('  → 前台不能导入')
    const importRes = await importOfflineSignoffs(frontDesk, [])
    assert(importRes.status === 403, '前台导入返回 403')

    console.log('  → 前台可以导出自己的记录')
    const exportRes = await exportOfflineSignoffs(frontDesk)
    assert(exportRes.status === 200, '前台导出返回 200')
    const exportData = JSON.parse(exportRes.data)
    assert(Array.isArray(exportData.records), '导出包含 records 数组')

    console.log('  → 前台不能解决冲突')
    if (adminRecordId) {
      const resolveRes = await resolveOfflineSignoff(frontDesk, adminRecordId, 'retry')
      assert(resolveRes.status === 403, '前台解决冲突返回 403')
    }

    console.log('  → 管理员可以删除记录')
    if (adminRecordId) {
      const adminDelRes = await deleteOfflineSignoff(admin, adminRecordId)
      assert(adminDelRes.status === 200, '管理员可删除记录')
    }
  } finally {
    await clearTestOfflineSignoffs(admin)
    const borrowId = await getBorrowedBorrowId(admin, equipId)
    if (borrowId) {
      await request('PUT', `/borrows/${borrowId}/return`, {}, admin)
    }
    await request('DELETE', `/equipments/${equipId}`, undefined, admin)
  }
}

async function testBatchSync() {
  console.log('\n📋 测试组 12：批量同步')
  const admin = await getAdminToken()
  const equip1 = await createTestEquipment(admin, '批量同步设备1')
  const equip2 = await createTestEquipment(admin, '批量同步设备2')
  const equip3 = await createTestEquipment(admin, '批量同步设备3')

  try {
    console.log('  → 创建多条待同步记录')
    await createOfflineSignoff(admin, 'borrow', equip1, '批量人1', '13900000120')
    await createOfflineSignoff(admin, 'borrow', equip2, '批量人2', '13900000121')
    await createOfflineSignoff(admin, 'borrow', equip3, '批量人3', '13900000122')

    const statsBefore = await getOfflineSignoffStats(admin)
    assert(statsBefore.pending >= 3, '待同步至少3条')

    console.log('  → 执行批量同步')
    const batchRes = await batchSyncOfflineSignoffs(admin)
    assert(batchRes.status === 200, '批量同步成功')
    assert(!!batchRes.data.data.total, '有总数')
    assert(!!batchRes.data.data.success, '有成功数')
    assert(!!batchRes.data.data.failed !== undefined, '有失败数')

    console.log('  → 同步后统计更新')
    const statsAfter = await getOfflineSignoffStats(admin)
    assert(statsAfter.completed >= 3, '已完成至少3条')
    assert(statsAfter.pending <= statsBefore.pending - 3, '待同步减少')

    console.log('  → 同步后设备状态都已更新')
    const status1 = await getEquipmentStatus(admin, equip1)
    const status2 = await getEquipmentStatus(admin, equip2)
    const status3 = await getEquipmentStatus(admin, equip3)
    assert(status1 === 'borrowed', '设备1已借出')
    assert(status2 === 'borrowed', '设备2已借出')
    assert(status3 === 'borrowed', '设备3已借出')
  } finally {
    await clearTestOfflineSignoffs(admin)
    for (const eq of [equip1, equip2, equip3]) {
      const borrowId = await getBorrowedBorrowId(admin, eq)
      if (borrowId) {
        await request('PUT', `/borrows/${borrowId}/return`, {}, admin)
      }
      await request('DELETE', `/equipments/${eq}`, undefined, admin)
    }
  }
}

async function testCrossRestartPersistence() {
  console.log('\n📋 测试组 13：跨重启持久化（模拟重启查询）')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '持久化测试设备')

  try {
    console.log('  → 创建离线补录记录')
    const createRes = await createOfflineSignoff(
      admin,
      'borrow',
      equipId,
      '持久化借用人',
      '13900000130',
      { notes: '测试持久化' }
    )
    const recordId = createRes.data.data.id
    const createdAt = createRes.data.data.created_at
    const snapshot = createRes.data.data.equipment_snapshot

    console.log('  → 多次查询验证数据一致性（模拟重启后重新查询）')
    for (let i = 0; i < 3; i++) {
      const listRes = await getOfflineSignoffList(admin, 'pending')
      const record = (listRes.data || []).find((r: any) => r.id === recordId)
      assert(!!record, `第${i + 1}次查询记录存在`)
      assert(record.status === 'pending', `第${i + 1}次查询状态为 pending`)
      assert(record.created_at === createdAt, `第${i + 1}次查询创建时间不变`)
      assert(
        record.equipment_snapshot?.status === snapshot?.status,
        `第${i + 1}次查询快照状态不变`
      )
    }

    console.log('  → 单条详情查询一致')
    const { data: detailRes } = await request(
      'GET',
      `/offline-signoffs/${recordId}`,
      undefined,
      admin
    )
    assert(detailRes.data?.id === recordId, '详情查询ID一致')
    assert(detailRes.data?.borrower_name === '持久化借用人', '详情借用人一致')

    console.log('  → 统计数据一致')
    const stats = await getOfflineSignoffStats(admin)
    assert(stats.total >= 1, '统计总数正确')
  } finally {
    await clearTestOfflineSignoffs(admin)
    await request('DELETE', `/equipments/${equipId}`, undefined, admin)
  }
}

async function testEndToEndOfflineBorrowFlow() {
  console.log('\n📋 测试组 14：端到端链路 - 离线借出到完成入库')
  const admin = await getAdminToken()
  const frontDesk = await getFrontDeskToken()
  const equipId = await createTestEquipment(admin, '端到端离线借出设备')

  try {
    console.log('  步骤 1: 前台离线登记借出（模拟断网场景）')
    const createRes = await createOfflineSignoff(
      frontDesk,
      'borrow',
      equipId,
      '端到端借用人',
      '13900000140',
      { signer_name: '前台小陈', notes: '断网时登记的借出' }
    )
    assert(createRes.status === 201, '离线借出登记成功')
    const recordId = createRes.data.data.id

    console.log('  步骤 2: 验证设备主状态未变（离线不影响主数据）')
    let equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'available', '设备仍为 available')

    console.log('  步骤 3: 验证记录在待同步列表')
    const pendingList = await getOfflineSignoffList(frontDesk, 'pending')
    const pendingRecord = (pendingList.data || []).find((r: any) => r.id === recordId)
    assert(!!pendingRecord, '待同步列表中有记录')

    console.log('  步骤 4: 统计数据正确')
    const statsBefore = await getOfflineSignoffStats(frontDesk)
    assert(statsBefore.pending >= 1, '待同步计数正确')
    const initialCompleted = statsBefore.completed

    console.log('  步骤 5: 网络恢复，前台执行同步')
    const syncRes = await syncOfflineSignoff(frontDesk, recordId)
    assert(syncRes.status === 200, '同步成功')
    assert(syncRes.data.data.status === 'completed', '状态变为 completed')
    assert(!!syncRes.data.data.server_record_id, '生成服务端记录ID')
    assert(!!syncRes.data.data.synced_at, '有同步时间')

    console.log('  步骤 6: 同步后设备状态更新为借出')
    equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'borrowed', '设备变为 borrowed')

    console.log('  步骤 7: 统计数据更新')
    const statsAfter = await getOfflineSignoffStats(frontDesk)
    assert(statsAfter.completed >= initialCompleted + 1, '已完成计数增加')
    assert(statsAfter.pending < statsBefore.pending, '待同步计数减少')

    console.log('  步骤 8: 已完成列表中有记录')
    const completedList = await getOfflineSignoffList(frontDesk, 'completed')
    const completedRecord = (completedList.data || []).find((r: any) => r.id === recordId)
    assert(!!completedRecord, '已完成列表中有记录')

    console.log('  步骤 9: 主借还记录存在')
    const { data: borrowsData } = await request('GET', '/borrows?status=borrowed', undefined, admin)
    const borrowRecord = borrowsData.data?.find(
      (r: any) => r.borrower_name === '端到端借用人' && r.equipment_id === equipId
    )
    assert(!!borrowRecord, '主借还记录存在')
    assert(borrowRecord.borrower_phone === '13900000140', '借还记录电话一致')

    console.log('  步骤 10: 操作日志包含关键记录')
    const detail = await getEquipmentDetail(admin, equipId)
    const logs = detail.operation_logs
    const hasOfflineSyncedLog = logs.some(
      (l: any) => l.action === 'offline_signoff_sync'
    )
    assert(hasOfflineSyncedLog, '操作日志包含 offline_signoff_sync')
    const hasBorrowLog = logs.some((l: any) => l.action === 'borrow')
    assert(hasBorrowLog, '操作日志包含借出记录')

    console.log('  步骤 11: 待同步列表中不再有该记录')
    const pendingAfter = await getOfflineSignoffList(frontDesk, 'pending')
    const stillPending = (pendingAfter.data || []).some((r: any) => r.id === recordId)
    assert(!stillPending, '待同步列表中没有该记录了')
  } finally {
    await clearTestOfflineSignoffs(admin)
    const borrowId = await getBorrowedBorrowId(admin, equipId)
    if (borrowId) {
      await request('PUT', `/borrows/${borrowId}/return`, {}, admin)
    }
    await request('DELETE', `/equipments/${equipId}`, undefined, admin)
  }
}

async function testEndToEndOfflineReturnFlow() {
  console.log('\n📋 测试组 15：端到端链路 - 离线归还到完成入库')
  const admin = await getAdminToken()
  const frontDesk = await getFrontDeskToken()
  const equipId = await createTestEquipment(admin, '端到端离线归还设备')

  try {
    console.log('  步骤 1: 先在线借出设备')
    const borrowId = await borrowEquipment(admin, equipId, '原借用人', '13900000150')
    let equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'borrowed', '设备已借出')

    console.log('  步骤 2: 前台离线登记归还（模拟断网）')
    const createRes = await createOfflineSignoff(
      frontDesk,
      'return',
      equipId,
      '原借用人',
      '13900000150',
      { signer_name: '前台小孙', notes: '断网时登记的归还' }
    )
    assert(createRes.status === 201, '离线归还登记成功')
    const recordId = createRes.data.data.id

    console.log('  步骤 3: 设备主状态仍为借出（离线不影响）')
    equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'borrowed', '设备仍为 borrowed')

    console.log('  步骤 4: 网络恢复，执行同步')
    const syncRes = await syncOfflineSignoff(frontDesk, recordId)
    assert(syncRes.status === 200, '同步成功')
    assert(syncRes.data.data.status === 'completed', '状态为 completed')

    console.log('  步骤 5: 同步后设备变为可借')
    equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'available', '设备变为 available')

    console.log('  步骤 6: 主借还记录已归还')
    const { data: borrowsData } = await request('GET', '/borrows?status=returned', undefined, admin)
    const returnRecord = borrowsData.data?.find(
      (r: any) => r.equipment_id === equipId && r.borrower_name === '原借用人'
    )
    assert(!!returnRecord, '有归还记录')

    console.log('  步骤 7: 操作日志完整')
    const detail = await getEquipmentDetail(admin, equipId)
    const logs = detail.operation_logs
    const hasOfflineSyncLog = logs.some(
      (l: any) => l.action === 'offline_signoff_sync'
    )
    assert(hasOfflineSyncLog, '操作日志包含 offline_signoff_sync')
    const hasReturnLog = logs.some((l: any) => l.action === 'return')
    assert(hasReturnLog, '操作日志包含归还记录')
  } finally {
    await clearTestOfflineSignoffs(admin)
    const borrowId = await getBorrowedBorrowId(admin, equipId)
    if (borrowId) {
      await request('PUT', `/borrows/${borrowId}/return`, {}, admin)
    }
    await request('DELETE', `/equipments/${equipId}`, undefined, admin)
  }
}

async function testStatsConsistencyAfterSync() {
  console.log('\n📋 测试组 16：同步后列表与统计一致')
  const admin = await getAdminToken()
  const equip1 = await createTestEquipment(admin, '统计一致设备1')
  const equip2 = await createTestEquipment(admin, '统计一致设备2')
  const equip3 = await createTestEquipment(admin, '统计一致设备3')

  try {
    console.log('  → 创建3条待同步记录')
    await createOfflineSignoff(admin, 'borrow', equip1, '统计人1', '13900000160')
    await createOfflineSignoff(admin, 'borrow', equip2, '统计人2', '13900000161')
    await createOfflineSignoff(admin, 'borrow', equip3, '统计人3', '13900000162')

    console.log('  → 验证待同步列表数量与统计一致')
    const pendingList = await getOfflineSignoffList(admin, 'pending')
    const stats = await getOfflineSignoffStats(admin)
    const pendingInList = (pendingList.data || []).filter(
      (r: any) => r.status === 'pending'
    ).length
    assert(pendingInList === stats.pending, '待同步列表数量与统计一致')

    console.log('  → 同步其中1条')
    const firstPending = pendingList.data?.[0]
    if (firstPending) {
      await syncOfflineSignoff(admin, firstPending.id)
    }

    console.log('  → 再次验证各状态列表数量与统计一致')
    const stats2 = await getOfflineSignoffStats(admin)
    const pendingList2 = await getOfflineSignoffList(admin, 'pending')
    const completedList2 = await getOfflineSignoffList(admin, 'completed')

    assert(
      (pendingList2.data?.length || 0) === stats2.pending,
      '待同步列表数量与统计一致'
    )
    assert(
      (completedList2.data?.length || 0) === stats2.completed,
      '已完成列表数量与统计一致'
    )

    const allList = await getOfflineSignoffList(admin)
    const totalInList = allList.data?.length || 0
    assert(totalInList === stats2.total, '总列表数量与统计一致')
  } finally {
    await clearTestOfflineSignoffs(admin)
    for (const eq of [equip1, equip2, equip3]) {
      const borrowId = await getBorrowedBorrowId(admin, eq)
      if (borrowId) {
        await request('PUT', `/borrows/${borrowId}/return`, {}, admin)
      }
      await request('DELETE', `/equipments/${eq}`, undefined, admin)
    }
  }
}

async function testSyncDamageRecord() {
  console.log('\n📋 测试组 17：同步损坏补录记录')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '离线补录同步损坏测试')

  try {
    await borrowEquipment(admin, equipId, '损坏借用人', '13900000170')

    const createRes = await createOfflineSignoff(
      admin,
      'damage',
      equipId,
      '损坏借用人',
      '13900000170',
      { damage_description: '屏幕碎裂，无法正常显示', signer_name: '前台小周' }
    )
    const recordId = createRes.data.data.id

    console.log('  → 同步损坏补录记录')
    const syncRes = await syncOfflineSignoff(admin, recordId)
    assert(syncRes.status === 200, '同步成功')
    assert(syncRes.data.data.status === 'completed', '同步后状态为 completed')
    assert(!!syncRes.data.data.server_record_id, '有服务端记录ID')

    console.log('  → 同步后设备状态更新为待确认')
    const equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'pending_confirm', '设备变为 pending_confirm')

    console.log('  → 借还记录状态更新为待确认')
    const { data: borrowsData } = await request('GET', '/borrows?status=pending_confirm', undefined, admin)
    const damageRecord = borrowsData.data?.find(
      (r: any) => r.equipment_id === equipId && r.borrower_name === '损坏借用人'
    )
    assert(!!damageRecord, '有待确认的借还记录')
    assert(damageRecord.damage_description === '屏幕碎裂，无法正常显示', '损坏描述正确')

    console.log('  → 操作日志包含损坏报告记录')
    const detail = await getEquipmentDetail(admin, equipId)
    const logs = detail.operation_logs
    const hasDamageReportLog = logs.some(
      (l: any) => l.action === 'damage_report'
    )
    assert(hasDamageReportLog, '操作日志包含 damage_report')
    const hasOfflineSyncLog = logs.some(
      (l: any) => l.action === 'offline_signoff_sync'
    )
    assert(hasOfflineSyncLog, '操作日志包含 offline_signoff_sync')
  } finally {
    await clearTestOfflineSignoffs(admin)
    const { data: borrowsData } = await request('GET', '/borrows?status=pending_confirm', undefined, admin)
    const record = borrowsData.data?.find((r: any) => r.equipment_id === equipId)
    if (record) {
      await request('PUT', `/borrows/${record.id}/confirm-damage`, { deposit_deducted: 0 }, admin)
      await request('PUT', `/borrows/${record.id}/return`, {}, admin)
    } else {
      const borrowId = await getBorrowedBorrowId(admin, equipId)
      if (borrowId) {
        await request('PUT', `/borrows/${borrowId}/return`, {}, admin)
      }
    }
    await request('DELETE', `/equipments/${equipId}`, undefined, admin)
  }
}

async function testReservationPickupLock() {
  console.log('\n📋 测试组 18：预约联动 - 取件锁匹配')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '取件锁测试设备')

  try {
    console.log('  → 先在线借出设备')
    await borrowEquipment(admin, equipId, '原借用人', '13900000180')

    console.log('  → 创建预约（排队中）')
    const { data: reservationData } = await request('POST', '/reservations', {
      equipment_id: equipId,
      borrower_name: '预约取件人',
      borrower_phone: '13900000181',
    }, admin)
    assert(reservationData.data?.status === 'queued', '预约状态为 queued')

    console.log('  → 在线归还，触发自动锁定下一位预约')
    const borrowId = await getBorrowedBorrowId(admin, equipId)
    await request('PUT', `/borrows/${borrowId}/return`, {}, admin)

    console.log('  → 验证设备状态变为已预约，且有锁定预约')
    const equipDetail = await getEquipmentDetail(admin, equipId)
    assert(equipDetail.equipment.status === 'reserved', '设备状态为 reserved')
    assert(!!equipDetail.equipment.locked_reservation_id, '有锁定的预约ID')

    console.log('  → 创建离线借出补录，借用人与锁定预约一致')
    const createRes = await createOfflineSignoff(
      admin,
      'borrow',
      equipId,
      '预约取件人',
      '13900000181'
    )
    const recordId = createRes.data.data.id

    console.log('  → 同步应成功，取件锁身份匹配')
    const syncRes = await syncOfflineSignoff(admin, recordId)
    assert(syncRes.status === 200, '同步成功')
    assert(syncRes.data.data.status === 'completed', '状态为 completed')

    console.log('  → 同步后预约状态变为已完成')
    const { data: reservationsAfter } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
    const completedReservation = reservationsAfter.data?.find((r: any) => r.borrower_name === '预约取件人')
    assert(completedReservation?.status === 'completed', '预约状态为 completed')

    console.log('  → 设备状态变为已借出')
    const equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'borrowed', '设备状态为 borrowed')
  } finally {
    await clearTestOfflineSignoffs(admin)
    const borrowId = await getBorrowedBorrowId(admin, equipId)
    if (borrowId) {
      await request('PUT', `/borrows/${borrowId}/return`, {}, admin)
    }
    await request('DELETE', `/equipments/${equipId}`, undefined, admin)
  }
}

async function testPickupLockMismatch() {
  console.log('\n📋 测试组 19：取件锁冲突 - 身份不匹配')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '取件锁不匹配设备')

  try {
    console.log('  → 先在线借出设备')
    await borrowEquipment(admin, equipId, '原借用人', '13900000190')

    console.log('  → 创建预约（排队中）')
    await request('POST', '/reservations', {
      equipment_id: equipId,
      borrower_name: '预约取件人A',
      borrower_phone: '13900000191',
    }, admin)

    console.log('  → 在线归还，触发自动锁定')
    const borrowId = await getBorrowedBorrowId(admin, equipId)
    await request('PUT', `/borrows/${borrowId}/return`, {}, admin)

    console.log('  → 创建设备状态为 reserved 的离线借出补录（借用人不同）')
    const createRes = await createOfflineSignoff(
      admin,
      'borrow',
      equipId,
      '非预约取件人B',
      '13900000192'
    )
    const recordId = createRes.data.data.id

    console.log('  → 同步应返回 409 取件锁冲突')
    const syncRes = await syncOfflineSignoff(admin, recordId)
    assert(syncRes.status === 409, '同步返回 409 冲突')
    assert(syncRes.data.conflict?.type === 'pickup_lock_mismatch', '冲突类型为 pickup_lock_mismatch')
    assert(!!syncRes.data.conflict.locked_reservation_id, '有锁定预约ID')
    assert(!!syncRes.data.conflict.locked_borrower_name, '有锁定借用人姓名')

    console.log('  → 记录状态变为 failed')
    const recordDetail = await request('GET', `/offline-signoffs/${recordId}`, undefined, admin)
    assert(recordDetail.data.data?.status === 'failed', '记录状态为 failed')
    assert(recordDetail.data.data?.conflict_info?.type === 'pickup_lock_mismatch', '冲突信息正确')

    console.log('  → 区分错误类型：不是设备状态变更，是取件锁不匹配')
    assert(syncRes.data.conflict?.type !== 'equipment_status_changed', '冲突类型不是设备状态变更')
    assert(syncRes.status === 409, '状态码为 409 冲突')
  } finally {
    await clearTestOfflineSignoffs(admin)
    const equipDetail = await getEquipmentDetail(admin, equipId)
    if (equipDetail.equipment.locked_reservation_id) {
      await request('PUT', `/reservations/${equipDetail.equipment.locked_reservation_id}/release-lock`, {}, admin)
    }
    const borrowId = await getBorrowedBorrowId(admin, equipId)
    if (borrowId) {
      await request('PUT', `/borrows/${borrowId}/return`, {}, admin)
    }
    await request('DELETE', `/equipments/${equipId}`, undefined, admin)
  }
}

async function testConflictTypeDiscrimination() {
  console.log('\n📋 测试组 20：冲突类型区分 - 冲突/权限/状态不匹配')
  const admin = await getAdminToken()
  const frontDesk = await getFrontDeskToken()
  const equipId = await createTestEquipment(admin, '冲突类型区分设备')

  try {
    console.log('  → 测试1：权限拒绝（前台尝试删除）')
    const createRes = await createOfflineSignoff(
      admin,
      'borrow',
      equipId,
      '权限测试人',
      '13900000200'
    )
    const recordId = createRes.data.data.id
    const delRes = await deleteOfflineSignoff(frontDesk, recordId)
    assert(delRes.status === 403, '权限拒绝返回 403')
    assert(delRes.data.error?.includes('管理员') || delRes.data.error?.includes('仅管理员'),
      '错误信息表明是权限问题')

    console.log('  → 测试2：状态不匹配 - 重复同步已完成记录')
    await syncOfflineSignoff(admin, recordId)
    const syncAgainRes = await syncOfflineSignoff(admin, recordId)
    assert(syncAgainRes.status === 400, '重复同步返回 400')
    assert(syncAgainRes.data.error?.includes('已完成'), '错误信息表明是状态问题')

    console.log('  → 测试3：冲突 - 设备状态变更返回 409')
    const equip2 = await createTestEquipment(admin, '冲突类型设备2')
    const create2 = await createOfflineSignoff(
      admin,
      'borrow',
      equip2,
      '冲突测试人',
      '13900000201'
    )
    await borrowEquipment(admin, equip2, '干扰人', '13900000202')
    const conflictRes = await syncOfflineSignoff(admin, create2.data.data.id)
    assert(conflictRes.status === 409, '设备状态冲突返回 409')
    assert(conflictRes.data.conflict?.type === 'equipment_status_changed',
      '冲突类型正确')
    assert(!!conflictRes.data.conflict?.snapshot_status, '有快照状态')
    assert(!!conflictRes.data.conflict?.current_status, '有当前状态')

    console.log('  → 三种错误类型状态码不同：403权限 / 400状态 / 409冲突')
    assert(delRes.status === 403, '权限拒绝是 403')
    assert(syncAgainRes.status === 400, '状态不匹配是 400')
    assert(conflictRes.status === 409, '业务冲突是 409')

    await request('DELETE', `/equipments/${equip2}`, undefined, admin)
  } finally {
    await clearTestOfflineSignoffs(admin)
    const borrowId = await getBorrowedBorrowId(admin, equipId)
    if (borrowId) {
      await request('PUT', `/borrows/${borrowId}/return`, {}, admin)
    }
    await request('DELETE', `/equipments/${equipId}`, undefined, admin)
  }
}

async function testImportThenSync() {
  console.log('\n📋 测试组 21：JSON 导入后继续同步')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '导入后同步设备')

  try {
    console.log('  → 创建测试补录记录')
    const createRes = await createOfflineSignoff(
      admin,
      'borrow',
      equipId,
      '导入同步人',
      '13900000210',
      { notes: '导入后同步测试' }
    )
    const originalId = createRes.data.data.id

    console.log('  → 导出 JSON')
    const exportRes = await exportOfflineSignoffs(admin)
    const exportData = JSON.parse(exportRes.data)
    assert(exportData.records.length >= 1, '导出至少1条记录')

    console.log('  → 先删除原记录')
    await deleteOfflineSignoff(admin, originalId)
    const listBefore = await getOfflineSignoffList(admin, 'pending')
    const countBefore = (listBefore.data || []).filter(
      (r: any) => r.id === originalId
    ).length
    assert(countBefore === 0, '删除后没有该设备的记录')

    console.log('  → 导入 JSON 记录')
    const importRes = await importOfflineSignoffs(admin, exportData.records)
    assert(importRes.status === 200, '导入成功')
    assert(importRes.data.data.imported >= 1, '至少导入1条')

    console.log('  → 验证导入的记录状态为 pending')
    const listAfter = await getOfflineSignoffList(admin, 'pending')
    const importedRecords = (listAfter.data || []).filter(
      (r: any) => r.equipment_snapshot?.name?.includes('导入后同步')
    )
    assert(importedRecords.length >= 1, '导入的记录存在')
    assert(importedRecords[0].status === 'pending', '导入记录状态为 pending')

    console.log('  → 导入的记录可以正常同步')
    const importRecordId = importedRecords[0].id
    const syncRes = await syncOfflineSignoff(admin, importRecordId)
    assert(syncRes.status === 200, '导入记录同步成功')
    assert(syncRes.data.data.status === 'completed', '同步后为 completed')

    console.log('  → 同步后设备状态正确更新')
    const equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'borrowed', '设备变为 borrowed')

    console.log('  → 导入记录的原始信息保留')
    assert(syncRes.data.data.borrower_name === '导入同步人', '借用人信息保留')
    assert(syncRes.data.data.notes === '导入后同步测试', '备注信息保留')
  } finally {
    await clearTestOfflineSignoffs(admin)
    const borrowId = await getBorrowedBorrowId(admin, equipId)
    if (borrowId) {
      await request('PUT', `/borrows/${borrowId}/return`, {}, admin)
    }
    await request('DELETE', `/equipments/${equipId}`, undefined, admin)
  }
}

async function testRetryFailedRecord() {
  console.log('\n📋 测试组 22：失败记录重试完整链路')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '失败重试设备')

  try {
    console.log('  → 创建离线借出补录')
    const createRes = await createOfflineSignoff(
      admin,
      'borrow',
      equipId,
      '重试借用人',
      '13900000220'
    )
    const recordId = createRes.data.data.id

    console.log('  → 先在线借出，造成冲突')
    await borrowEquipment(admin, equipId, '干扰借用人', '13900000221')

    console.log('  → 第一次同步失败')
    const sync1Res = await syncOfflineSignoff(admin, recordId)
    assert(sync1Res.status === 409, '第一次同步失败')
    assert(sync1Res.data.data?.status === 'failed', '状态为 failed')
    assert(!!sync1Res.data.data?.error_message, '有错误信息')

    console.log('  → 失败记录在失败列表中')
    const failedList = await getOfflineSignoffList(admin, 'failed')
    const inFailedList = (failedList.data || []).some((r: any) => r.id === recordId)
    assert(inFailedList, '失败列表中有该记录')

    console.log('  → 统计中失败数量增加')
    const stats1 = await getOfflineSignoffStats(admin)
    assert(stats1.failed >= 1, '失败数量 >= 1')

    console.log('  → 归还设备，解决冲突原因')
    const borrowId = await getBorrowedBorrowId(admin, equipId)
    await request('PUT', `/borrows/${borrowId}/return`, {}, admin)

    console.log('  → 管理员重试（重置为 pending）')
    const resolveRes = await resolveOfflineSignoff(admin, recordId, 'retry')
    assert(resolveRes.status === 200, '重试成功')
    assert(resolveRes.data.data?.status === 'pending', '状态重置为 pending')
    assert(!resolveRes.data.data?.error_message, '错误信息清空')
    assert(!resolveRes.data.data?.conflict_info, '冲突信息清空')

    console.log('  → 重试后回到待同步列表')
    const pendingList = await getOfflineSignoffList(admin, 'pending')
    const inPendingList = (pendingList.data || []).some((r: any) => r.id === recordId)
    assert(inPendingList, '待同步列表中有该记录')

    console.log('  → 再次同步成功')
    const sync2Res = await syncOfflineSignoff(admin, recordId)
    assert(sync2Res.status === 200, '第二次同步成功')
    assert(sync2Res.data.data?.status === 'completed', '状态为 completed')

    console.log('  → 统计数据正确更新')
    const stats2 = await getOfflineSignoffStats(admin)
    assert(stats2.completed >= 1, '已完成数量增加')
    assert(stats2.failed < stats1.failed || stats2.failed === 0, '失败数量减少')
  } finally {
    await clearTestOfflineSignoffs(admin)
    const borrowId = await getBorrowedBorrowId(admin, equipId)
    if (borrowId) {
      await request('PUT', `/borrows/${borrowId}/return`, {}, admin)
    }
    await request('DELETE', `/equipments/${equipId}`, undefined, admin)
  }
}

async function testSyncingStateConcurrency() {
  console.log('\n📋 测试组 23：同步中状态与并发保护')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '并发同步设备')

  try {
    console.log('  → 创建离线借出补录')
    const createRes = await createOfflineSignoff(
      admin,
      'borrow',
      equipId,
      '并发借用人',
      '13900000230'
    )
    const recordId = createRes.data.data.id

    console.log('  → 初始状态为 pending')
    assert(createRes.data.data.status === 'pending', '初始状态 pending')

    console.log('  → syncing 状态下重复同步返回 409')
    const db = await import('../api/db.js')
    const setSyncingStmt = db.default.prepare(
      "UPDATE offline_signoff_records SET status = 'syncing', updated_at = datetime('now', 'localtime') WHERE id = ?"
    )
    setSyncingStmt.run(recordId)

    const syncRes = await syncOfflineSignoff(admin, recordId)
    assert(syncRes.status === 409, '同步中重复同步返回 409')
    assert(syncRes.data.error?.includes('同步中'), '错误信息包含同步中')

    console.log('  → 重置为 pending 后可正常同步')
    const resetStmt = db.default.prepare(
      "UPDATE offline_signoff_records SET status = 'pending', updated_at = datetime('now', 'localtime') WHERE id = ?"
    )
    resetStmt.run(recordId)

    const syncRes2 = await syncOfflineSignoff(admin, recordId)
    assert(syncRes2.status === 200, '重置后同步成功')
    assert(syncRes2.data.data.status === 'completed', '最终状态 completed')
  } finally {
    await clearTestOfflineSignoffs(admin)
    const borrowId = await getBorrowedBorrowId(admin, equipId)
    if (borrowId) {
      await request('PUT', `/borrows/${borrowId}/return`, {}, admin)
    }
    await request('DELETE', `/equipments/${equipId}`, undefined, admin)
  }
}

async function testOnlineStateChangeCausesSyncFail() {
  console.log('\n📋 测试组 24：在线端状态变化导致补写失败的多种场景')
  const admin = await getAdminToken()

  const testCases = [
    {
      name: '可用 → 已借出（借出补录）',
      type: 'borrow' as const,
      setupEquipStatus: 'available',
      borrower: '状态变更人A',
      phone: '1390000240',
      expectedStatus: 409,
      expectedConflictType: 'equipment_status_changed',
    },
    {
      name: '已借出 → 损坏（归还补录）',
      type: 'return' as const,
      setupEquipStatus: 'borrowed',
      borrower: '状态变更人B',
      phone: '1390000241',
      damageEquip: true,
      expectedStatus: 409,
      expectedConflictType: 'equipment_status_changed',
    },
  ]

  for (const tc of testCases) {
    console.log(`  → 场景：${tc.name}`)
    const equipId = await createTestEquipment(admin, `状态变更-${tc.name.substring(0, 8)}`)

    try {
      if (tc.setupEquipStatus === 'borrowed') {
        await borrowEquipment(admin, equipId, tc.borrower, tc.phone)
      }

      const createRes = await createOfflineSignoff(
        admin,
        tc.type,
        equipId,
        tc.borrower,
        tc.phone
      )
      const recordId = createRes.data.data.id

      if (tc.damageEquip) {
        const borrowId = await getBorrowedBorrowId(admin, equipId)
        if (borrowId) {
          await request('PUT', `/borrows/${borrowId}/damage`, { damage_description: '模拟损坏' }, admin)
        }
      } else if (tc.setupEquipStatus === 'available') {
        await borrowEquipment(admin, equipId, '干扰人C', '1390000249')
      }

      const syncRes = await syncOfflineSignoff(admin, recordId)
      assert(syncRes.status === tc.expectedStatus, `${tc.name}：状态码正确`)
      assert(
        syncRes.data.conflict?.type === tc.expectedConflictType,
        `${tc.name}：冲突类型正确`
      )
      assert(syncRes.data.data?.status === 'failed', `${tc.name}：记录状态为 failed`)
    } finally {
      await clearTestOfflineSignoffs(admin)
      const borrowId = await getBorrowedBorrowId(admin, equipId)
      if (borrowId) {
        const { data: borrowData } = await request('GET', `/borrows?status=borrowed`, undefined, admin)
        const isBorrowed = borrowData.data?.some((r: any) => r.id === borrowId)
        if (isBorrowed) {
          await request('PUT', `/borrows/${borrowId}/return`, {}, admin)
        } else {
          const { data: pendingData } = await request('GET', `/borrows?status=pending_confirm`, undefined, admin)
          const pendingRecord = pendingData.data?.find((r: any) => r.id === borrowId)
          if (pendingRecord) {
            await request('PUT', `/borrows/${borrowId}/confirm-damage`, { deposit_deducted: 0 }, admin)
            await request('PUT', `/borrows/${borrowId}/return`, {}, admin)
          }
        }
      }
      await request('DELETE', `/equipments/${equipId}`, undefined, admin)
    }
  }
}

async function testStatsAndLogsConsistency() {
  console.log('\n📋 测试组 25：统计列表与操作日志一致')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '日志统计一致设备')

  try {
    console.log('  → 创建3条记录：2条成功同步，1条失败')
    const equip2 = await createTestEquipment(admin, '日志统计设备2')
    const equip3 = await createTestEquipment(admin, '日志统计设备3')

    const r1 = await createOfflineSignoff(admin, 'borrow', equipId, '日志人1', '1390000250')
    const r2 = await createOfflineSignoff(admin, 'borrow', equip2, '日志人2', '1390000251')
    const r3 = await createOfflineSignoff(admin, 'borrow', equip3, '日志人3', '1390000252')

    await syncOfflineSignoff(admin, r1.data.data.id)
    await syncOfflineSignoff(admin, r2.data.data.id)

    await borrowEquipment(admin, equip3, '干扰人', '1390000259')
    await syncOfflineSignoff(admin, r3.data.data.id)

    console.log('  → 统计数据与各状态列表数量一致')
    const stats = await getOfflineSignoffStats(admin)
    const pendingList = await getOfflineSignoffList(admin, 'pending')
    const failedList = await getOfflineSignoffList(admin, 'failed')
    const completedList = await getOfflineSignoffList(admin, 'completed')
    const allList = await getOfflineSignoffList(admin)

    const testEquipFilter = (r: any) => r.equipment_snapshot?.name?.includes('日志统计')

    const pendingCount = (pendingList.data || []).filter(testEquipFilter).length
    const failedCount = (failedList.data || []).filter(testEquipFilter).length
    const completedCount = (completedList.data || []).filter(testEquipFilter).length
    const totalCount = (allList.data || []).filter(testEquipFilter).length

    assert(pendingCount <= stats.pending, '待同步数量不超过统计')
    assert(failedCount <= stats.failed, '失败数量不超过统计')
    assert(completedCount <= stats.completed, '已完成数量不超过统计')
    assert(totalCount <= stats.total, '总数不超过统计')
    assert(pendingCount + failedCount + completedCount === totalCount,
      '各状态数量之和等于总数')

    console.log('  → 操作日志包含离线补录创建和同步记录')
    const detail = await getEquipmentDetail(admin, equipId)
    const logs = detail.operation_logs

    const hasCreateLog = logs.some((l: any) => l.action === 'offline_signoff_create')
    assert(hasCreateLog, '有离线补录创建日志')

    const hasSyncLog = logs.some((l: any) => l.action === 'offline_signoff_sync')
    assert(hasSyncLog, '有离线补录同步日志')

    const hasBorrowLog = logs.some((l: any) => l.action === 'borrow')
    assert(hasBorrowLog, '有借出操作日志')

    console.log('  → 日志数量与操作次数匹配')
    const offlineLogs = logs.filter((l: any) => l.action?.startsWith('offline_signoff'))
    assert(offlineLogs.length >= 2, '至少有2条离线补录相关日志')

    await request('DELETE', `/equipments/${equip2}`, undefined, admin)
    await request('DELETE', `/equipments/${equip3}`, undefined, admin)
  } finally {
    await clearTestOfflineSignoffs(admin)
    for (const eqName of ['日志统计一致设备', '日志统计设备2', '日志统计设备3']) {
      const { data: equips } = await request('GET', '/equipments', undefined, admin)
      const equip = equips.data?.find((e: any) => e.name === eqName)
      if (equip) {
        const borrowId = await getBorrowedBorrowId(admin, equip.id)
        if (borrowId) {
          await request('PUT', `/borrows/${borrowId}/return`, {}, admin)
        }
        await request('DELETE', `/equipments/${equip.id}`, undefined, admin)
      }
    }
  }
}

async function testReturnAutoLockReservation() {
  console.log('\n📋 测试组 26：归还补录同步后自动锁定下一位预约')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '归还自动锁预约设备')

  try {
    console.log('  → 先在线借出设备')
    await borrowEquipment(admin, equipId, '原借用人', '13900000260')

    console.log('  → 创建两个预约')
    await request('POST', '/reservations', {
      equipment_id: equipId,
      borrower_name: '预约人A',
      borrower_phone: '13900000261',
    }, admin)
    await request('POST', '/reservations', {
      equipment_id: equipId,
      borrower_name: '预约人B',
      borrower_phone: '13900000262',
    }, admin)

    console.log('  → 创建离线归还补录')
    const createRes = await createOfflineSignoff(
      admin,
      'return',
      equipId,
      '原借用人',
      '13900000260'
    )
    const recordId = createRes.data.data.id

    console.log('  → 同步归还补录')
    const syncRes = await syncOfflineSignoff(admin, recordId)
    assert(syncRes.status === 200, '归还同步成功')
    assert(syncRes.data.data.status === 'completed', '状态为 completed')

    console.log('  → 设备状态变为已预约')
    const equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'reserved', '设备状态为 reserved')

    console.log('  → 第一位预约被自动锁定')
    const { data: reservations } = await request('GET', `/reservations?equipment_id=${equipId}&status=locked`, undefined, admin)
    assert(reservations.data?.length === 1, '有一条锁定的预约')
    assert(reservations.data[0].borrower_name === '预约人A', '锁定的是第一位预约')

    console.log('  → 设备有锁定预约ID')
    const detail = await getEquipmentDetail(admin, equipId)
    assert(!!detail.equipment.locked_reservation_id, '设备有锁定预约ID')
    assert(detail.equipment.locked_reservation_id === reservations.data[0].id,
      '锁定预约ID一致')
  } finally {
    await clearTestOfflineSignoffs(admin)
    const detail = await getEquipmentDetail(admin, equipId)
    if (detail.equipment.locked_reservation_id) {
      await request('PUT', `/reservations/${detail.equipment.locked_reservation_id}/release-lock`, {}, admin)
    }
    const borrowId = await getBorrowedBorrowId(admin, equipId)
    if (borrowId) {
      await request('PUT', `/borrows/${borrowId}/return`, {}, admin)
    }
    await request('DELETE', `/equipments/${equipId}`, undefined, admin)
  }
}

async function testBatchSyncMixedResults() {
  console.log('\n📋 测试组 27：批量同步 - 混合成功与失败')
  const admin = await getAdminToken()
  const equip1 = await createTestEquipment(admin, '批量混合设备1')
  const equip2 = await createTestEquipment(admin, '批量混合设备2')
  const equip3 = await createTestEquipment(admin, '批量混合设备3')

  try {
    console.log('  → 创建3条待同步记录')
    const r1 = await createOfflineSignoff(admin, 'borrow', equip1, '批量人1', '13900000270')
    const r2 = await createOfflineSignoff(admin, 'borrow', equip2, '批量人2', '13900000271')
    const r3 = await createOfflineSignoff(admin, 'borrow', equip3, '批量人3', '13900000272')

    console.log('  → 预先借出设备2，使其中一条同步失败')
    await borrowEquipment(admin, equip2, '干扰人', '13900000279')

    console.log('  → 执行批量同步')
    const batchRes = await batchSyncOfflineSignoffs(admin)
    assert(batchRes.status === 200, '批量同步请求成功')
    assert(batchRes.data.data.total >= 3, '至少处理3条')
    assert(batchRes.data.data.success >= 2, '至少成功2条')
    assert(batchRes.data.data.failed >= 1, '至少失败1条')

    console.log('  → 结果中包含每条记录的详细状态')
    const results = batchRes.data.data.results
    assert(Array.isArray(results), '结果是数组')
    assert(results.length >= 3, '结果数量正确')

    const successResults = results.filter((r: any) => r.status === 'success')
    const failedResults = results.filter((r: any) => r.status === 'failed')
    assert(successResults.length >= 2, '成功结果数量正确')
    assert(failedResults.length >= 1, '失败结果数量正确')

    console.log('  → 失败结果包含错误信息')
    const failedRecord = failedResults[0]
    assert(!!failedRecord.error, '失败记录有错误信息')
    assert(!!failedRecord.id, '失败记录有ID')

    console.log('  → 验证实际记录状态')
    const record1Detail = await request('GET', `/offline-signoffs/${r1.data.data.id}`, undefined, admin)
    const record2Detail = await request('GET', `/offline-signoffs/${r2.data.data.id}`, undefined, admin)
    const record3Detail = await request('GET', `/offline-signoffs/${r3.data.data.id}`, undefined, admin)

    assert(record1Detail.data.data?.status === 'completed', '记录1已完成')
    assert(record2Detail.data.data?.status === 'failed', '记录2失败')
    assert(record3Detail.data.data?.status === 'completed', '记录3已完成')
  } finally {
    await clearTestOfflineSignoffs(admin)
    for (const eq of [equip1, equip2, equip3]) {
      const borrowId = await getBorrowedBorrowId(admin, eq)
      if (borrowId) {
        await request('PUT', `/borrows/${borrowId}/return`, {}, admin)
      }
      await request('DELETE', `/equipments/${eq}`, undefined, admin)
    }
  }
}

async function main() {
  console.log('🚀 离线签收补录台回归测试开始\n')
  console.log('检查服务器连接...')

  try {
    const healthRes = await fetch(`${BASE}/health`)
    if (healthRes.status !== 200) {
      console.error('❌ 服务器未响应，请确认后端服务已启动 (npm run server:dev)')
      process.exit(1)
    }
    console.log('✅ 服务器连接正常\n')
  } catch {
    console.error('❌ 无法连接到服务器 http://localhost:3001，请确认后端服务已启动')
    process.exit(1)
  }

  await testCreateOfflineBorrowRecord()
  await testCreateOfflineReturnRecord()
  await testCreateOfflineDamageRecord()
  await testSyncBorrowRecord()
  await testSyncReturnRecord()
  await testSyncDamageRecord()
  await testConflictDetection()
  await testConflictResolutionRetry()
  await testConflictResolutionForce()
  await testConflictResolutionDiscard()
  await testExportImportJson()
  await testImportThenSync()
  await testPermissionControl()
  await testBatchSync()
  await testBatchSyncMixedResults()
  await testCrossRestartPersistence()
  await testEndToEndOfflineBorrowFlow()
  await testEndToEndOfflineReturnFlow()
  await testStatsConsistencyAfterSync()
  await testReservationPickupLock()
  await testPickupLockMismatch()
  await testReturnAutoLockReservation()
  await testConflictTypeDiscrimination()
  await testRetryFailedRecord()
  await testSyncingStateConcurrency()
  await testOnlineStateChangeCausesSyncFail()
  await testStatsAndLogsConsistency()

  console.log('\n' + '='.repeat(60))
  console.log(`📊 测试结果：通过 ${passed} / 失败 ${failed} / 总计 ${passed + failed}`)
  if (failures.length > 0) {
    console.log('\n❌ 失败项：')
    failures.forEach(f => console.log(`  - ${f}`))
  } else {
    console.log('\n🎉 全部通过！')
  }
  console.log('='.repeat(60))

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('测试运行出错:', err)
  process.exit(1)
})
