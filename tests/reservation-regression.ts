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

async function createTestEquipment(token: string, name: string) {
  const { status, data } = await request('POST', '/equipments', {
    name,
    type: '测试设备',
    deposit_amount: 100,
  }, token)
  if (status !== 201) throw new Error(`Create equipment failed: ${JSON.stringify(data)}`)
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

async function returnEquipment(token: string, borrowId: number) {
  const { status, data } = await request('PUT', `/borrows/${borrowId}/return`, {}, token)
  if (status !== 200) throw new Error(`Return failed: ${JSON.stringify(data)}`)
  return data
}

async function createReservation(token: string, equipmentId: number, name: string, phone: string) {
  return request('POST', '/reservations', {
    equipment_id: equipmentId,
    borrower_name: name,
    borrower_phone: phone,
  }, token)
}

async function getEquipmentStatus(token: string, equipmentId: number) {
  const { data } = await request('GET', `/equipments/${equipmentId}/detail`, undefined, token)
  return data.data.equipment.status as string
}

async function getEquipmentDetail(token: string, equipmentId: number) {
  const { data } = await request('GET', `/equipments/${equipmentId}/detail`, undefined, token)
  return data.data
}

async function resetEquipment(token: string, equipmentId: number) {
  const detail = await getEquipmentDetail(token, equipmentId)
  const status = detail.equipment.status

  if (status === 'borrowed') {
    const { data: borrowData } = await request('GET', '/borrows?status=borrowed', undefined, token)
    const record = borrowData.data.find((r: any) => r.equipment_id === equipmentId)
    if (record) await returnEquipment(token, record.id)
  }

  for (let attempt = 0; attempt < 10; attempt++) {
    const freshDetail = await getEquipmentDetail(token, equipmentId)
    const activeResvs = (freshDetail.reservations || []).filter(
      (r: any) => r.status === 'queued' || r.status === 'notified' || r.status === 'locked'
    )
    if (activeResvs.length === 0) break
    for (const r of activeResvs) {
      await request('PUT', `/reservations/${r.id}/cancel`, {
        cancel_reason: '测试清理',
        expected_version: r.version,
      }, token)
    }
  }

  const updatedDetail = await getEquipmentDetail(token, equipmentId)
  if (updatedDetail.equipment.status === 'reserved') {
    await request('PUT', `/equipments/${equipmentId}`, { status: 'available' }, token)
  }
}

async function testLockActivationOnReturn() {
  console.log('\n📋 测试组 1：归还后自动锁定生效')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '锁定测试设备')

  try {
    await borrowEquipment(admin, equipId, '借用人A', '13800000001')
    await createReservation(admin, equipId, '预约人B', '13800000002')
    await createReservation(admin, equipId, '预约人C', '13800000003')

    const { data: borrowData } = await request('GET', '/borrows?status=borrowed', undefined, admin)
    const record = borrowData.data.find((r: any) => r.equipment_id === equipId)
    const returnRes = await returnEquipment(admin, record.id)

    const equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'reserved', '归还后设备状态为 reserved')

    assert(!!returnRes.next_reservation, '归还响应包含 next_reservation')
    assert(returnRes.next_reservation?.status === 'locked', '下一位预约人状态为 locked')
    assert(!!returnRes.next_reservation?.locked_at, '锁定时间已设置')
    assert(!!returnRes.next_reservation?.lock_expires_at, '锁定超时时间已设置')

    const { data: resvData } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
    const locked = resvData.data.find((r: any) => r.status === 'locked')
    const queued = resvData.data.find((r: any) => r.status === 'queued')
    assert(!!locked, '存在一条 locked 状态的预约')
    assert(locked.borrower_name === '预约人B', '锁定的是第一位预约人')
    assert(!!queued, '第二位仍为 queued')
    assert(queued.borrower_name === '预约人C', '排队中的是第二位预约人')

    const equipDetail = await getEquipmentDetail(admin, equipId)
    assert(equipDetail.equipment.locked_reservation_id === locked.id, '设备 locked_reservation_id 指向锁定预约')

    const logs = equipDetail.operation_logs
    const hasAutoLockLog = logs.some((l: any) => l.action === 'reservation_auto_lock')
    assert(hasAutoLockLog, '操作日志包含 reservation_auto_lock')
  } finally {
    await resetEquipment(admin, equipId)
  }
}

