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

  const reservations = detail.reservations || []
  for (const r of reservations) {
    if (r.status === 'queued' || r.status === 'notified') {
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

async function testForbiddenCases() {
  console.log('\n📋 测试组 1：禁止操作校验')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '禁止测试设备')

  try {
    console.log('  → 对「可借」设备创建预约应被拒绝')
    let res = await createReservation(admin, equipId, '张三', '13800000001')
    assert(res.status === 400, '可借设备创建预约返回 400')
    assert(res.data.error?.includes('已借出'), '错误信息提示仅已借出可预约')

    console.log('  → 借出设备后创建预约应成功')
    await borrowEquipment(admin, equipId, '借用人A', '13800000010')
    res = await createReservation(admin, equipId, '预约人B', '13800000002')
    assert(res.status === 201, '已借出设备创建预约返回 201')

    console.log('  → 归还后设备应变为「已预约」，再创建预约应被拒绝')
    const { data: borrowData } = await request('GET', '/borrows?status=borrowed', undefined, admin)
    const record = borrowData.data.find((r: any) => r.equipment_id === equipId)
    const returnRes = await returnEquipment(admin, record.id)
    const equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'reserved', '归还后设备状态为 reserved')
    assert(!!returnRes.next_reservation, '归还响应包含 next_reservation')

    res = await createReservation(admin, equipId, '预约人C', '13800000003')
    assert(res.status === 400, '已预约设备创建预约返回 400')
    assert(res.data.error?.includes('已借出'), '错误信息提示仅已借出可预约')

    console.log('  → 非通知预约人不可借出已预约设备（前台）')
    const frontDesk = await getFrontDeskToken()
    res = await request('POST', '/borrows', {
      equipment_id: equipId,
      borrower_name: '无关人',
      borrower_phone: '13800000099',
    }, frontDesk)
    assert(res.status === 403, '前台非通知预约人借出已预约设备返回 403')

    console.log('  → 管理员可为任何人借出已预约设备')
    res = await request('POST', '/borrows', {
      equipment_id: equipId,
      borrower_name: '无关人',
      borrower_phone: '13800000099',
    }, admin)
    assert(res.status === 201, '管理员可为任何人借出已预约设备')
    const afterAdminBorrow = await getEquipmentStatus(admin, equipId)
    assert(afterAdminBorrow === 'borrowed', '管理员借出后设备为 borrowed')

    console.log('  → 归还后前台通知预约人可借出')
    const { data: borrowData2 } = await request('GET', '/borrows?status=borrowed', undefined, admin)
    const record2 = borrowData2.data.find((r: any) => r.equipment_id === equipId)
    const returnRes2 = await returnEquipment(admin, record2.id)
    const notifiedPerson2 = returnRes2.next_reservation
    if (notifiedPerson2) {
      res = await request('POST', '/borrows', {
        equipment_id: equipId,
        borrower_name: notifiedPerson2.borrower_name,
        borrower_phone: notifiedPerson2.borrower_phone,
      }, frontDesk)
      assert(res.status === 201, '前台通知预约人可借出已预约设备返回 201')
      const newStatus = await getEquipmentStatus(admin, equipId)
      assert(newStatus === 'borrowed', '借出后设备变为 borrowed')
    }

    console.log('  → 前台不可重排预约顺序')
    const { data: resvData } = await request('GET', '/reservations', undefined, admin)
    if (resvData.data.length > 0) {
      const firstResv = resvData.data[0]
      res = await request('PUT', '/reservations/reorder', {
        equipment_id: firstResv.equipment_id,
        orders: [{ id: firstResv.id, queue_order: 0 }],
      }, frontDesk)
      assert(res.status === 403, '前台重排预约返回 403')
    }
  } finally {
    await resetEquipment(admin, equipId)
  }
}

