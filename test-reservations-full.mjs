import http from "node:http";

const BaseUrl = "http://localhost:3001";

function req(path, method = "GET", body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(BaseUrl + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (token) options.headers["Authorization"] = "Bearer " + token;
    const reqObj = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) reject({ status: res.statusCode, body: parsed });
          else resolve(parsed);
        } catch (e) { resolve(data); }
      });
    });
    reqObj.on("error", reject);
    if (body) reqObj.write(JSON.stringify(body));
    reqObj.end();
  });
}

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log("  ✓", msg); }
  else { failed++; console.log("  ✗", msg); }
}

async function test(name, fn) {
  console.log("\n" + name);
  try { await fn(); }
  catch (e) { failed++; console.log("  ✗ 异常:", e.message || e.body?.error || e); }
}

async function main() {
  console.log("=== 预约排队完整链路测试 ===");

  const adminRes = await req("/api/auth/login", "POST", { username: "admin", password: "admin123" });
  const adminToken = adminRes.data.token;
  const frontRes = await req("/api/auth/login", "POST", { username: "front_desk", password: "front123" });
  const frontToken = frontRes.data.token;

  // ============= 测试 1: 借还联动 - 归还自动通知下一位 =============
  await test("A1. 借还联动：归还设备自动通知下一位预约人", async () => {
    const allEqs = await req("/api/equipments", "GET", null, adminToken);
    const eq = allEqs.data.find(e => e.status === "available");
    assert(eq !== undefined, "找到可用设备");

    // 先借出
    const borrow = await req("/api/borrows", "POST", {
      equipment_id: eq.id,
      borrower_name: "当前借用人",
      borrower_phone: "13100000000",
    }, frontToken);

    // 创建 3 个预约
    const rA = await req("/api/reservations", "POST", {
      equipment_id: eq.id, borrower_name: `预约A-${Date.now()}`, borrower_phone: "13100000001",
    }, frontToken);
    const rB = await req("/api/reservations", "POST", {
      equipment_id: eq.id, borrower_name: `预约B-${Date.now()}`, borrower_phone: "13100000002",
    }, frontToken);
    const rC = await req("/api/reservations", "POST", {
      equipment_id: eq.id, borrower_name: `预约C-${Date.now()}`, borrower_phone: "13100000003",
    }, frontToken);
    assert(rA.data.queue_order === 0 && rB.data.queue_order === 1 && rC.data.queue_order === 2,
      "3 个预约顺位正确: A#1, B#2, C#3");

    // 归还
    const returnRes = await req(`/api/borrows/${borrow.data.id}/return`, "PUT", null, frontToken);
    assert(returnRes.success === true, "归还成功");
    assert(returnRes.next_reservation !== undefined && returnRes.next_reservation !== null,
      "归还响应包含 next_reservation");
    assert(returnRes.next_reservation.id === rA.data.id,
      `自动通知的是预约A（顺位#1）, id=${returnRes.next_reservation?.id}`);
    assert(returnRes.next_reservation.status === "notified",
      "预约A 状态自动变为 notified");

    // 刷新后确认
    const list = await req("/api/reservations", "GET", null, adminToken);
    const a = list.data.find(x => x.id === rA.data.id);
    const b = list.data.find(x => x.id === rB.data.id);
    const c = list.data.find(x => x.id === rC.data.id);
    assert(a.status === "notified", "刷新后确认 A=notified");
    assert(b.status === "queued", "刷新后确认 B=queued");
    assert(c.status === "queued", "刷新后确认 C=queued");

    // 清理
    for (const rid of [rA.data.id, rB.data.id, rC.data.id]) {
      await req(`/api/reservations/${rid}/cancel`, "PUT", {}, adminToken).catch(() => {});
    }
  });

  // ============= 测试 2: 借还联动 - 借出时自动完成对应预约 =============
  await test("A2. 借还联动：预约人实际借出时自动完成对应预约", async () => {
    const allEqs = await req("/api/equipments", "GET", null, adminToken);
    const eq = allEqs.data.find(e => e.status === "available");
    assert(eq !== undefined, "找到可用设备");

    const borrowerName = `自动完成-${Date.now()}`;
    const borrowerPhone = "13200000001";

    // 创建预约
    const r = await req("/api/reservations", "POST", {
      equipment_id: eq.id,
      borrower_name: borrowerName,
      borrower_phone: borrowerPhone,
    }, frontToken);
    assert(r.data.status === "queued", "预约状态 queued");

    // 预约人来借出
    const borrow = await req("/api/borrows", "POST", {
      equipment_id: eq.id,
      borrower_name: borrowerName,
      borrower_phone: borrowerPhone,
    }, frontToken);
    assert(borrow.success === true, "借出成功");

    // 验证预约自动完成
    const list = await req("/api/reservations", "GET", null, adminToken);
    const updated = list.data.find(x => x.id === r.data.id);
    assert(updated.status === "completed",
      `预约人实际借出后，预约状态自动变为 completed（实际=${updated.status}）`);
    assert(updated.completed_at !== null, "completed_at 有值");

    // 清理
    await req(`/api/borrows/${borrow.data.id}/return`, "PUT", null, frontToken).catch(() => {});
  });

  // ============= 测试 3: 管理员调整排队顺序 =============
  await test("A3. 管理员调整排队顺序 + 持久化", async () => {
    const allEqs = await req("/api/equipments", "GET", null, adminToken);
    const eq = allEqs.data[0];

    // 先清理该设备下的有效预约
    const existing = await req(`/api/reservations?equipment_id=${eq.id}`, "GET", null, adminToken);
    for (const r of existing.data.filter(x => x.status === "queued" || x.status === "notified")) {
      await req(`/api/reservations/${r.id}/cancel`, "PUT", {}, adminToken).catch(() => {});
    }

    // 创建 3 个新的
    const r1 = await req("/api/reservations", "POST", {
      equipment_id: eq.id, borrower_name: `顺序1-${Date.now()}`, borrower_phone: "13300000001",
    }, adminToken);
    const r2 = await req("/api/reservations", "POST", {
      equipment_id: eq.id, borrower_name: `顺序2-${Date.now()}`, borrower_phone: "13300000002",
    }, adminToken);
    const r3 = await req("/api/reservations", "POST", {
      equipment_id: eq.id, borrower_name: `顺序3-${Date.now()}`, borrower_phone: "13300000003",
    }, adminToken);
    assert(r1.data.queue_order === 0 && r2.data.queue_order === 1 && r3.data.queue_order === 2,
      "初始顺序: r1#1, r2#2, r3#3");

    // 调整: r3 → #1, r1 → #2, r2 → #3
    const reorder = await req("/api/reservations/reorder", "PUT", {
      equipment_id: eq.id,
      orders: [
        { id: r3.data.id, queue_order: 0 },
        { id: r1.data.id, queue_order: 1 },
        { id: r2.data.id, queue_order: 2 },
      ],
    }, adminToken);
    assert(reorder.success === true, "调整顺序成功");
    const sorted = reorder.data.sort((a, b) => a.queue_order - b.queue_order);
    assert(sorted[0].id === r3.data.id, "调整后 #1 = r3");
    assert(sorted[1].id === r1.data.id, "调整后 #2 = r1");
    assert(sorted[2].id === r2.data.id, "调整后 #3 = r2");

    // 刷新后确认
    const listAfter = await req(`/api/reservations?equipment_id=${eq.id}`, "GET", null, adminToken);
    const active = listAfter.data
      .filter(r => r.status === "queued" || r.status === "notified")
      .sort((a, b) => a.queue_order - b.queue_order);
    assert(active[0].id === r3.data.id, "刷新后 #1 仍然 = r3（持久化）");

    // 清理
    for (const rid of [r1.data.id, r2.data.id, r3.data.id]) {
      await req(`/api/reservations/${rid}/cancel`, "PUT", {}, adminToken).catch(() => {});
    }
  });

  // ============= 测试 4: 导出和列表一致性 =============
  await test("A4. 列表 API 与导出 CSV 数量完全一致", async () => {
    const allList = await req("/api/reservations", "GET", null, adminToken);
    const allCsv = await req("/api/export/reservations", "GET", null, adminToken);
    const allLines = allCsv.trim().split("\n").slice(1).filter(l => l.trim());
    assert(allList.data.length === allLines.length,
      `全量: 列表 ${allList.data.length} = CSV ${allLines.length}`);

    // 按 status=queued 筛选
    const qList = await req("/api/reservations?status=queued", "GET", null, adminToken);
    const qCsv = await req("/api/export/reservations?status=queued", "GET", null, adminToken);
    const qLines = qCsv.trim().split("\n").slice(1).filter(l => l.trim());
    assert(qList.data.length === qLines.length,
      `queued 筛选: 列表 ${qList.data.length} = CSV ${qLines.length}`);

    // 按 status=notified 筛选
    const nList = await req("/api/reservations?status=notified", "GET", null, adminToken);
    const nCsv = await req("/api/export/reservations?status=notified", "GET", null, adminToken);
    const nLines = nCsv.trim().split("\n").slice(1).filter(l => l.trim());
    assert(nList.data.length === nLines.length,
      `notified 筛选: 列表 ${nList.data.length} = CSV ${nLines.length}`);

    // CSV 包含中文列名
    const header = allCsv.trim().split("\n")[0];
    assert(header.includes("设备名称") && header.includes("借用人") && header.includes("排队顺位") && header.includes("状态"),
      "CSV 表头包含必要中文字段");
  });

  // ============= 测试 5: 并发冲突 =============
  await test("A5. 并发冲突：两窗口同时处理同一预约，后提交者看到 409", async () => {
    const allEqs = await req("/api/equipments", "GET", null, adminToken);
    const eq = allEqs.data[0];

    const create = await req("/api/reservations", "POST", {
      equipment_id: eq.id,
      borrower_name: `冲突-${Date.now()}`,
      borrower_phone: "13400000001",
    }, adminToken);
    const rid = create.data.id;
    const v1 = create.data.version;

    // 窗口 B 先取消（版本递增）
    const cancelB = await req(`/api/reservations/${rid}/cancel`, "PUT", {
      cancel_reason: "B取消了",
      expected_version: v1,
    }, adminToken);
    assert(cancelB.data.version === v1 + 1, "B 取消后版本递增");

    // 窗口 A 拿旧版本取消 → 冲突
    let caught = null;
    try {
      await req(`/api/reservations/${rid}/cancel`, "PUT", {
        cancel_reason: "A也来取消",
        expected_version: v1, // 旧版本
      }, adminToken);
    } catch (e) { caught = e; }

    assert(caught !== null && caught.status === 409,
      `A 拿旧版本提交 → HTTP 409（实际=${caught?.status}）`);
    assert(caught.body.conflict !== undefined, "响应包含 conflict 字段");
    assert(caught.body.conflict.submitted_version === v1, "conflict.submitted_version 正确");
    assert(caught.body.conflict.current_version === v1 + 1, "conflict.current_version 正确");
    assert(caught.body.conflict.latest_operator !== undefined, "包含 latest_operator 信息");
    assert(caught.body.error && caught.body.error.includes("已被其他操作更新"),
      `错误提示明确：${caught.body.error}`);
  });

  // ============= 测试 6: 跨刷新/重启持久化 =============
  await test("A6. 跨刷新/重启：所有状态持久化", async () => {
    const allEqs = await req("/api/equipments", "GET", null, adminToken);
    const eq = allEqs.data[0];

    const q = await req("/api/reservations", "POST", {
      equipment_id: eq.id, borrower_name: `持久Q-${Date.now()}`, borrower_phone: "13500000001",
    }, adminToken);
    const n = await req("/api/reservations", "POST", {
      equipment_id: eq.id, borrower_name: `持久N-${Date.now()}`, borrower_phone: "13500000002",
    }, adminToken);
    await req(`/api/reservations/${n.data.id}/notify`, "PUT", {}, adminToken);
    const c = await req("/api/reservations", "POST", {
      equipment_id: eq.id, borrower_name: `持久C-${Date.now()}`, borrower_phone: "13500000003",
    }, adminToken);
    await req(`/api/reservations/${c.data.id}/cancel`, "PUT", { cancel_reason: "持久取消" }, adminToken);

    // 连续查 3 次模拟刷新
    for (let i = 0; i < 3; i++) {
      const list = await req("/api/reservations", "GET", null, adminToken);
      const qq = list.data.find(x => x.id === q.data.id);
      const nn = list.data.find(x => x.id === n.data.id);
      const cc = list.data.find(x => x.id === c.data.id);
      assert(qq.status === "queued", `第${i+1}次刷新: queued 保持`);
      assert(nn.status === "notified", `第${i+1}次刷新: notified 保持，notified_at=${nn.notified_at}`);
      assert(cc.status === "cancelled", `第${i+1}次刷新: cancelled 保持，reason=${cc.cancel_reason}`);
    }

    // 清理
    for (const rid of [q.data.id, n.data.id, c.data.id]) {
      await req(`/api/reservations/${rid}/cancel`, "PUT", {}, adminToken).catch(() => {});
    }
  });

  // 总结
  console.log("\n" + "=".repeat(60));
  console.log(`预约排队测试结果：通过 ${passed} 项，失败 ${failed} 项`);
  console.log("=".repeat(60));
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error("测试异常终止:", e); process.exit(1); });