async function testUnauthorizedIntercept() {
  console.log('\n📋 测试组 2：越权拦截校验')
  const admin = await getAdminToken()
  const frontDesk = await getFrontDeskToken()
  const equipId = await createTestEquipment(admin, '越权测试设备')

  try {
    await borrowEquipment(admin, equipId, '越权借用人', '13800000010')
    await createReservation(admin, equipId, '越权预约人', '13800000011')

    const { data: borrowData } = await request('GET', '/borrows?status=borrowed', undefined, admin)
    const record = borrowData.data.find((r: any) => r.equipment_id === equipId)
    await returnEquipment(admin, record.id)

    console.log('  → 前台非锁定预约人不可借出')
    let res = await request('POST', '/borrows', {
      equipment_id: equipId,
      borrower_name: '无关人',
      borrower_phone: '13800000099',
    }, frontDesk)
    assert(res.status === 403, '前台非锁定预约人借出返回 403')
    assert(res.data.error?.includes('仅限该预约人取件'), '错误信息提示仅限锁定预约人取件')
    assert(res.data.conflict?.type === 'pickup_lock_mismatch', '冲突类型为 pickup_lock_mismatch')

    console.log('  → 管理员也不可越权借出给队列外的人')
    res = await request('POST', '/borrows', {
      equipment_id: equipId,
      borrower_name: '无关人',
      borrower_phone: '13800000099',
    }, admin)
    assert(res.status === 403, '管理员越权借出也返回 403')
    assert(res.data.error?.includes('管理员也不可越权'), '错误信息提示管理员也不可越权')

    console.log('  → 锁定预约人可以正常借出')
    const { data: resvData } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
    const lockedResv = resvData.data.find((r: any) => r.status === 'locked')
    res = await request('POST', '/borrows', {
      equipment_id: equipId,
      borrower_name: lockedResv.borrower_name,
      borrower_phone: lockedResv.borrower_phone,
    }, frontDesk)
    assert(res.status === 201, '锁定预约人前台可借出')
    const afterBorrow = await getEquipmentStatus(admin, equipId)
    assert(afterBorrow === 'borrowed', '借出后设备为 borrowed')
  } finally {
    await resetEquipment(admin, equipId)
  }
}

async function testCancelReleasesLockAndAutoLocksNext() {
  console.log('\n📋 测试组 3：取消锁定后自动锁定下一位')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '取消释放测试设备')

  try {
    await borrowEquipment(admin, equipId, '取消借用人', '13800000020')
    await createReservation(admin, equipId, '取消预约1', '13800000021')
    await createReservation(admin, equipId, '取消预约2', '13800000022')

    const { data: borrowData } = await request('GET', '/borrows?status=borrowed', undefined, admin)
    const record = borrowData.data.find((r: any) => r.equipment_id === equipId)
    await returnEquipment(admin, record.id)

    const { data: resvData } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
    const lockedResv = resvData.data.find((r: any) => r.status === 'locked')
    assert(lockedResv.borrower_name === '取消预约1', '第一位被锁定')

    console.log('  → 取消锁定预约后自动锁定下一位')
    const cancelRes = await request('PUT', `/reservations/${lockedResv.id}/cancel`, {
      cancel_reason: '不需要了',
      expected_version: lockedResv.version,
    }, admin)
    assert(cancelRes.status === 200, '取消锁定预约成功')

    const equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'reserved', '取消后设备仍为 reserved')

    const { data: afterCancelData } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
    const afterCancel = afterCancelData.data as any[]
    const newLocked = afterCancel.find((r: any) => r.status === 'locked')
    const queued = afterCancel.filter((r: any) => r.status === 'queued')
    assert(!!newLocked, '取消后自动锁定下一位')
    assert(newLocked.borrower_name === '取消预约2', '下一位是预约2')
    assert(queued.length === 0, '没有排队中的了')

    const equipDetail = await getEquipmentDetail(admin, equipId)
    assert(equipDetail.equipment.locked_reservation_id === newLocked.id, '设备锁定ID更新为新的锁定预约')
  } finally {
    await resetEquipment(admin, equipId)
  }
}

