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

function fixedRequestUnpack(body) {
  if (body.success !== undefined && body.data !== undefined) {
    const knownKeys = new Set(['success', 'data', 'error', 'total', 'page', 'page_size']);
    const hasExtraFields = Object.keys(body).some((k) => !knownKeys.has(k));
    if (hasExtraFields || body.total !== undefined) {
      return body;
    }
    return body.data;
  }
  if (body.success !== undefined) {
    return undefined;
  }
  return body;
}

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.log(`  ✗ ${msg}`); }
}

async function main() {
  console.log('=== 验证修复后的 request() 解包逻辑 ===\n');

  const login = await req('/auth/login', 'POST', { username: 'admin', password: 'admin123' });
  const token = login.data.token;

  // 1. 创建方案
  const create = await req('/views', 'POST', {
    page: 'equipments',
    name: `解包测试-${Date.now()}`,
    filters: { status: 'available' },
    sort_by: 'name',
    sort_order: 'asc',
    page_size: 10,
  }, token);
  const viewId = create.data.data.id;
  console.log('1. createView 返回解包：');
  const createUnpacked = fixedRequestUnpack(create.data);
  assert(typeof createUnpacked.id === 'number', 'createView 返回 SavedView，有 id 字段');
  assert(typeof createUnpacked.version === 'number', 'createView 返回 SavedView，有 version 字段');
  assert(createUnpacked.snapshot_created === undefined, 'createView 没有 snapshot_created 字段');

  // 2. 更新方案（带 snapshot_created 额外字段）
  const update = await req(`/views/${viewId}`, 'PUT', {
    filters: { status: 'borrowed' },
    expected_version: 1,
    snapshot_remark: '测试更新',
  }, token);
  console.log('\n2. updateView 返回解包：');
  const updateUnpacked = fixedRequestUnpack(update.data);
  assert(updateUnpacked.data !== undefined, 'updateView 返回完整 body，有 data 字段');
  assert(typeof updateUnpacked.data.version === 'number', 'updateView.data.version 正确');
  assert(typeof updateUnpacked.snapshot_created === 'number', 'updateView.snapshot_created 保留');
  assert(updateUnpacked.data.version === 2, '版本号从 1 升到 2');
  const snapId = updateUnpacked.snapshot_created;

  // 3. 手动创建快照
  const snap = await req(`/views/${viewId}/snapshot`, 'POST', { remark: '手动快照' }, token);
  console.log('\n3. createViewSnapshot 返回解包：');
  const snapUnpacked = fixedRequestUnpack(snap.data);
  assert(typeof snapUnpacked.id === 'number', 'createViewSnapshot 返回 ViewSnapshot，有 id');
  assert(typeof snapUnpacked.version === 'number', 'createViewSnapshot 返回 ViewSnapshot，有 version');
  assert(snapUnpacked.remark === '手动快照', 'createViewSnapshot 备注正确');

  // 4. 回滚（带 rollback_from_snapshot 额外字段）
  const rollback = await req(`/views/${viewId}/rollback/${snapId}`, 'POST', null, token);
  console.log('\n4. rollbackView 返回解包：');
  const rollbackUnpacked = fixedRequestUnpack(rollback.data);
  assert(rollbackUnpacked.data !== undefined, 'rollbackView 返回完整 body，有 data 字段');
  assert(typeof rollbackUnpacked.data.version === 'number', 'rollbackView.data.version 正确');
  assert(typeof rollbackUnpacked.rollback_from_snapshot === 'number', 'rollback_from_snapshot 保留');
  assert(rollbackUnpacked.data.version === 3, '回滚后版本号升到 3');
  assert(rollbackUnpacked.data.filters.status === 'available', '回滚后 filters.status 恢复为 available');
  assert(rollbackUnpacked.data.is_owner === true, '回滚后 is_owner 正确恢复');

  // 5. 冲突检测
  const conflict = await req(`/views/${viewId}`, 'PUT', {
    filters: { status: 'damaged' },
    expected_version: 1,
  }, token);
  console.log('\n5. 冲突检测错误处理：');
  assert(conflict.status === 409, '返回 409 状态码');
  assert(conflict.data.conflict !== undefined, '响应体包含 conflict 字段');
  assert(conflict.data.conflict.current_version === 3, 'conflict.current_version 正确');
  assert(conflict.data.conflict.latest_operator !== undefined, 'conflict.latest_operator 存在');

  // 6. 分页接口（带 total 额外字段）
  const list = await req('/equipments?page=1&page_size=10', 'GET', null, token);
  console.log('\n6. 分页接口解包：');
  const listUnpacked = fixedRequestUnpack(list.data);
  assert(listUnpacked.total !== undefined, '分页接口返回完整 body，有 total');
  assert(Array.isArray(listUnpacked.data), '分页接口 data 是数组');

  // 7. 快照列表接口
  const snaps = await req(`/views/${viewId}/snapshots`, 'GET', null, token);
  console.log('\n7. getViewSnapshots 返回解包：');
  const snapsUnpacked = fixedRequestUnpack(snaps.data);
  assert(Array.isArray(snapsUnpacked), 'getViewSnapshots 返回数组');
  assert(snapsUnpacked.length >= 2, '至少有 2 条快照（自动+手动）');

  // 8. 验证前端崩溃点已修复
  console.log('\n8. 前端崩溃点验证（原 bug 重现）：');
  const oldUnpack = (body) => {
    if (body.success !== undefined && body.data !== undefined) {
      if (body.total !== undefined) return body;
      return body.data;
    }
    return body;
  };
  const oldUpdateUnpacked = oldUnpack(update.data);
  let oldCrash = false;
  try {
    const _v = oldUpdateUnpacked.data.version;
  } catch (e) {
    oldCrash = true;
  }
  assert(oldCrash === true, '旧解包逻辑会崩溃：oldUpdateUnpacked.data.version 报错');

  const newUpdateUnpacked = fixedRequestUnpack(update.data);
  let newCrash = false;
  try {
    const _v = newUpdateUnpacked.data.version;
  } catch (e) {
    newCrash = true;
  }
  assert(newCrash === false, '新解包逻辑不崩溃：newUpdateUnpacked.data.version = ' + newUpdateUnpacked.data.version);
  assert(newUpdateUnpacked.data.version === 2, '新解包后 version = 2');
  assert(newUpdateUnpacked.snapshot_created === snapId, '新解包后 snapshot_created 保留');

  // 清理
  await req(`/views/${viewId}`, 'DELETE', null, token);
  console.log('\n✓ 清理完成');

  console.log(`\n=== 解包逻辑验证：通过 ${pass}，失败 ${fail} ===`);
  if (fail > 0) process.exit(1);
}

main().catch(console.error);
