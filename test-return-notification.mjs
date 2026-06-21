// 快速测试：归还设备是否返回 next_reservation
const BASE = "http://localhost:3001/api";

async function req(path, method = "GET", body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, ...data };
}

async function main() {
  console.log("=== 归还 + 预约通知联动测试 ===");

  // 1. 登录 admin
  const login = await req("/auth/login", "POST", { username: "admin", password: "admin123" });
  console.log("登录:", login.success, "token:", login.data?.token ? "有" : "无");
  const token = login.data?.token;
  if (!token) { console.error("登录失败"); return; }

  // 2. 找一台已借出且有预约的设备
  const reservations = await req("/reservations", "GET", null, token);
  console.log("预约数量:", reservations.data?.length);
  
  // 找到一个有排队中预约的设备
  const queued = reservations.data?.filter(r => r.status === "queued") || [];
  console.log("排队中预约:", queued.length);
  
  if (queued.length === 0) {
    console.log("没有排队中的预约，跳过归还测试");
    return;
  }

  const targetReservation = queued[0];
  const equipmentId = targetReservation.equipment_id;
  console.log("目标设备 ID:", equipmentId);
  console.log("目标预约:", targetReservation.borrower_name, targetReservation.status);

  // 3. 查找该设备当前的 active borrow
  const borrows = await req("/borrows?status=active", "GET", null, token);
  const activeBorrow = borrows.data?.find(b => b.equipment_id === equipmentId);
  console.log("该设备是否有 active borrow:", !!activeBorrow);
  
  if (!activeBorrow) {
    console.log("该设备当前未借出，无法测试归还");
    
    // 尝试借一台设备然后创建预约
    console.log("\n--- 走备用流程：先借出再预约再归还 ---");
    const equips = await req(`/equipments?status=available&page_size=5`, "GET", null, token);
    const availEquip = equips.data?.items?.[0] || equips.data?.[0];
    if (!availEquip) { console.log("没有可用设备"); return; }
    console.log("可用设备:", availEquip.id, availEquip.name);
    
    const borrowRes = await req("/borrows", "POST", {
      equipment_id: availEquip.id,
      borrower_name: "测试归还联动",
      borrower_phone: "13800001111",
      deposit_amount: 100,
    }, token);
    console.log("借出结果:", borrowRes.success, borrowRes.error || "");
    
    const r1 = await req("/reservations", "POST", {
      equipment_id: availEquip.id,
      borrower_name: "下一位预约人",
      borrower_phone: "13900002222",
      expected_pickup_time: new Date(Date.now() + 86400000).toISOString(),
      remark: "测试归还通知",
    }, token);
    console.log("创建预约:", r1.success, r1.error || "");
    
    const borrowId = borrowRes.data?.id;
    if (!borrowId) { console.log("借出失败"); return; }
    
    const returnRes = await req(`/borrows/${borrowId}/return`, "PUT", null, token);
    console.log("\n归还 API 返回状态:", returnRes.status);
    console.log("success:", returnRes.success);
    console.log("data keys:", returnRes.data ? Object.keys(returnRes.data) : "无");
    console.log("next_reservation:", returnRes.next_reservation ? 
      `有! 预约人=${returnRes.next_reservation.borrower_name}, 状态=${returnRes.next_reservation.status}` 
      : "无"
    );
    console.log("完整响应 keys:", Object.keys(returnRes));
    return;
  }

  // 4. 归还该设备
  const returnRes = await req(`/borrows/${activeBorrow.id}/return`, "PUT", null, token);
  console.log("\n归还 API 返回状态:", returnRes.status);
  console.log("success:", returnRes.success);
  console.log("data keys:", returnRes.data ? Object.keys(returnRes.data) : "无");
  console.log("next_reservation:", returnRes.next_reservation ? 
    `有! 预约人=${returnRes.next_reservation.borrower_name}, 状态=${returnRes.next_reservation.status}` 
    : "无"
  );
  console.log("完整响应 keys:", Object.keys(returnRes));
}

main().catch(e => console.error("测试异常:", e));