async function testCrossRestartRecovery() {
  console.log('\n📋 测试组 4：跨重启持久化校验')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '持久化测试设备')

  try {
    await borrowEquipment(admin, equipId, '持久借用人', '13800000030')
    await createReservation(admin, equipId, '持久预约1', '13800000031')
    await createReservation(admin, equipId, '持久预约2', '13800000032')

    const { data: borrowData } = await request('GET', '/borrows?status=borrowed', undefined, admin)
    const record = borrowData.data.find((r: any) => r.equipment_id === equipId)
    await returnEquipment(admin, record.id)

    const equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'reserved', '归还后设备为 reserved')

    let { data: resvData } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
    let locked = resvData.data.find((r: any) => r.status === 'locked')
    let queued = resvData.data.find((r: any) => r.status === 'queued')
    assert(!!locked, '有一位被锁定')
    assert(!!queued, '有一位在排队')

    const lockedId = locked.id
    const lockedAt = locked.locked_at
    const lockExpiresAt = locked.lock_expires_at

    console.log('  → 重新查询验证锁定状态持久化（模拟重启）')
    const { data: resvRefresh } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
    const refreshedLocked = resvRefresh.data.find((r: any) => r.status === 'locked')
    assert(!!refreshedLocked, '刷新后锁定状态仍存在')
    assert(refreshedLocked.id === lockedId, '锁定预约ID不变')
    assert(refreshedLocked.locked_at === lockedAt, '锁定时间不变')
    assert(refreshedLocked.lock_expires_at === lockExpiresAt, '超时时间不变')

    const equipRefresh = await getEquipmentDetail(admin, equipId)
    assert(equipRefresh.equipment.status === 'reserved', '刷新后设备仍为 reserved')
    assert(equipRefresh.equipment.locked_reservation_id === lockedId, '刷新后设备锁定ID不变')

    console.log('  → 取消锁定后恢复给下一位')
    const cancelRes = await request('PUT', `/reservations/${refreshedLocked.id}/cancel`, {
      cancel_reason: '测试取消',
      expected_version: refreshedLocked.version,
    }, admin)
    assert(cancelRes.status === 200, '取消锁定预约成功')

    const { data: resvAfterCancel } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
    const newLocked = resvAfterCancel.data.find((r: any) => r.status === 'locked')
    assert(!!newLocked, '取消后自动锁定下一位')
    assert(newLocked.borrower_name === '持久预约2', '下一位被锁定')
  } finally {
    await resetEquipment(admin, equipId)
  }
}

async function testConcurrentConflict() {
  console.log('\n📋 测试组 5：并发冲突校验')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '并发冲突测试设备')

  try {
    await borrowEquipment(admin, equipId, '并发借用人', '13800000040')
    await createReservation(admin, equipId, '并发预约1', '13800000041')
    await createReservation(admin, equipId, '并发预约2', '13800000042')

    const { data: borrowData } = await request('GET', '/borrows?status=borrowed', undefined, admin)
    const record = borrowData.data.find((r: any) => r.equipment_id === equipId)
    await returnEquipment(admin, record.id)

    const { data: resvData } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
    const lockedResv = resvData.data.find((r: any) => r.status === 'locked')

    console.log('  → 两个窗口同时尝试用非锁定人借出已锁定设备')
    const [res1, res2] = await Promise.all([
      request('POST', '/borrows', {
        equipment_id: equipId,
        borrower_name: '并发预约2',
        borrower_phone: '13800000042',
      }, admin),
      request('POST', '/borrows', {
        equipment_id: equipId,
        borrower_name: '并发预约2',
        borrower_phone: '13800000042',
      }, admin),
    ])
    const bothBlocked = (res1.status === 403 ? 1 : 0) + (res2.status === 403 ? 1 : 0)
    assert(bothBlocked === 2, '两个窗口同时用非锁定人借出都被拦截')

    console.log('  → 两个窗口同时尝试用锁定人借出，只有一个能成功')
    const [borrow1, borrow2] = await Promise.all([
      request('POST', '/borrows', {
        equipment_id: equipId,
        borrower_name: lockedResv.borrower_name,
        borrower_phone: lockedResv.borrower_phone,
      }, admin),
      request('POST', '/borrows', {
        equipment_id: equipId,
        borrower_name: lockedResv.borrower_name,
        borrower_phone: lockedResv.borrower_phone,
      }, admin),
    ])
    const successCount = (borrow1.status === 201 ? 1 : 0) + (borrow2.status === 201 ? 1 : 0)
    assert(successCount === 1, '并发借出只有一个成功')
    const conflictCount = (borrow1.status === 409 ? 1 : 0) + (borrow2.status === 409 ? 1 : 0) +
      (borrow1.status === 403 ? 1 : 0) + (borrow2.status === 403 ? 1 : 0) +
      (borrow1.status === 400 ? 1 : 0) + (borrow2.status === 400 ? 1 : 0)
    assert(conflictCount >= 1, '失败的请求返回冲突、权限或状态错误')
  } finally {
    await resetEquipment(admin, equipId)
  }
}