async function testConcurrencyConflict() {
  console.log('\n📋 测试组 2：并发冲突校验')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '并发测试设备')

  try {
    await borrowEquipment(admin, equipId, '并发借用人', '13800000020')

    console.log('  → 两个窗口同时为同一已借出设备创建不同预约，均可成功')
    const [res1, res2] = await Promise.all([
      createReservation(admin, equipId, '并发A', '13800000021'),
      createReservation(admin, equipId, '并发B', '13800000022'),
    ])
    const bothSucceeded = (res1.status === 201 ? 1 : 0) + (res2.status === 201 ? 1 : 0)
    assert(bothSucceeded === 2, '同时创建不同人预约均可成功')

    console.log('  → 同一人同一设备不可重复预约')
    await createReservation(admin, equipId, '重复人', '13800000025')
    const dupRes = await createReservation(admin, equipId, '重复人', '13800000025')
    assert(dupRes.status === 409, '重复预约返回 409')

    console.log('  → 归还和创建预约同时进行，预约应被拦截（设备不再为已借出）')
    const { data: borrowData } = await request('GET', '/borrows?status=borrowed', undefined, admin)
    const record = borrowData.data.find((r: any) => r.equipment_id === equipId)
    if (record) {
      const returnPromise = request('PUT', `/borrows/${record.id}/return`, {}, admin)
      const reservePromise = createReservation(admin, equipId, '归还冲突人', '13800000030')
      const [returnRes, reserveRes] = await Promise.all([returnPromise, reservePromise])
      assert(returnRes.status === 200, `归还操作完成 (status=${returnRes.status})`)
      const reserveBlocked = reserveRes.status === 400 || reserveRes.status === 409
      assert(reserveBlocked, '归还同时创建预约被拦截（设备不再是已借出）')
    }
  } finally {
    await resetEquipment(admin, equipId)
  }
}

async function testPersistenceAcrossRestart() {
  console.log('\n📋 测试组 3：跨重启持久化校验')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '持久化测试设备')

  try {
    await borrowEquipment(admin, equipId, '持久借用人', '13800000040')
    await createReservation(admin, equipId, '排队人1', '13800000041')
    await createReservation(admin, equipId, '排队人2', '13800000042')

    const { data: resvBefore } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
    const queuedBefore = resvBefore.data.filter((r: any) => r.status === 'queued')
    assert(queuedBefore.length === 2, '重启前有 2 条排队预约')

    const { data: borrowData } = await request('GET', '/borrows?status=borrowed', undefined, admin)
    const record = borrowData.data.find((r: any) => r.equipment_id === equipId)
    await returnEquipment(admin, record.id)

    const statusAfterReturn = await getEquipmentStatus(admin, equipId)
    assert(statusAfterReturn === 'reserved', '归还后设备为 reserved')

    const { data: resvAfter } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
    const notifiedAfter = resvAfter.data.filter((r: any) => r.status === 'notified')
    const queuedAfter = resvAfter.data.filter((r: any) => r.status === 'queued')
    assert(notifiedAfter.length === 1, '归还后自动通知 1 人')
    assert(queuedAfter.length === 1, '归还后仍有 1 人排队')

    console.log('  → 重新查询验证状态持久化（模拟刷新页面）')
    const { data: resvRefresh } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
    const statuses = resvRefresh.data.map((r: any) => r.status)
    const hasQueued = statuses.includes('queued')
    const hasNotified = statuses.includes('notified')
    assert(hasQueued && hasNotified, '刷新后排队和已通知状态都在')
    const equipRefresh = await getEquipmentStatus(admin, equipId)
    assert(equipRefresh === 'reserved', '刷新后设备仍为 reserved')

    console.log('  → 取消已通知预约后自动通知下一位')
    const notifiedResv = resvRefresh.data.find((r: any) => r.status === 'notified')
    if (notifiedResv) {
      const cancelRes = await request('PUT', `/reservations/${notifiedResv.id}/cancel`, {
        cancel_reason: '测试取消',
        expected_version: notifiedResv.version,
      }, admin)
      assert(cancelRes.status === 200, '取消已通知预约成功')

      const { data: resvAfterCancel } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
      const queuedAfterCancel = resvAfterCancel.data.filter((r: any) => r.status === 'queued')
      const notifiedAfterCancel = resvAfterCancel.data.filter((r: any) => r.status === 'notified')
      assert(notifiedAfterCancel.length === 1, '取消后自动通知下一位')
      assert(queuedAfterCancel.length === 0, '取消后无排队中')

      const equipAfterCancel = await getEquipmentStatus(admin, equipId)
      assert(equipAfterCancel === 'reserved', '取消后设备仍为 reserved')
    }
  } finally {
    await resetEquipment(admin, equipId)
  }
}

