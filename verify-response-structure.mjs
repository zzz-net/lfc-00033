import fetch from 'node-fetch';

const BASE = 'http://localhost:3002/api';

async function req(path, method = 'GET', body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });
  const data = await res.json();
  return { status: res.status, data, ok: res.ok };
}

async function main() {
  // 1. 登录
  const login = await req('/auth/login', 'POST', { username: 'admin', password: 'admin123' });
  const token = login.data.token;
  console.log('✓ 登录成功');

  // 2. 创建方案
  const create = await req('/views', 'POST', {
    page: 'equipments',
    name: `结构测试-${Date.now()}`,
    filters: { status: 'available' },
    sort_by: 'name',
    sort_order: 'asc',
    page_size: 10,
  }, token);
  console.log('\n=== CREATE 响应结构 ===');
  console.log('顶级字段:', Object.keys(create.data));
  console.log('data 字段:', create.data.data ? Object.keys(create.data.data) : '无 data 字段');
  console.log('完整响应:', JSON.stringify(create.data, null, 2));
  const viewId = create.data.data.id;

  // 3. 更新方案
  const update = await req(`/views/${viewId}`, 'PUT', {
    filters: { status: 'borrowed' },
    expected_version: 1,
    snapshot_remark: '测试更新',
  }, token);
  console.log('\n=== UPDATE 响应结构 ===');
  console.log('顶级字段:', Object.keys(update.data));
  console.log('data 字段:', update.data.data ? Object.keys(update.data.data) : '无 data 字段');
  console.log('snapshot_created 字段:', update.data.snapshot_created);
  console.log('完整响应:', JSON.stringify(update.data, null, 2));
  const snapId = update.data.snapshot_created;

  // 4. 回滚方案
  const rollback = await req(`/views/${viewId}/rollback/${snapId}`, 'POST', null, token);
  console.log('\n=== ROLLBACK 响应结构 ===');
  console.log('顶级字段:', Object.keys(rollback.data));
  console.log('data 字段:', rollback.data.data ? Object.keys(rollback.data.data) : '无 data 字段');
  console.log('rollback_from_snapshot 字段:', rollback.data.rollback_from_snapshot);
  console.log('完整响应:', JSON.stringify(rollback.data, null, 2));

  // 5. 冲突检测
  const conflict = await req(`/views/${viewId}`, 'PUT', {
    filters: { status: 'damaged' },
    expected_version: 1, // 故意用旧版本
  }, token);
  console.log('\n=== CONFLICT 响应结构 ===');
  console.log('status:', conflict.status);
  console.log('顶级字段:', Object.keys(conflict.data));
  console.log('conflict 字段:', conflict.data.conflict ? Object.keys(conflict.data.conflict) : '无 conflict 字段');
  console.log('完整响应:', JSON.stringify(conflict.data, null, 2));

  // 清理
  await req(`/views/${viewId}`, 'DELETE', null, token);
  console.log('\n✓ 清理完成');

  // 6. 演示前端 request() 函数解包后会发生什么
  console.log('\n=== 前端 request() 解包模拟 ===');
  const simulateRequestUnpack = (body) => {
    if (body.success !== undefined && body.data !== undefined) {
      if (body.total !== undefined) {
        return body;
      }
      return body.data; // ⚠️ 这里只返回 data，丢掉了 snapshot_created/rollback_from_snapshot
    }
    return body;
  };

  const unpackedUpdate = simulateRequestUnpack(update.data);
  console.log('UPDATE 解包后类型:', typeof unpackedUpdate, 'keys:', Object.keys(unpackedUpdate));
  console.log('解包后 .data.version:', unpackedUpdate.data?.version); // ⚠️ undefined!
  console.log('解包后 .version:', unpackedUpdate.version); // 这个是对的
  console.log('解包后 .snapshot_created:', unpackedUpdate.snapshot_created); // ⚠️ undefined! 丢了

  const unpackedRollback = simulateRequestUnpack(rollback.data);
  console.log('\nROLLBACK 解包后 .data.version:', unpackedRollback.data?.version); // ⚠️ undefined!
  console.log('ROLLBACK 解包后 .rollback_from_snapshot:', unpackedRollback.rollback_from_snapshot); // ⚠️ undefined!
}

main().catch(console.error);