async function testExportConsistency() {
  console.log('\n📋 测试组 6：导出一致性校验')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '导出锁定测试-唯一')

  try {
    await borrowEquipment(admin, equipId, '导出借用人', '13800000050')
    await createReservation(admin, equipId, '导出锁定预约-唯一', '13800000051')

    const { data: borrowData } = await request('GET', '/borrows?status=borrowed', undefined, admin)
    const record = borrowData.data.find((r: any) => r.equipment_id === equipId)
    await returnEquipment(admin, record.id)

    const equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'reserved', '导出前设备为 reserved')

    console.log('  → 设备 CSV 导出包含锁定预约人')
    const equipCsvRes = await fetch(`${BASE}/export/equipments`, {
      headers: { Authorization: `Bearer ${admin}` },
    })
    const equipCsv = await equipCsvRes.text()
    const equipRow = equipCsv.split('\n').find((line: string) => line.includes('导出锁定测试-唯一'))
    assert(!!equipRow, '设备 CSV 包含测试设备')
    assert(equipRow!.includes('已预约'), '设备 CSV 状态显示「已预约」')
    assert(equipRow!.includes('导出锁定预约-唯一'), '设备 CSV 包含锁定预约人')

    console.log('  → 预约 CSV 导出包含正确锁定状态')
    const resvCsvRes = await fetch(`${BASE}/export/reservations`, {
      headers: { Authorization: `Bearer ${admin}` },
    })
    const resvCsvText = await resvCsvRes.text()
    const resvCsvLines = resvCsvText.split('\n')
    const resvHeader = resvCsvLines[0]
    const resvMatchingRows = resvCsvLines.filter((line: string) => line.includes('导出锁定预约-唯一'))
    assert(resvMatchingRows.length >= 1, '预约 CSV 包含测试预约')
    const resvRow = resvMatchingRows[resvMatchingRows.length - 1]
    assert(resvRow.includes('已锁定'), '预约 CSV 状态显示「已锁定」')
    assert(resvHeader.includes('锁定时间'), '预约 CSV 表头包含锁定时间列')
    assert(resvHeader.includes('锁定超时时间'), '预约 CSV 表头包含锁定超时时间列')
  } finally {
    await resetEquipment(admin, equipId)
  }
}