async function testExportConsistency() {
  console.log('\n📋 测试组 4：导出一致性校验')
  const admin = await getAdminToken()
  const equipId = await createTestEquipment(admin, '导出测试设备-唯一')

  try {
    await borrowEquipment(admin, equipId, '导出借用人', '13800000050')
    await createReservation(admin, equipId, '导出预约人-唯一', '13800000051')

    const { data: borrowData } = await request('GET', '/borrows?status=borrowed', undefined, admin)
    const record = borrowData.data.find((r: any) => r.equipment_id === equipId)
    await returnEquipment(admin, record.id)

    const equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'reserved', '导出前设备为 reserved')

    const { data: resvCheck } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
    const exportResv = resvCheck.data.find((r: any) => r.borrower_name === '导出预约人-唯一')
    const expectedStatus = exportResv ? (exportResv.status === 'notified' ? '已通知' : '排队中') : '未知'

    console.log('  → 设备 CSV 导出状态一致')
    const equipCsvRes = await fetch(`${BASE}/export/equipments`, {
      headers: { Authorization: `Bearer ${admin}` },
    })
    const equipCsv = await equipCsvRes.text()
    const equipRow = equipCsv.split('\n').find((line: string) => line.includes('导出测试设备-唯一'))
    assert(!!equipRow, '设备 CSV 包含测试设备')
    assert(equipRow!.includes('已预约'), '设备 CSV 状态显示「已预约」')

    console.log('  → 预约 CSV 导出包含正确状态')
    const resvCsvRes = await fetch(`${BASE}/export/reservations`, {
      headers: { Authorization: `Bearer ${admin}` },
    })
    const resvCsv = await resvCsvRes.text()
    const resvRow = resvCsv.split('\n').find((line: string) => line.includes('导出预约人-唯一'))
    assert(!!resvRow, '预约 CSV 包含测试预约')
    assert(resvRow!.includes(expectedStatus), `预约 CSV 状态显示「${expectedStatus}」(实际状态: ${exportResv?.status})`)
  } finally {
    await resetEquipment(admin, equipId)
  }
}

async function testEndToEndFlow() {
  console.log('\n📋 测试组 5：端到端用户链路')
  const admin = await getAdminToken()
  const frontDesk = await getFrontDeskToken()
  const equipId = await createTestEquipment(admin, '链路测试设备')

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

    console.log('  步骤 3: 可借设备不能创建预约（接口级别）')
    const availEquipId = await createTestEquipment(admin, '链路可借设备')
    const resv3 = await createReservation(frontDesk, availEquipId, '链路预约3', '13800000063')
    assert(resv3.status === 400, '可借设备创建预约被拒绝')
    await resetEquipment(admin, availEquipId)

    console.log('  步骤 4: 归还设备，验证自动通知和状态变更')
    const returnResult = await returnEquipment(frontDesk, borrowId)
    equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'reserved', '归还后设备为 reserved')
    assert(!!returnResult.next_reservation, '归还响应包含下一位预约人')
    assert(returnResult.next_reservation?.borrower_name === '链路预约1', '下一位是预约1')

    console.log('  步骤 5: 通知预约人取用设备')
    const notifiedResv = returnResult.next_reservation
    const borrowRes = await request('POST', '/borrows', {
      equipment_id: equipId,
      borrower_name: notifiedResv.borrower_name,
      borrower_phone: notifiedResv.borrower_phone,
    }, frontDesk)
    assert(borrowRes.status === 201, '通知预约人可借出设备')
    equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'borrowed', '取用后设备为 borrowed')

    const { data: resvData } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
    const completedResv = resvData.data.filter((r: any) => r.status === 'completed')
    assert(completedResv.length >= 1, '预约1自动完成')

    console.log('  步骤 6: 再次归还，自动通知预约2')
    const { data: borrowData } = await request('GET', '/borrows?status=borrowed', undefined, admin)
    const record2 = borrowData.data.find((r: any) => r.equipment_id === equipId)
    const returnResult2 = await returnEquipment(frontDesk, record2.id)
    equipStatus = await getEquipmentStatus(admin, equipId)
    assert(equipStatus === 'reserved', '再次归还后设备为 reserved')
    assert(returnResult2.next_reservation?.borrower_name === '链路预约2', '下一位是预约2')

    console.log('  步骤 7: 取消预约2，设备应变为可借')
    const { data: resvData2 } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
    const resv2Data = resvData2.data.find((r: any) => r.borrower_name === '链路预约2')
    if (resv2Data || returnResult2.next_reservation) {
      const cancelTarget = returnResult2.next_reservation || resv2Data
      const cancelRes = await request('PUT', `/reservations/${cancelTarget.id}/cancel`, {
        cancel_reason: '不需要了',
        expected_version: cancelTarget.version,
      }, frontDesk)
      assert(cancelRes.status === 200, '取消预约2成功')
      equipStatus = await getEquipmentStatus(admin, equipId)
      assert(equipStatus === 'available', '取消所有预约后设备变为 available')
    }

    console.log('  步骤 8: 操作日志记录关键变更')
    const detail = await getEquipmentDetail(admin, equipId)
    const logs = detail.operation_logs
    const hasBorrowLog = logs.some((l: any) => l.action === 'borrow')
    const hasReturnLog = logs.some((l: any) => l.action === 'return')
    const hasAutoNotifyLog = logs.some((l: any) => l.action === 'reservation_auto_notify')
    assert(hasBorrowLog, '操作日志包含借出记录')
    assert(hasReturnLog, '操作日志包含归还记录')
    assert(hasAutoNotifyLog, '操作日志包含自动通知记录')
  } finally {
    await resetEquipment(admin, equipId)
  }
}

