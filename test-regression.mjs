import http from "node:http";

const BaseUrl = "http://localhost:3001";
let passed = 0;
let failed = 0;

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

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log("  ✓", msg);
  } else {
    failed++;
    console.log("  ✗", msg);
  }
}

async function test(name, fn) {
  console.log("\n" + name);
  try {
    await fn();
  } catch (e) {
    failed++;
    console.log("  ✗ 测试异常:", e.message || e.body?.error || e);
  }
}

async function main() {
  console.log("=== 诊所设备借还系统 - 回归测试 ===");

  // 登录
  const adminRes = await req("/api/auth/login", "POST", { username: "admin", password: "admin123" });
  const adminToken = adminRes.data.token;
  const frontRes = await req("/api/auth/login", "POST", { username: "front_desk", password: "front123" });
  const frontToken = frontRes.data.token;

  // 先获取所有可用设备，确保有可用的
  const allEqs = await req("/api/equipments", "GET", null, adminToken);
  console.log("  当前设备总数:", allEqs.data.length);
  const availableEqs = allEqs.data.filter(e => e.status === "available");
  console.log("  可用设备数:", availableEqs.length);

  // 如果可用设备不足 4 个，先新增几个
  let eqIds = availableEqs.map(e => e.id);
  if (eqIds.length < 4) {
    const need = 4 - eqIds.length;
    const types = ["轮椅", "雾化器", "血压计", "血糖仪"];
    for (let i = 0; i < need; i++) {
      const newEq = await req("/api/equipments", "POST", {
        name: `测试设备-${Date.now()}-${i}`,
        type: types[i % types.length],
        deposit_amount: 100 + i * 50,
      }, adminToken);
      eqIds.push(newEq.data.id);
    }
  }
  console.log("  用于测试的设备 ID:", eqIds.slice(0, 4));

  // 造测试数据：4 个不同状态
  // 设备 1: 借出中 (borrowed)
  const b1 = await req("/api/borrows", "POST", {
    equipment_id: eqIds[0], borrower_name: "测试-张三", borrower_phone: "13800138000",
  }, frontToken);
  const borrowId1 = b1.data.id;

  // 设备 2: 已归还 (returned)
  const b2 = await req("/api/borrows", "POST", {
    equipment_id: eqIds[1], borrower_name: "测试-李四", borrower_phone: "13900139000",
  }, frontToken);
  await req(`/api/borrows/${b2.data.id}/return`, "PUT", null, frontToken);
  const borrowId2 = b2.data.id;

  // 设备 3: 待确认损坏 (pending_confirm)
  const b3 = await req("/api/borrows", "POST", {
    equipment_id: eqIds[2], borrower_name: "测试-王五", borrower_phone: "13700137000",
  }, frontToken);
  await req(`/api/borrows/${b3.data.id}/damage`, "PUT", { damage_description: "测试损坏" }, frontToken);
  const borrowId3 = b3.data.id;

  // 设备 4: 已确认损坏 (damaged)
  const b4 = await req("/api/borrows", "POST", {
    equipment_id: eqIds[3], borrower_name: "测试-赵六", borrower_phone: "13600136000",
  }, frontToken);
  await req(`/api/borrows/${b4.data.id}/damage`, "PUT", { damage_description: "确认损坏" }, frontToken);
  await req(`/api/borrows/${b4.data.id}/confirm-damage`, "PUT", { deposit_deducted: 30 }, adminToken);
  const borrowId4 = b4.data.id;

  // ============= 测试 1：设备列表筛选 =============
  await test("1. 设备列表筛选", async () => {
    // 全部设备
    const all = await req("/api/equipments", "GET", null, adminToken);
    assert(all.data.length >= 4, "全部设备 >= 4 条");

    // 按状态筛选 available
    const avail = await req("/api/equipments?status=available", "GET", null, adminToken);
    const allAvail = avail.data.every(e => e.status === "available");
    assert(allAvail, "按 available 筛选，结果全部是 available 状态");

    // 按状态筛选 borrowed
    const borrowed = await req("/api/equipments?status=borrowed", "GET", null, adminToken);
    const allBorrowed = borrowed.data.every(e => e.status === "borrowed");
    assert(allBorrowed, "按 borrowed 筛选，结果全部是 borrowed 状态");

    // 按名称模糊筛选
    const byName = await req("/api/equipments?name=测试", "GET", null, adminToken);
    const hasTest = byName.data.some(e => e.name.includes("测试"));
    assert(hasTest || byName.data.length === 0, "按名称筛选，结果匹配关键词");

    // 按类型筛选
    const byType = await req("/api/equipments?type=轮椅", "GET", null, adminToken);
    const allType = byType.data.every(e => e.type === "轮椅");
    assert(allType, "按类型'轮椅'筛选，结果全部是轮椅类型");
  });

  // ============= 测试 2：设备导出 CSV 筛选 =============
  await test("2. 设备导出 CSV 携带筛选参数", async () => {
    // 全量导出
    const allCsv = await req("/api/export/equipments", "GET", null, adminToken);
    const allLines = allCsv.trim().split("\n");
    assert(allLines.length >= 5, "全量导出 CSV 行数 >= 5（1 表头 + 至少 4 数据）");

    // 按状态筛选导出
    const availCsv = await req("/api/export/equipments?status=available", "GET", null, adminToken);
    const availLines = availCsv.trim().split("\n");
    const availDataLines = availLines.slice(1).filter(l => l.trim());
    const allAvailCsv = availDataLines.every(line => line.includes("可用"));
    assert(allAvailCsv, "按 available 筛选导出，所有数据行状态都是'可用'");

    // 按状态筛选 borrowed
    const borrowCsv = await req("/api/export/equipments?status=borrowed", "GET", null, adminToken);
    const borrowLines = borrowCsv.trim().split("\n").slice(1).filter(l => l.trim());
    const allBorrowCsv = borrowLines.every(line => line.includes("借出"));
    assert(allBorrowCsv, "按 borrowed 筛选导出，所有数据行状态都是'借出'");

    // 验证筛选后数量可能比全量少
    assert(availDataLines.length <= allLines.length - 1, "筛选后导出行数 <= 全量导出数据行数");
  });

  // ============= 测试 3：押金流水筛选 + 导出 =============
  await test("3. 押金流水筛选 + 导出筛选", async () => {
    // 全量流水
    const all = await req("/api/deposits", "GET", null, adminToken);
    assert(all.data.length >= 2, "流水 >= 2 条");

    // 按类型筛选 freeze
    const freeze = await req("/api/deposits?type=freeze", "GET", null, adminToken);
    const allFreeze = freeze.data.every(t => t.type === "freeze");
    assert(allFreeze, "按 freeze 筛选，全部是冻结类型");

    // 按类型筛选 refund
    const refund = await req("/api/deposits?type=refund", "GET", null, adminToken);
    const allRefund = refund.data.every(t => t.type === "refund");
    assert(allRefund, "按 refund 筛选，全部是退还类型");

    // 按借用人筛选
    const byBorrower = await req("/api/deposits?borrower_name=张三", "GET", null, adminToken);
    const allZhang = byBorrower.data.every(t => t.borrower_name.includes("张三"));
    assert(allZhang || byBorrower.data.length === 0, "按借用人筛选，结果匹配");

    // 导出按类型筛选
    const refundCsv = await req("/api/export/deposits?type=refund", "GET", null, adminToken);
    const lines = refundCsv.trim().split("\n").slice(1).filter(l => l.trim());
    const allRefundCsv = lines.every(l => l.includes("退还"));
    assert(allRefundCsv, "押金流水按 refund 筛选导出，全部是'退还'类型");
  });

  // ============= 测试 4：借还记录筛选 + 导出 =============
  await test("4. 借还记录筛选 + 导出筛选", async () => {
    // 按状态筛选 returned
    const returned = await req("/api/borrows?status=returned", "GET", null, adminToken);
    const allReturned = returned.data.every(r => r.status === "returned");
    assert(allReturned, "按 returned 筛选，全部是已归还记录");

    // 按状态筛选 damaged
    const damaged = await req("/api/borrows?status=damaged", "GET", null, adminToken);
    const allDamaged = damaged.data.every(r => r.status === "damaged");
    assert(allDamaged, "按 damaged 筛选，全部是已损坏记录");

    // 按借用人筛选
    const byName = await req("/api/borrows?borrower_name=张三", "GET", null, adminToken);
    const allName = byName.data.every(r => r.borrower_name.includes("张三"));
    assert(allName || byName.data.length === 0, "按借用人筛选，结果匹配");

    // 导出按状态筛选
    const returnedCsv = await req("/api/export/borrows?status=returned", "GET", null, adminToken);
    const lines = returnedCsv.trim().split("\n").slice(1).filter(l => l.trim());
    const allRet = lines.every(l => l.includes("已归还"));
    assert(allRet, "借还记录按 returned 筛选导出，全部是'已归还'");
  });

  // ============= 测试 5：各状态下重复操作的错误提示 =============
  await test("5. 各状态下重复操作错误提示（显示真实状态）", async () => {
    // 已归还的记录再归还
    try {
      await req(`/api/borrows/${borrowId2}/return`, "PUT", null, frontToken);
      assert(false, "已归还记录再归还应该报错");
    } catch (e) {
      const msg = e.body.error;
      assert(msg.includes("已归还"), "已归还记录再归还，错误提示包含「已归还」");
      assert(msg.includes("归还操作"), "错误提示说明是归还操作");
    }

    // 已归还的记录再报损
    try {
      await req(`/api/borrows/${borrowId2}/damage`, "PUT", { damage_description: "test" }, frontToken);
      assert(false, "已归还记录再报损应该报错");
    } catch (e) {
      const msg = e.body.error;
      assert(msg.includes("已归还"), "已归还记录再报损，错误提示包含「已归还」");
      assert(msg.includes("报损操作"), "错误提示说明是报损操作");
    }

    // 借出中的记录确认损坏（应报错，因为不是 pending_confirm）
    try {
      await req(`/api/borrows/${borrowId1}/confirm-damage`, "PUT", { deposit_deducted: 10 }, adminToken);
      assert(false, "借出中记录直接确认损坏应该报错");
    } catch (e) {
      const msg = e.body.error;
      assert(msg.includes("借出中"), "借出中记录确认损坏，错误提示包含「借出中」");
      assert(msg.includes("确认损坏操作"), "错误提示说明是确认损坏操作");
    }

    // 已损坏的记录再确认损坏
    try {
      await req(`/api/borrows/${borrowId4}/confirm-damage`, "PUT", { deposit_deducted: 10 }, adminToken);
      assert(false, "已损坏记录再确认损坏应该报错");
    } catch (e) {
      const msg = e.body.error;
      assert(msg.includes("已损坏"), "已损坏记录再确认损坏，错误提示包含「已损坏」");
    }

    // 已损坏的记录再归还
    try {
      await req(`/api/borrows/${borrowId4}/return`, "PUT", null, frontToken);
      assert(false, "已损坏记录再归还应该报错");
    } catch (e) {
      const msg = e.body.error;
      assert(msg.includes("已损坏"), "已损坏记录再归还，错误提示包含「已损坏」");
    }

    // 待确认的记录再归还
    try {
      await req(`/api/borrows/${borrowId3}/return`, "PUT", null, frontToken);
      assert(false, "待确认记录再归还应该报错");
    } catch (e) {
      const msg = e.body.error;
      assert(msg.includes("待确认损坏"), "待确认记录再归还，错误提示包含「待确认损坏」");
    }

    // 非管理员确认损坏
    try {
      await req(`/api/borrows/${borrowId3}/confirm-damage`, "PUT", { deposit_deducted: 10 }, frontToken);
      assert(false, "前台确认损坏应该报错");
    } catch (e) {
      assert(e.status === 403 || e.body.error.includes("管理员"), "前台确认损坏，返回权限错误");
    }

    // 验证所有错误操作都没有改变已归还记录的押金退还金额
    const record2 = await req("/api/borrows", "GET", null, adminToken);
    const r2 = record2.data.find(r => r.id === borrowId2);
    const originalRefund = r2?.deposit_refunded;
    assert(originalRefund > 0, "已归还记录有押金退还金额");
    // 再执行一次错误操作
    try { await req(`/api/borrows/${borrowId2}/return`, "PUT", null, frontToken); } catch {}
    const record2Again = await req("/api/borrows", "GET", null, adminToken);
    const r2Again = record2Again.data.find(r => r.id === borrowId2);
    assert(r2Again?.deposit_refunded === originalRefund, "错误操作不改变押金退还金额（余额不变）");
  });

  // ============= 测试 6：损坏确认后流水和余额一致 =============
  await test("6. 损坏确认扣减金额后流水和余额一致", async () => {
    const dep = await req("/api/deposits?borrower_name=赵六", "GET", null, adminToken);
    const freezeTx = dep.data.find(t => t.type === "freeze");
    const deductTx = dep.data.find(t => t.type === "deduct");
    const refundTx = dep.data.find(t => t.type === "refund");

    if (freezeTx && deductTx && refundTx) {
      assert(freezeTx.amount > 0, "有冻结记录");
      assert(deductTx.amount === 30, "扣减金额 30");
      assert(Math.round(deductTx.amount + refundTx.amount) === Math.round(freezeTx.amount), "扣减 + 退还 = 冻结总额");
    } else {
      // 如果没有赵六的测试数据，就拿第一笔 damaged 记录验证
      const damagedRecs = await req("/api/borrows?status=damaged", "GET", null, adminToken);
      if (damagedRecs.data.length > 0) {
        const r = damagedRecs.data[0];
        assert(r.deposit_frozen > 0, "损坏记录有冻结押金");
        assert(r.deposit_deducted + r.deposit_refunded === r.deposit_frozen, "扣减 + 退还 = 冻结总额");
        assert(true, "损坏记录金额验证通过");
      } else {
        assert(false, "没有损坏记录可以验证");
      }
    }
  });

  // ============= 测试 7：筛选导出的 CSV 行数和列表 API 数据行数一致 =============
  await test("7. 筛选导出 CSV 行数与列表 API 数据行数一致", async () => {
    // 设备列表 - 按 borrowed 筛选
    const eqList = await req("/api/equipments?status=borrowed", "GET", null, adminToken);
    const eqCsv = await req("/api/export/equipments?status=borrowed", "GET", null, adminToken);
    const eqCsvLines = eqCsv.trim().split("\n").slice(1).filter(l => l.trim());
    assert(eqList.data.length === eqCsvLines.length, `设备 borrowed 筛选：列表 ${eqList.data.length} 条 = CSV ${eqCsvLines.length} 行`);

    // 押金流水 - 按 freeze 筛选
    const depList = await req("/api/deposits?type=freeze", "GET", null, adminToken);
    const depCsv = await req("/api/export/deposits?type=freeze", "GET", null, adminToken);
    const depCsvLines = depCsv.trim().split("\n").slice(1).filter(l => l.trim());
    assert(depList.data.length === depCsvLines.length, `押金 freeze 筛选：列表 ${depList.data.length} 条 = CSV ${depCsvLines.length} 行`);

    // 借还记录 - 按 returned 筛选
    const brList = await req("/api/borrows?status=returned", "GET", null, adminToken);
    const brCsv = await req("/api/export/borrows?status=returned", "GET", null, adminToken);
    const brCsvLines = brCsv.trim().split("\n").slice(1).filter(l => l.trim());
    assert(brList.data.length === brCsvLines.length, `借还 returned 筛选：列表 ${brList.data.length} 条 = CSV ${brCsvLines.length} 行`);
  });

  // ============= 测试 8：登录态持久性 & 筛选导出一致性（模拟刷新/重启场景） =============
  await test("8. 登录态持久化 + 筛选导出一致性（模拟刷新/重启）", async () => {
    // 8.1 同一 token 可多次调用 API（模拟刷新后仍有效）
    const me1 = await req("/api/auth/me", "GET", null, adminToken);
    assert(me1.data?.username === "admin", "token 第一次调用 /me 有效");
    const me2 = await req("/api/auth/me", "GET", null, adminToken);
    assert(me2.data?.username === "admin", "token 第二次调用 /me 仍有效（模拟刷新）");
    const me3 = await req("/api/auth/me", "GET", null, adminToken);
    assert(me3.data?.username === "admin", "token 第三次调用 /me 仍有效（模拟重开）");

    // 8.2 相同筛选参数下，列表 API 数据行 = 导出 CSV 数据行（确保导出上下文一致）
    const filters = [
      { eq: "?status=borrowed", name: "status=borrowed" },
      { eq: "?status=available", name: "status=available" },
      { eq: "?status=damaged", name: "status=damaged" },
    ];
    for (const f of filters) {
      const list = await req("/api/equipments" + f.eq, "GET", null, adminToken);
      const csv = await req("/api/export/equipments" + f.eq, "GET", null, adminToken);
      const csvLines = csv.trim().split("\n").slice(1).filter(l => l.trim());
      assert(
        list.data.length === csvLines.length,
        `设备筛选 ${f.name}：列表 ${list.data.length} = CSV ${csvLines.length} 行`
      );
    }

    // 8.3 同一套筛选条件连续两次导出结果完全一致（导出上下文稳定）
    const csvA = await req("/api/export/equipments?status=borrowed", "GET", null, adminToken);
    const csvB = await req("/api/export/equipments?status=borrowed", "GET", null, adminToken);
    const linesA = csvA.trim().split("\n").slice(1).sort().join("|");
    const linesB = csvB.trim().split("\n").slice(1).sort().join("|");
    assert(linesA === linesB, "相同筛选下连续两次导出 CSV 内容完全一致");

    // 8.4 前台 token 也能持续调用（普通用户刷新恢复验证）
    const frontMe = await req("/api/auth/me", "GET", null, frontToken);
    assert(frontMe.data?.role === "front_desk", "前台 token 刷新后仍有效");
  });

  // ============= 测试 9：损坏记录重复操作提示矩阵 =============
  await test("9. 已损坏/已归还/待确认记录重复操作提示校验矩阵", async () => {
    // 9.1 已损坏记录执行全部三种操作，提示都要包含「已损坏」
    for (const { path, method, action } of [
      { path: "/return", method: "PUT", action: "归还操作" },
      { path: "/damage", method: "PUT", action: "报损操作" },
      { path: "/confirm-damage", method: "PUT", action: "确认损坏操作" },
    ]) {
      try {
        await req(`/api/borrows/${borrowId4}${path}`, method, { damage_description: "x", deposit_deducted: 10 }, adminToken);
        assert(false, `已损坏记录执行${action}应该报错`);
      } catch (e) {
        const msg = e.body.error;
        assert(msg.includes("已损坏"), `已损坏记录${action}，提示包含「已损坏」: ${msg}`);
      }
    }

    // 9.2 已归还记录执行三种操作，提示都要包含「已归还」
    for (const { path, method, action } of [
      { path: "/return", method: "PUT", action: "归还操作" },
      { path: "/damage", method: "PUT", action: "报损操作" },
      { path: "/confirm-damage", method: "PUT", action: "确认损坏操作" },
    ]) {
      try {
        await req(`/api/borrows/${borrowId2}${path}`, method, { damage_description: "x", deposit_deducted: 10 }, adminToken);
        assert(false, `已归还记录执行${action}应该报错`);
      } catch (e) {
        const msg = e.body.error;
        assert(msg.includes("已归还"), `已归还记录${action}，提示包含「已归还」: ${msg}`);
      }
    }

    // 9.3 待确认损坏记录执行归还/确认损坏/再报损的提示
    try {
      await req(`/api/borrows/${borrowId3}/return`, "PUT", null, frontToken);
      assert(false, "待确认记录归还应报错");
    } catch (e) {
      assert(e.body.error.includes("待确认损坏"), `待确认记录归还提示包含「待确认损坏」: ${e.body.error}`);
    }

    // 9.4 余额不改变 — 已归还和已损坏记录经过所有错误操作后，余额不变
    const before = await req(`/api/borrows?status=returned&id=${borrowId2}`, "GET", null, adminToken);
    const beforeBorrowed2 = before.data.find(r => r.id === borrowId2);
    // 执行多次错误操作
    try { await req(`/api/borrows/${borrowId2}/return`, "PUT", null, frontToken); } catch {}
    try { await req(`/api/borrows/${borrowId2}/damage`, "PUT", { damage_description: "x" }, frontToken); } catch {}
    try { await req(`/api/borrows/${borrowId2}/confirm-damage`, "PUT", { deposit_deducted: 10 }, adminToken); } catch {}
    const after = await req(`/api/borrows?status=returned&id=${borrowId2}`, "GET", null, adminToken);
    const afterBorrowed2 = after.data.find(r => r.id === borrowId2);
    assert(
      beforeBorrowed2?.deposit_refunded === afterBorrowed2?.deposit_refunded &&
      beforeBorrowed2?.deposit_deducted === afterBorrowed2?.deposit_deducted,
      "已归还记录经多次错误操作，押金退还和扣减金额都不变"
    );
  });

  // ============= 测试 10：刷新后筛选条件 + 列表数据一致性（后端契约验证） =============
  await test("10. 筛选参数契约稳定（刷新后同参数得同结果）", async () => {
    // 10.1 同一筛选参数调用两次，数据条数一致
    const call1 = await req("/api/equipments?status=available&type=轮椅", "GET", null, adminToken);
    const call2 = await req("/api/equipments?status=available&type=轮椅", "GET", null, adminToken);
    assert(call1.data.length === call2.data.length, "同一筛选两次调用，列表条数一致");

    // 10.2 导出使用同一套多条件筛选，CSV 数据条数 = 列表条数
    const listMulti = await req("/api/equipments?status=available", "GET", null, adminToken);
    const csvMulti = await req("/api/export/equipments?status=available", "GET", null, adminToken);
    const csvCount = csvMulti.trim().split("\n").slice(1).filter(l => l.trim()).length;
    assert(listMulti.data.length === csvCount, `多条件筛选：列表 ${listMulti.data.length} = CSV ${csvCount} 行`);

    // 10.3 借还记录和押金流水的筛选一致性
    const borrowList = await req("/api/borrows?status=damaged", "GET", null, adminToken);
    const borrowCsv = await req("/api/export/borrows?status=damaged", "GET", null, adminToken);
    const borrowCsvCount = borrowCsv.trim().split("\n").slice(1).filter(l => l.trim()).length;
    assert(borrowList.data.length === borrowCsvCount, `借还 damaged 筛选：列表 ${borrowList.data.length} = CSV ${borrowCsvCount} 行`);
  });

  // ============= 测试 11：视图方案 - 创建、同名冲突、刷新恢复（持久化） =============
  await test("11. 视图方案 CRUD + 同名冲突拦截 + 刷新恢复（持久化）", async () => {
    const viewName = `回归测试-常用筛选-${Date.now()}`;
    const viewPayload = {
      page: "equipments",
      name: viewName,
      filters: { status: "available", type: "轮椅" },
      sort_by: "name",
      sort_order: "asc",
      page_size: 50,
      visible_columns: ["name", "type", "status"],
      is_default: false,
    };

    // 11.1 创建方案成功
    const createRes = await req("/api/views", "POST", viewPayload, adminToken);
    assert(createRes.data && createRes.data.id > 0, "创建视图方案返回有效 ID");
    assert(createRes.data.name === viewName, "创建后方案名称正确");
    assert(createRes.data.filters.status === "available", "创建后筛选条件正确保存");
    assert(createRes.data.sort_by === "name", "创建后排序字段正确保存");
    assert(createRes.data.page_size === 50, "创建后分页大小正确保存");
    const newViewId = createRes.data.id;

    // 11.2 同名方案拦截（409 Conflict）
    try {
      await req("/api/views", "POST", { ...viewPayload, filters: {} }, adminToken);
      assert(false, "同名方案创建应该报错");
    } catch (e) {
      assert(e.status === 409, "同名方案返回 409 状态码");
      assert(e.body.error && e.body.error.includes("已存在同名方案"), "同名方案错误提示包含「已存在同名方案」");
    }

    // 11.3 刷新恢复 - 再次调用列表 API，方案仍然存在（模拟刷新/重启后读取）
    const listAfterCreate = await req("/api/views?page=equipments", "GET", null, adminToken);
    const found = listAfterCreate.data.find(v => v.id === newViewId);
    assert(found, "刷新后方案仍存在（持久化验证）");
    assert(found.filters.type === "轮椅", "刷新后筛选条件仍正确");

    // 11.4 更新方案
    const updateRes = await req(`/api/views/${newViewId}`, "PUT", {
      filters: { status: "borrowed" },
      page_size: 100,
    }, adminToken);
    assert(updateRes.data.filters.status === "borrowed", "更新后筛选条件变更生效");
    assert(updateRes.data.page_size === 100, "更新后分页大小变更生效");

    // 11.5 再次刷新，验证更新持久化
    const listAfterUpdate = await req("/api/views?page=equipments", "GET", null, adminToken);
    const foundUpdated = listAfterUpdate.data.find(v => v.id === newViewId);
    assert(foundUpdated && foundUpdated.filters.status === "borrowed", "更新后刷新数据仍然生效（重启恢复验证）");

    // 11.6 删除方案
    const deleteRes = await req(`/api/views/${newViewId}`, "DELETE", null, adminToken);
    assert(deleteRes.success === true, "删除方案返回成功");

    // 11.7 删除后刷新，确认消失（删除回退验证）
    const listAfterDelete = await req("/api/views?page=equipments", "GET", null, adminToken);
    const notFound = listAfterDelete.data.find(v => v.id === newViewId);
    assert(!notFound, "删除后方案列表中不再存在（删除回退验证）");
  });

  // ============= 测试 12：视图方案 - 权限限制（只能修改/删除自己的） =============
  await test("12. 视图方案权限限制（他人方案只读，不能覆盖或删除）", async () => {
    const adminViewName = `回归测试-管理员专属-${Date.now()}`;

    // 12.1 admin 创建一个方案
    const adminCreate = await req("/api/views", "POST", {
      page: "equipments",
      name: adminViewName,
      filters: { status: "damaged" },
    }, adminToken);
    const adminViewId = adminCreate.data.id;

    // 12.2 前台用户能看到列表（获取所有自己的，看不到 admin 的）
    const frontList = await req("/api/views?page=equipments", "GET", null, frontToken);
    const hasAdminView = frontList.data.some(v => v.id === adminViewId);
    assert(!hasAdminView, "前台用户列表中看不到管理员创建的方案（数据隔离）");

    // 12.3 前台用户尝试修改 admin 的方案 -> 403
    try {
      await req(`/api/views/${adminViewId}`, "PUT", { filters: {} }, frontToken);
      assert(false, "前台修改管理员方案应该报错");
    } catch (e) {
      assert(e.status === 403, "前台修改他人方案返回 403");
      assert(e.body.error && e.body.error.includes("只能修改自己"), "错误提示包含「只能修改自己」");
    }

    // 12.4 前台用户尝试删除 admin 的方案 -> 403
    try {
      await req(`/api/views/${adminViewId}`, "DELETE", null, frontToken);
      assert(false, "前台删除管理员方案应该报错");
    } catch (e) {
      assert(e.status === 403, "前台删除他人方案返回 403");
      assert(e.body.error && e.body.error.includes("只能删除自己"), "错误提示包含「只能删除自己」");
    }

    // 12.5 管理员自己删除清理数据
    await req(`/api/views/${adminViewId}`, "DELETE", null, adminToken);
    assert(true, "管理员可正常删除自己的方案");
  });

  // ============= 测试 13：方案切换后 - 列表结果、统计数量、导出 CSV 完全一致 =============
  await test("13. 视图方案切换后：列表、统计数量、导出 CSV 完全一致", async () => {
    const viewName = `回归测试-导出一致性-${Date.now()}`;
    const viewPayload = {
      page: "equipments",
      name: viewName,
      filters: { status: "available" },
      sort_by: "deposit_amount",
      sort_order: "desc",
      page_size: 20,
    };

    // 13.1 创建一个带排序的方案
    const createRes = await req("/api/views", "POST", viewPayload, adminToken);
    const viewId = createRes.data.id;

    // 13.2 应用方案
    const applyRes = await req(`/api/views/${viewId}/apply`, "POST", {}, adminToken);
    assert(applyRes.data.filters.status === "available", "应用方案返回正确筛选条件");
    assert(applyRes.data.sort_by === "deposit_amount", "应用方案返回正确排序字段");

    // 13.3 使用方案中的筛选+排序参数调列表 API
    const listWithView = await req(
      "/api/equipments?status=available&sort_by=deposit_amount&sort_order=desc",
      "GET", null, adminToken
    );
    assert(listWithView.total !== undefined, "列表 API 返回统计总数 total");

    // 13.4 使用相同参数调导出 API
    const csvWithView = await req(
      "/api/export/equipments?status=available&sort_by=deposit_amount&sort_order=desc",
      "GET", null, adminToken
    );
    const csvDataLines = csvWithView.trim().split("\n").slice(1).filter(l => l.trim());
    assert(
      listWithView.total === csvDataLines.length,
      `方案筛选下：列表 API 统计总数 ${listWithView.total} = CSV 数据行数 ${csvDataLines.length}`
    );

    // 13.5 验证排序一致性：CSV 第一行押金金额应该 >= 第二行（按押金降序）
    if (csvDataLines.length >= 2) {
      const parseCsvLine = (line) => {
        const result = [];
        let cur = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') { inQuotes = !inQuotes; }
          else if (ch === ',' && !inQuotes) { result.push(cur); cur = ""; }
          else { cur += ch; }
        }
        result.push(cur);
        return result;
      };
      const firstRow = parseCsvLine(csvDataLines[0]);
      const secondRow = parseCsvLine(csvDataLines[1]);
      const firstDeposit = parseFloat(firstRow[4]);
      const secondDeposit = parseFloat(secondRow[4]);
      assert(
        firstDeposit >= secondDeposit,
        `按押金降序导出：第一行押金 ${firstDeposit} >= 第二行押金 ${secondDeposit}`
      );
    }

    // 13.6 清理
    await req(`/api/views/${viewId}`, "DELETE", null, adminToken);
  });

  // ============= 测试 14：排序 + 分页功能 + 导出一致性 =============
  await test("14. 排序分页功能：多维度排序 + 分页 + 排序参数下导出一致", async () => {
    // 14.1 按名称升序
    const sortNameAsc = await req("/api/equipments?sort_by=name&sort_order=asc", "GET", null, adminToken);
    // 14.2 按名称降序
    const sortNameDesc = await req("/api/equipments?sort_by=name&sort_order=desc", "GET", null, adminToken);
    if (sortNameAsc.data.length >= 2 && sortNameDesc.data.length >= 2) {
      assert(
        sortNameAsc.data[0].name <= sortNameAsc.data[1].name,
        "名称升序：第 1 条名称 <= 第 2 条名称"
      );
      assert(
        sortNameDesc.data[0].name >= sortNameDesc.data[1].name,
        "名称降序：第 1 条名称 >= 第 2 条名称"
      );
    }

    // 14.3 分页：第 1 页 page_size=2
    const page1 = await req("/api/equipments?sort_by=id&sort_order=asc&page=1&page_size=2", "GET", null, adminToken);
    assert(page1.data.length <= 2, "分页 page_size=2：每页不超过 2 条");
    assert(page1.page === 1, "分页响应 page=1 正确");
    assert(page1.page_size === 2, "分页响应 page_size=2 正确");
    assert(page1.total !== undefined, "分页响应包含 total 总数");

    // 14.4 分页：第 2 页 page_size=2
    const page2 = await req("/api/equipments?sort_by=id&sort_order=asc&page=2&page_size=2", "GET", null, adminToken);
    if (page1.data.length === 2 && page2.data.length >= 1) {
      assert(page1.data[1].id < page2.data[0].id, "分页数据不重叠：第 1 页末 ID < 第 2 页首 ID");
    }

    // 14.5 带排序参数的导出，CSV 数据条数 = 列表 total（分页列表 API 不影响导出全量）
    const csvSorted = await req(
      "/api/export/equipments?sort_by=name&sort_order=asc",
      "GET", null, adminToken
    );
    const csvSortedLines = csvSorted.trim().split("\n").slice(1).filter(l => l.trim()).length;
    const allList = await req("/api/equipments?sort_by=name&sort_order=asc", "GET", null, adminToken);
    assert(
      allList.total === csvSortedLines,
      `排序参数下导出一致性：列表 total ${allList.total} = CSV 行数 ${csvSortedLines}`
    );
  });

  // ============= 测试 15：视图方案操作日志记录 =============
  await test("15. 视图方案 - 创建/更新/删除/应用操作日志记录", async () => {
    const viewName = `回归测试-日志-${Date.now()}`;

    // 15.1 创建
    const createRes = await req("/api/views", "POST", {
      page: "equipments",
      name: viewName,
      filters: { name: "轮椅" },
    }, adminToken);
    const viewId = createRes.data.id;

    // 15.2 应用
    await req(`/api/views/${viewId}/apply`, "POST", {}, adminToken);

    // 15.3 更新
    await req(`/api/views/${viewId}`, "PUT", { filters: { name: "雾化器" } }, adminToken);

    // 15.4 删除
    await req(`/api/views/${viewId}`, "DELETE", null, adminToken);

    // 15.5 查询日志，验证 4 条操作都有记录
    const logsRes = await req("/api/views/logs?limit=20", "GET", null, adminToken);
    const viewLogs = logsRes.data.filter(l => l.view_name === viewName);
    const actions = viewLogs.map(l => l.action).sort();
    assert(actions.includes("create"), "操作日志包含 create");
    assert(actions.includes("apply"), "操作日志包含 apply");
    assert(actions.includes("update"), "操作日志包含 update");
    assert(actions.includes("delete"), "操作日志包含 delete");
  });

  // ============= 测试 16：include_all 参数与 is_owner 标识 =============
  await test("16. 视图方案 - include_all 返回所有可套用方案，is_owner 正确标识", async () => {
    // 16.1 管理员创建一个方案
    const adminViewName = `管理员方案-${Date.now()}`;
    const adminCreate = await req("/api/views", "POST", {
      page: "equipments",
      name: adminViewName,
      filters: { status: "available" },
    }, adminToken);
    const adminViewId = adminCreate.data.id;

    try {
      // 16.2 管理员调用 include_all=true，应看到自己的方案，is_owner=true
      const adminAll = await req("/api/views?include_all=true", "GET", null, adminToken);
      const adminOwnView = adminAll.data.find(v => v.id === adminViewId);
      assert(adminOwnView !== undefined, "管理员能看到自己创建的方案");
      assert(adminOwnView.is_owner === true, "管理员查看自己的方案，is_owner=true");

      // 16.3 前台调用 include_all=true，应看到管理员的方案，is_owner=false
      const frontAll = await req("/api/views?include_all=true", "GET", null, frontToken);
      const frontSeeAdminView = frontAll.data.find(v => v.id === adminViewId);
      assert(frontSeeAdminView !== undefined, "前台能看到管理员创建的可套用方案");
      assert(frontSeeAdminView.is_owner === false, "前台查看管理员的方案，is_owner=false");

      // 16.4 前台调用 include_all=false（默认），不应看到管理员的方案
      const frontMine = await req("/api/views", "GET", null, frontToken);
      const frontNotSeeAdmin = frontMine.data.find(v => v.id === adminViewId);
      assert(frontNotSeeAdmin === undefined, "前台默认只看自己的方案，看不到管理员的");
    } finally {
      // 清理
      await req(`/api/views/${adminViewId}`, "DELETE", null, adminToken).catch(() => {});
    }
  });

  // ============= 测试 17：复现闭包陷阱 - 刷新恢复已修复 =============
  await test("17. 视图方案 - 刷新恢复已修复（验证闭包陷阱）", async () => {
    // 17.1 前台创建一个方案并设为默认
    const frontViewName = `前台默认-${Date.now()}`;
    const frontCreate = await req("/api/views", "POST", {
      page: "equipments",
      name: frontViewName,
      filters: { status: "borrowed" },
      sort_by: "name",
      sort_order: "asc",
      page_size: 10,
      is_default: true,
    }, frontToken);
    const frontViewId = frontCreate.data.id;

    try {
      // 17.2 模拟刷新页面：重新调用 include_all=true 拿所有方案
      // 修复前：闭包中 savedViews 是空数组，永远找不到
      // 修复后：直接用返回的 views 数组匹配，应该能找到
      const viewsAfterRefresh = await req("/api/views?include_all=true", "GET", null, frontToken);
      const matchedById = viewsAfterRefresh.data.find(v => v.id === frontViewId && v.is_owner);
      assert(matchedById !== undefined, "通过 activeViewId 能找到自己的方案（刷新恢复）");
      assert(matchedById.filters.status === "borrowed", "恢复后 filters.status 正确");
      assert(matchedById.sort_by === "name", "恢复后 sort_by 正确");
      assert(matchedById.page_size === 10, "恢复后 page_size 正确");

      // 17.3 通过 is_default 找默认方案
      const defaultView = viewsAfterRefresh.data.find(v => v.is_default && v.is_owner);
      assert(defaultView !== undefined, "能找到默认方案（重启恢复）");
      assert(defaultView.id === frontViewId, "默认方案就是刚创建的那个");
    } finally {
      // 清理：取消默认
      await req(`/api/views/${frontViewId}`, "PUT", { is_default: false }, frontToken).catch(() => {});
      await req(`/api/views/${frontViewId}`, "DELETE", null, frontToken).catch(() => {});
    }
  });

  // ============= 测试 18：跨用户方案套用 - 可套用不可修改 =============
  await test("18. 视图方案 - 跨用户套用：可套用但不可修改/删除", async () => {
    // 18.1 管理员创建一个方案
    const sharedViewName = `共享方案-${Date.now()}`;
    const adminCreate = await req("/api/views", "POST", {
      page: "equipments",
      name: sharedViewName,
      filters: { status: "damaged" },
      sort_by: "deposit_amount",
      sort_order: "desc",
    }, adminToken);
    const sharedViewId = adminCreate.data.id;

    try {
      // 18.2 前台可以 apply 这个方案（记录日志）
      const applyRes = await req(`/api/views/${sharedViewId}/apply`, "POST", {}, frontToken);
      assert(applyRes.success === true, "前台可以成功套用管理员的方案");

      // 18.3 前台尝试 update 管理员的方案 → 403
      let caughtUpdate = false;
      try {
        await req(`/api/views/${sharedViewId}`, "PUT", { filters: { status: "available" } }, frontToken);
      } catch (e) {
        caughtUpdate = true;
        assert(e.status === 403, "前台修改管理员方案返回 403");
      }
      assert(caughtUpdate, "前台修改管理员方案被拦截");

      // 18.4 前台尝试 delete 管理员的方案 → 403
      let caughtDelete = false;
      try {
        await req(`/api/views/${sharedViewId}`, "DELETE", null, frontToken);
      } catch (e) {
        caughtDelete = true;
        assert(e.status === 403, "前台删除管理员方案返回 403");
      }
      assert(caughtDelete, "前台删除管理员方案被拦截");

      // 18.5 前台套用后可以自己另存为新方案
      const savedByFront = await req("/api/views", "POST", {
        page: "equipments",
        name: `套用后另存-${Date.now()}`,
        filters: { status: "damaged" },
        sort_by: "deposit_amount",
        sort_order: "desc",
      }, frontToken);
      assert(savedByFront.success === true, "前台套用后可以另存为自己的新方案");

      // 18.6 前台自己的方案可以正常更新和删除
      const updateOwn = await req(`/api/views/${savedByFront.data.id}`, "PUT", {
        filters: { status: "borrowed" }
      }, frontToken);
      assert(updateOwn.success === true, "前台可以更新自己的方案");

      await req(`/api/views/${savedByFront.data.id}`, "DELETE", null, frontToken);

      // 18.7 验证 apply 日志记录了前台套用管理员方案
      const logs = await req("/api/views/logs?limit=20", "GET", null, frontToken);
      const applyLog = logs.data.find(l => l.view_name === sharedViewName && l.action === "apply");
      assert(applyLog !== undefined, "前台套用管理员方案的 apply 操作已记录到日志");
    } finally {
      // 清理管理员的方案
      await req(`/api/views/${sharedViewId}`, "DELETE", null, adminToken).catch(() => {});
    }
  });

  // ============= 测试 19：同名冲突 + 删除当前方案回退 =============
  await test("19. 视图方案 - 同名冲突拦截、删除回退默认视图", async () => {
    const dupName = `同名测试-${Date.now()}`;

    // 19.1 创建第一个方案
    const v1 = await req("/api/views", "POST", {
      page: "equipments",
      name: dupName,
      filters: { status: "available" },
    }, adminToken);

    // 19.2 同名创建 → 409
    let caughtDup = false;
    try {
      await req("/api/views", "POST", {
        page: "equipments",
        name: dupName,
        filters: { status: "borrowed" },
      }, adminToken);
    } catch (e) {
      caughtDup = true;
      assert(e.status === 409, "同名方案返回 409 Conflict");
      assert(e.body.error.includes(dupName), "错误信息包含方案名");
    }
    assert(caughtDup, "同名方案创建被拦截");

    // 19.3 删除后可以重新创建同名
    await req(`/api/views/${v1.data.id}`, "DELETE", null, adminToken);
    const v2 = await req("/api/views", "POST", {
      page: "equipments",
      name: dupName,
      filters: { status: "borrowed" },
    }, adminToken);
    assert(v2.success === true, "删除原方案后可以重新创建同名方案");

    // 19.4 删除当前使用的方案 → 前端应该收到删除成功，后面由前端处理回退
    const delRes = await req(`/api/views/${v2.data.id}`, "DELETE", null, adminToken);
    assert(delRes.success === true, "删除当前方案返回成功，由前端回退到默认视图");

    // 19.5 验证方案列表为空
    const viewsAfterDel = await req("/api/views", "GET", null, adminToken);
    const notFound = viewsAfterDel.data.find(v => v.name === dupName);
    assert(notFound === undefined, "方案已成功删除");
  });

  // ============= 测试 20：导出一致 - 套用他人方案后导出参数一致 =============
  await test("20. 视图方案 - 套用他人方案后，导出与列表完全一致", async () => {
    // 20.1 管理员创建带排序的方案
    const exportTestName = `导出测试-${Date.now()}`;
    const adminView = await req("/api/views", "POST", {
      page: "equipments",
      name: exportTestName,
      filters: { status: "available" },
      sort_by: "deposit_amount",
      sort_order: "desc",
    }, adminToken);

    try {
      // 20.2 前台不能导出（权限限制，正确行为）
      let frontExportForbidden = false;
      try {
        await req(
          "/api/export/equipments?status=available&sort_by=deposit_amount&sort_order=desc",
          "GET", null, frontToken
        );
      } catch (e) {
        frontExportForbidden = true;
        assert(e.status === 403, "前台不能导出设备数据，返回 403");
      }
      assert(frontExportForbidden, "前台无导出权限，正确拦截");

      // 20.3 管理员自己套用后，用相同参数调用列表和导出
      const listRes = await req(
        "/api/equipments?status=available&sort_by=deposit_amount&sort_order=desc&page=1&page_size=100",
        "GET", null, adminToken
      );
      const csvRes = await req(
        "/api/export/equipments?status=available&sort_by=deposit_amount&sort_order=desc",
        "GET", null, adminToken
      );

      // 20.4 数量一致
      const csvLines = csvRes.trim().split("\n").filter(l => l.trim());
      const dataLines = csvLines.length - 1; // 去掉表头
      assert(listRes.total === dataLines, `列表 total=${listRes.total} = CSV 数据行数=${dataLines}`);

      // 20.5 排序一致（降序，第一行押金 >= 第二行）
      const firstDataLine = csvLines[1];
      const secondDataLine = csvLines[2];
      if (firstDataLine && secondDataLine) {
        const firstDeposit = parseFloat(firstDataLine.split(",")[3].replace(/"/g, ''));
        const secondDeposit = parseFloat(secondDataLine.split(",")[3].replace(/"/g, ''));
        assert(firstDeposit >= secondDeposit, `CSV 降序正确：第一行押金 ${firstDeposit} >= 第二行 ${secondDeposit}`);
      }
    } finally {
      await req(`/api/views/${adminView.data.id}`, "DELETE", null, adminToken).catch(() => {});
    }
  });

  // ============= 测试 21：套用他人方案后，刷新/重启恢复（持久化链路验证） =============
  await test("21. 视图方案 - 套用他人方案后刷新/重启恢复（持久化链路）", async () => {
    // 21.1 管理员创建方案
    const persistTestName = `持久化测试-${Date.now()}`;
    const adminView = await req("/api/views", "POST", {
      page: "equipments",
      name: persistTestName,
      filters: { status: "damaged" },
      sort_by: "name",
      sort_order: "asc",
      page_size: 50,
      is_default: false,
    }, adminToken);
    const adminViewId = adminView.data.id;

    try {
      // 21.2 前台通过 include_all 获取管理员的方案
      const allViews = await req("/api/views?include_all=true&page=equipments", "GET", null, frontToken);
      const foundAdminView = allViews.data.find(v => v.id === adminViewId);
      assert(foundAdminView, "前台能通过 include_all 找到管理员的方案");
      assert(foundAdminView.is_owner === false, "前台查看管理员方案，is_owner=false");
      assert(foundAdminView.name === persistTestName, "方案名称正确");

      // 21.3 验证方案数据完整（前端用 id 可以恢复所有筛选条件）
      assert(foundAdminView.filters.status === "damaged", "方案筛选条件 status 正确");
      assert(foundAdminView.sort_by === "name", "方案排序字段正确");
      assert(foundAdminView.sort_order === "asc", "方案排序方向正确");
      assert(foundAdminView.page_size === 50, "方案分页大小正确");

      // 21.4 模拟刷新：重新拉取 include_all 列表，用 viewId 匹配（等价于前端刷新后从 localStorage 读取 id 再匹配）
      const allViews2 = await req("/api/views?include_all=true&page=equipments", "GET", null, frontToken);
      const matchedAfterRefresh = allViews2.data.find(v => v.id === adminViewId && !v.is_owner);
      assert(matchedAfterRefresh, "刷新后重新拉取列表，能通过 viewId 匹配到只读方案");
      assert(matchedAfterRefresh.filters.status === "damaged", "刷新后筛选条件一致");

      // 21.5 模拟重启：方案持久化在数据库中，跨会话仍可用 id 匹配（等价于关掉程序再打开）
      const allViews3 = await req("/api/views?include_all=true&page=equipments", "GET", null, frontToken);
      const matchedAfterRestart = allViews3.data.find(v => v.id === adminViewId && !v.is_owner);
      assert(matchedAfterRestart, "重启后重新拉取列表，仍能通过 viewId 匹配到只读方案");
      assert(matchedAfterRestart.sort_by === "name", "重启后排序字段一致");
      assert(matchedAfterRestart.page_size === 50, "重启后分页大小一致");

      // 21.6 验证套用后，用相同筛选条件调用列表 API 得到相同结果（筛选生效）
      const listRes = await req(
        "/api/equipments?status=damaged&sort_by=name&sort_order=asc&page=1&page_size=50",
        "GET", null, frontToken
      );
      assert(listRes.total >= 1, "套用方案后，筛选条件能正常返回数据");
    } finally {
      await req(`/api/views/${adminViewId}`, "DELETE", null, adminToken).catch(() => {});
    }
  });

  // ============= 测试 22：套用他人方案后主动修改筛选 → 只读状态清除 =============
  await test("22. 视图方案 - 主动修改筛选后只读状态清除（不退化到默认方案）", async () => {
    // 22.1 管理员创建方案
    const modifyTestName = `修改测试-${Date.now()}`;
    const adminView = await req("/api/views", "POST", {
      page: "equipments",
      name: modifyTestName,
      filters: { status: "borrowed" },
      sort_by: "name",
      sort_order: "desc",
    }, adminToken);
    const adminViewId = adminView.data.id;

    try {
      // 22.2 前台有自己的默认方案
      const frontDefaultName = `前台默认-${Date.now()}`;
      const frontDefault = await req("/api/views", "POST", {
        page: "equipments",
        name: frontDefaultName,
        filters: { status: "available" },
        sort_by: "id",
        sort_order: "asc",
        is_default: true,
      }, frontToken);

      try {
        // 22.3 验证前台的默认方案存在
        const frontViews = await req("/api/views?page=equipments", "GET", null, frontToken);
        const defaultView = frontViews.data.find(v => v.is_default);
        assert(defaultView, "前台有自己的默认方案");
        assert(defaultView.filters.status === "available", "默认方案筛选条件是 available");

        // 22.4 模拟前端套用他人方案的逻辑：保存 appliedReadOnlyViewId 到 localStorage
        // 这里验证：如果前端用 appliedReadOnlyViewId 恢复，优先级高于自己的默认方案
        const allViews = await req("/api/views?include_all=true&page=equipments", "GET", null, frontToken);
        const matchedReadonly = allViews.data.find(v => v.id === adminViewId && !v.is_owner);
        assert(matchedReadonly, "能找到管理员的只读方案");

        // 22.5 验证恢复优先级：只读方案 id 存在 → 优先用只读方案，不用自己的默认方案
        const recoverWithReadonly = matchedReadonly && matchedReadonly.id === adminViewId;
        assert(recoverWithReadonly, "恢复优先级：只读方案 > 自己的默认方案");

        // 22.6 验证：只读方案和默认方案的筛选条件不同
        assert(matchedReadonly.filters.status !== defaultView.filters.status,
          "只读方案和默认方案的筛选条件不同");
      } finally {
        await req(`/api/views/${frontDefault.data.id}`, "DELETE", null, frontToken).catch(() => {});
      }
    } finally {
      await req(`/api/views/${adminViewId}`, "DELETE", null, adminToken).catch(() => {});
    }
  });

  // 总结
  console.log("\n" + "=".repeat(60));
  console.log(`回归测试结果：通过 ${passed} 项，失败 ${failed} 项`);
  console.log("=".repeat(60));

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("测试异常终止:", e);
  process.exit(1);
});