async function testEndToEndFlow() {
  console.log('\n📋 测试组 7：端到端用户链路（从通知到取件完成）')
  const admin = await getAdminToken()
  const frontDesk = await getFrontDeskToken()
  const equipId = await createTestEquipment(admin, '链路锁定测试设备')

  try {
    console.log('  步骤 1: 前台借出设备')
    const borrowId = await borrowEquipment(frontDesk, equipId, '链路借用人', '13800000060')
    let equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'borrowed', '借出后设备为 borrowed')

    console.log('  步骤 2: 前台为已借出设备创建 2 个预约')
    const resv1 = await createReservation(frontDesk, equipId, '链路预约1', '13800000061')
    assert(resv1.status === 201, '预约1创建成功')
    const resv2 = await createReservation(frontDesk, equipId, '链路预约2', '13800000062')
    assert(resv2.status === 201, '预约2创建成功')

    console.log('  步骤 3: 归还设备，验证自动锁定')
    const returnResult = await returnEquipment(frontDesk, borrowId)
    equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'reserved', '归还后设备为 reserved')
    assert(!!returnResult.next_reservation, '归还响应包含下一位预约人')
    assert(returnResult.next_reservation?.status === 'locked', '下一位预约人状态为 locked')
    assert(returnResult.next_reservation?.borrower_name === '链路预约1', '下一位是预约1')

    console.log('  步骤 4: 管理员不可越权借出给队列外的人')
    let borrowRes = await request('POST', '/borrows', {
      equipment_id: equipId,
      borrower_name: '无关人',
      borrower_phone: '13800000099',
    }, admin)
    assert(borrowRes.status === 403, '管理员越权借出被拦截')

    console.log('  步骤 5: 锁定预约人前台取件')
    const lockedResv = returnResult.next_reservation
    borrowRes = await request('POST', '/borrows', {
      equipment_id: equipId,
      borrower_name: lockedResv.borrower_name,
      borrower_phone: lockedResv.borrower_phone,
    }, frontDesk)
    assert(borrowRes.status === 201, '锁定预约人前台可取件')
    equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'borrowed', '取件后设备为 borrowed')

    const { data: resvData } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
    const completedResv = resvData.data.filter((r: any) => r.status === 'completed')
    assert(completedResv.length >= 1, '预约1自动完成')

    console.log('  步骤 6: 再次归还，自动锁定预约2')
    const { data: borrowData } = await request('GET', '/borrows?status=borrowed', undefined, admin)
    const record2 = borrowData.data.find((r: any) => r.equipment_id === equipId)
    const returnResult2 = await returnEquipment(frontDesk, record2.id)
    equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'reserved', '再次归还后设备为 reserved')
    assert(returnResult2.next_reservation?.status === 'locked', '下一位也是 locked')
    assert(returnResult2.next_reservation?.borrower_name === '链路预约2', '下一位是预约2')

    console.log('  步骤 7: 取消锁定预约，设备应变为可借')
    const { data: resvData2 } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
    const locked2 = resvData2.data.find((r: any) => r.status === 'locked')
    if (locked2) {
      const cancelRes = await request('PUT', `/reservations/${locked2.id}/cancel`, {
        cancel_reason: '不需要了',
        expected_version: locked2.version,
      }, frontDesk)
      assert(cancelRes.status === 200, '取消锁定预约成功')
      equipStatus = await getEquipmentStatus(admin, equipId)
      assert(equipStatus === 'available', '取消所有预约后设备变为 available')
    }

    console.log('  步骤 8: 操作日志记录关键流转')
    const detail = await getEquipmentDetail(admin, equipId)
    const logs = detail.operation_logs
    const hasBorrowLog = logs.some((l: any) => l.action === 'borrow')
    const hasReturnLog = logs.some((l: any) => l.action === 'return')
    const hasAutoLockLog = logs.some((l: any) => l.action === 'reservation_auto_lock')
    const hasCancelLog = logs.some((l: any) => l.action === 'reservation_cancel')
    const hasCompleteLog = logs.some((l: any) => l.action === 'reservation_auto_complete')
    assert(hasBorrowLog, '操作日志包含借出记录')
    assert(hasReturnLog, '操作日志包含归还记录')
    assert(hasAutoLockLog, '操作日志包含自动锁定记录')
    assert(hasCancelLog, '操作日志包含取消记录')
    assert(hasCompleteLog, '操作日志包含自动完成记录')
  } finally {
    await resetEquipment(admin, equipId)
  }
}