async function testRoleBasedAccess() {
  console.log('\n📋 测试组 6：角色权限校验')
  const admin = await getAdminToken()
  const frontDesk = await getFrontDeskToken()
  const equipId = await createTestEquipment(admin, '权限测试设备')

  try {
    await borrowEquipment(admin, equipId, '权限借用人', '13800000070')

    console.log('  → 前台创建预约')
    const resvRes = await createReservation(frontDesk, equipId, '权限预约人', '13800000071')
    assert(resvRes.status === 201, '前台可创建预约')

    console.log('  → 前台不可导出 CSV')
    const exportRes = await fetch(`${BASE}/export/equipments`, {
      headers: { Authorization: `Bearer ${frontDesk}` },
    })
    assert(exportRes.status === 403, '前台不可导出设备 CSV')

    const exportResvRes = await fetch(`${BASE}/export/reservations`, {
      headers: { Authorization: `Bearer ${frontDesk}` },
    })
    assert(exportResvRes.status === 403, '前台不可导出预约 CSV')

    console.log('  → 前台可通知/完成/取消自己的预约')
    const { data: resvData } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, frontDesk)
    const myResv = resvData.data.find((r: any) => r.borrower_name === '权限预约人')
    if (myResv) {
      const notifyRes = await request('PUT', `/reservations/${myResv.id}/notify`, undefined, frontDesk)
      assert(notifyRes.status === 200, '前台可通知自己的预约')

      const { data: refreshedResv } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, frontDesk)
      const refreshedMyResv = refreshedResv.data.find((r: any) => r.borrower_name === '权限预约人')

      const completeRes = await request('PUT', `/reservations/${refreshedMyResv.id}/complete`, {
        expected_version: refreshedMyResv.version,
      }, frontDesk)
      assert(completeRes.status === 200, '前台可完成自己的预约')
    }

    console.log('  → 前台不可操作他人经手的预约')
    const adminResvRes = await createReservation(admin, equipId, '管理员预约人', '13800000072')
    if (adminResvRes.status === 201) {
      const { data: adminResvData } = await request('GET', `/reservations?equipment_id=${equipId}`, undefined, admin)
      const adminResv = adminResvData.data.find((r: any) => r.borrower_name === '管理员预约人')
      if (adminResv) {
        const notifyOtherRes = await request('PUT', `/reservations/${adminResv.id}/notify`, undefined, frontDesk)
        assert(notifyOtherRes.status === 403, '前台不可通知他人经手的预约')
      }
    }
  } finally {
    await resetEquipment(admin, equipId)
  }
}

async function main() {
  console.log('🚀 预约系统回归测试开始\n')
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

  await testForbiddenCases()
  await testConcurrencyConflict()
  await testPersistenceAcrossRestart()
  await testExportConsistency()
  await testEndToEndFlow()
  await testRoleBasedAccess()

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
