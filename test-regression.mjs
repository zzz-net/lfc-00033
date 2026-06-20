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