async function testRoleBoundaries() {
  console.log('\n📋 测试组 8：角色权限边界校验')
  const admin = await getAdminToken()
  const frontDesk = await getFrontDeskToken()
  const equipId = await createTestEquipment(admin, '权限边界测试设备')

  try {
    await borrowEquipment(admin, equipId, '权限借用人', '13800000070')

    console.log('  → 前台创建预约')
    const resvRes = await createReservation(frontDesk, equipId, '权限预约人', '13800000071')
    assert(resvRes.status === 201, '前台可创建预约')

    console.log('  → 前台不可手动锁定')
    const { data: resvData } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, frontDesk)
    const myResv = resvData.data.find((r: any) => r.borrower_name === '权限预约人')
    if (myResv) {
      const lockRes = await request('PUT', `/reservations/${myResv.id}/lock`, undefined, frontDesk)
      assert(lockRes.status === 403, '前台不可手动锁定')
    }

    console.log('  → 管理员可手动锁定')
    if (myResv) {
      const lockRes = await request('PUT', `/reservations/${myResv.id}/lock`, undefined, admin)
      assert(lockRes.status === 200, '管理员可手动锁定')
      assert(lockRes.data?.data?.status === 'locked', '锁定后状态为 locked')
      assert(!!lockRes.data?.data?.lock_expires_at, '锁定后超时时间已设置')
    }

    console.log('  → 前台不可释放锁定')
    const { data: resvData2 } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
    const lockedResv = resvData2.data.find((r: any) => r.status === 'locked')
    if (lockedResv) {
      const releaseRes = await request('PUT', `/reservations/${lockedResv.id}/release-lock`, {
        expected_version: lockedResv.version,
      }, frontDesk)
      assert(releaseRes.status === 403, '前台不可释放锁定')
    }

    console.log('  → 管理员可释放锁定')
    if (lockedResv) {
      const releaseRes = await request('PUT', `/reservations/${lockedResv.id}/release-lock`, {
        expected_version: lockedResv.version,
      }, admin)
      assert(releaseRes.status === 200, '管理员可释放锁定')
    }

    console.log('  → 前台不可导出 CSV')
    const exportRes = await fetch(`${BASE}/export/equipments`, {
      headers: { Authorization: `Bearer ${frontDesk}` },
    })
    assert(exportRes.status === 403, '前台不可导出设备 CSV')

    console.log('  → 前台不可重排预约顺序')
    const { data: allResv } = await request('GET', '/reservations', undefined, admin)
    if (allResv.data.length > 0) {
      const firstResv = allResv.data[0]
      const reorderRes = await request('PUT', '/reservations/reorder', {
        equipment_id: firstResv.equipment_id,
        orders: [{ id: firstResv.id, queue_order: 0 }],
      }, frontDesk)
      assert(reorderRes.status === 403, '前台重排预约返回 403')
    }
  } finally {
    await resetEquipment(admin, equipId)
  }
}

async function testManualLockAndExpiredStatus() {
  console.log('\n📋 测试组 9：手动锁定与超时状态校验')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '手动锁定测试设备')

  try {
    await borrowEquipment(admin, equipId, '手动借用人', '13800000080')
    await createReservation(admin, equipId, '手动预约1', '13800000081')
    await createReservation(admin, equipId, '手动预约2', '13800000082')

    const { data: resvData } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
    const firstResv = resvData.data.find((r: any) => r.status === 'queued' && r.queue_order === 0)

    console.log('  → 管理员手动锁定排队中的预约')
    const lockRes = await request('PUT', `/reservations/${firstResv.id}/lock`, undefined, admin)
    assert(lockRes.status === 200, '手动锁定成功')
    assert(lockRes.data?.data?.status === 'locked', '锁定后状态为 locked')

    const equipDetail = await getEquipmentDetail(admin, equipId)
    assert(equipDetail.equipment.status === 'reserved', '手动锁定后设备为 reserved')
    assert(equipDetail.equipment.locked_reservation_id === firstResv.id, '设备锁定ID指向手动锁定的预约')

    console.log('  → 已锁定设备不能再锁定其他预约')
    const secondResv = resvData.data.find((r: any) => r.status === 'queued' && r.queue_order === 1)
    if (secondResv) {
      const secondLockRes = await request('PUT', `/reservations/${secondResv.id}/lock`, undefined, admin)
      assert(secondLockRes.status === 409, '重复锁定返回 409')
      assert(secondLockRes.data.conflict?.type === 'equipment_already_locked', '冲突类型为 equipment_already_locked')
    }

    console.log('  → 释放锁定后自动锁定下一位')
    const { data: refreshedResvData } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
    const lockedResv = refreshedResvData.data.find((r: any) => r.status === 'locked')
    if (lockedResv) {
      const { data: refreshedAll } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
      const refreshed = refreshedAll.data.find((r: any) => r.id === lockedResv.id)
      if (!refreshed) { assert(false, '找不到锁定的预约'); return }
      const releaseRes = await request('PUT', `/reservations/${lockedResv.id}/release-lock`, {
        expected_version: refreshed.version,
      }, admin)
      assert(releaseRes.status === 200, '释放锁定成功')
      assert(releaseRes.data?.data?.status === 'cancelled', '释放后预约状态为 cancelled')

      const { data: afterRelease } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
      const newLocked = afterRelease.data.find((r: any) => r.status === 'locked')
      assert(!!newLocked, '释放后自动锁定下一位')
    }

    console.log('  → 操作日志包含关键动作')
    const logs = (await getEquipmentDetail(admin, equipId)).operation_logs
    const hasManualLockLog = logs.some((l: any) => l.action === 'reservation_manual_lock')
    const hasReleaseLockLog = logs.some((l: any) => l.action === 'reservation_release_lock')
    assert(hasManualLockLog, '操作日志包含手动锁定记录')
    assert(hasReleaseLockLog, '操作日志包含释放锁定记录')
  } finally {
    await resetEquipment(admin, equipId)
  }
}

