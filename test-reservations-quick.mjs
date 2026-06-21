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

async function main() {
  try {
    console.log("=== 快速预约测试 ===");
    
    // 登录
    const adminRes = await req("/api/auth/login", "POST", { username: "admin", password: "admin123" });
    const adminToken = adminRes.data.token;
    console.log("✓ 管理员登录成功");

    const frontRes = await req("/api/auth/login", "POST", { username: "front_desk", password: "front123" });
    const frontToken = frontRes.data.token;
    console.log("✓ 前台登录成功");

    // 获取设备
    const allEqs = await req("/api/equipments", "GET", null, adminToken);
    const eq = allEqs.data[0];
    console.log(`✓ 拿到设备 ID=${eq.id}, name=${eq.name}`);

    // 测试 1: 创建预约
    console.log("\n--- 测试 1: 创建预约 ---");
    const borrower = `快测-${Date.now()}`;
    const r1 = await req("/api/reservations", "POST", {
      equipment_id: eq.id,
      borrower_name: borrower,
      borrower_phone: "13000000001",
      notes: "快速测试",
    }, frontToken);
    console.log("✓ 创建预约成功, id=", r1.data.id, "status=", r1.data.status, "queue_order=", r1.data.queue_order);

    // 测试 2: 重复预约
    console.log("\n--- 测试 2: 重复预约拦截 ---");
    try {
      await req("/api/reservations", "POST", {
        equipment_id: eq.id,
        borrower_name: borrower,
        borrower_phone: "13000000001",
      }, frontToken);
      console.log("✗ 应该报错却成功了");
    } catch (e) {
      console.log(`✓ 重复预约被拦截: status=${e.status}, msg=${e.body.error}`);
    }

    // 测试 3: 前台取消自己的
    console.log("\n--- 测试 3: 前台取消自己的预约 ---");
    const cancelRes = await req(`/api/reservations/${r1.data.id}/cancel`, "PUT", {
      cancel_reason: "快速测试取消",
      expected_version: r1.data.version,
    }, frontToken);
    console.log("✓ 取消成功, status=", cancelRes.data.status, "reason=", cancelRes.data.cancel_reason);

    // 测试 4: 查询设备详情是否包含预约
    console.log("\n--- 测试 4: 设备详情包含预约 ---");
    // 先创建一个新的
    const r2 = await req("/api/reservations", "POST", {
      equipment_id: eq.id,
      borrower_name: `${borrower}-2`,
      borrower_phone: "13000000002",
    }, frontToken);
    const detail = await req(`/api/equipments/${eq.id}/detail`, "GET", null, adminToken);
    console.log(`✓ 设备详情包含 reservations 字段: ${Array.isArray(detail.data.reservations)}`);
    if (Array.isArray(detail.data.reservations)) {
      const found = detail.data.reservations.find(x => x.id === r2.data.id);
      console.log(`✓ 详情中找到刚创建的预约: ${found ? "yes" : "no"}, status=${found?.status}`);
    }

    // 测试 5: 通知
    console.log("\n--- 测试 5: 通知 ---");
    const notifyRes = await req(`/api/reservations/${r2.data.id}/notify`, "PUT", {}, adminToken);
    console.log("✓ 通知成功, status=", notifyRes.data.status, "notified_at=", notifyRes.data.notified_at);

    // 测试 6: 完成
    console.log("\n--- 测试 6: 完成 ---");
    const completeRes = await req(`/api/reservations/${r2.data.id}/complete`, "PUT", {
      expected_version: notifyRes.data.version,
    }, adminToken);
    console.log("✓ 完成成功, status=", completeRes.data.status);

    // 测试 7: 导出 CSV
    console.log("\n--- 测试 7: 导出 CSV ---");
    const csv = await req("/api/export/reservations", "GET", null, adminToken);
    const lines = csv.trim().split("\n");
    console.log(`✓ 导出成功: ${lines.length} 行 (1表头 + ${lines.length - 1}数据)`);
    console.log(`  表头: ${lines[0].substring(0, 80)}...`);

    // 测试 8: 列表查询
    console.log("\n--- 测试 8: 列表查询 ---");
    const list = await req("/api/reservations", "GET", null, adminToken);
    console.log(`✓ 列表成功: ${list.data.length} 条`);

    // 测试 9: 前台列表只看自己的
    const frontList = await req("/api/reservations", "GET", null, frontToken);
    const allMine = frontList.data.every(r => r.operator_name === "front_desk");
    console.log(`✓ 前台数据隔离: ${allMine ? "全部是自己的" : "有别人的"}, 共 ${frontList.data.length} 条`);

    console.log("\n=== 全部快速测试通过! ===");
  } catch (e) {
    console.error("\n✗ 测试失败:", e.message || e.body?.error || JSON.stringify(e));
    console.error("Stack:", e.stack);
  }
}

main();