async function testNoDirtyRecordsAfterCompletion() {
  console.log('\n📋 测试组 10：完成取件后无脏记录校验')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '脏记录测试设备')

  try {
    await borrowEquipment(admin, equipId, '脏记录借用人', '13800000090')
    await createReservation(admin, equipId, '脏记录预约1', '13800000091')
    await createReservation(admin, equipId, '脏记录预约2', '13800000092')

    const { data: borrowData } = await request('GET', '/borrows?status=borrowed', undefined, admin)
    const record = borrowData.data.find((r: any) => r.equipment_id === equipId)
    await returnEquipment(admin, record.id)

    const { data: lockedResvRaw } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
    const lockedResv = lockedResvRaw.data.find((r: any) => r.status === 'locked')

    console.log('  → 锁定预约人取件后，预约状态、设备状态、排队全部更新')
    await request('POST', '/borrows', {
      equipment_id: equipId,
      borrower_name: lockedResv.borrower_name,
      borrower_phone: lockedResv.borrower_phone,
    }, admin)

    const equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'borrowed', '取件后设备为 borrowed')

    const { data: resvData } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
    const activeRecords = resvData.data.filter((r: any) => r.status === 'queued' || r.status === 'notified' || r.status === 'locked')
    const completedRecords = resvData.data.filter((r: any) => r.status === 'completed')
    assert(activeRecords.length === 1, '取件后只有1条活跃预约（排队中的预约2）')
    assert(completedRecords.length === 1, '取件后有1条已完成预约')
    assert(activeRecords[0].borrower_name === '脏记录预约2', '活跃的是预约2')

    console.log('  → 归还再取件，所有预约都应为已完成')
    const { data: borrowData2 } = await request('GET', '/borrows?status=borrowed', undefined, admin)
    const record2 = borrowData2.data.find((r: any) => r.equipment_id === equipId)
    await returnEquipment(admin, record2.id)

    const { data: lockedResv2Raw } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
    const lockedResv2 = lockedResv2Raw.data.find((r: any) => r.status === 'locked')

    await request('POST', '/borrows', {
      equipment_id: equipId,
      borrower_name: lockedResv2.borrower_name,
      borrower_phone: lockedResv2.borrower_phone,
    }, admin)

    const { data: finalResvData } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
    const dirtyRecords = finalResvData.data.filter((r: any) => r.status === 'queued' || r.status === 'notified' || r.status === 'locked')
    assert(dirtyRecords.length === 0, '所有预约完成后无脏记录')
    const allCompleted = finalResvData.data.filter((r: any) => r.status === 'completed')
    assert(allCompleted.length === 2, '两条预约都已完成')

    const finalEquipStatus = await getEquipmentStatus(admin, equipId)
    assert(finalEquipStatus === 'borrowed', '所有预约取件后设备为 borrowed（被最后一人借出）')
  } finally {
    await resetEquipment(admin, equipId)
  }
}

async function main() {
  console.log('🚀 预约取件锁定台回归测试开始\n')
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

  await testLockActivationOnReturn()
  await testUnauthorizedIntercept()
  await testCancelReleasesLockAndAutoLocksNext()
  await testCrossRestartRecovery()
  await testConcurrentConflict()
  await testExportConsistency()
  await testEndToEndFlow()
  await testRoleBoundaries()
  await testManualLockAndExpiredStatus()
  await testNoDirtyRecordsAfterCompletion()

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
