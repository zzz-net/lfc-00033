# 诊所设备借还管理系统

本地诊所可周转设备（轮椅、雾化器等）借用与归还管理桌面系统。

## 功能特性

- **设备台账**：设备列表、新增设备、编辑设备，支持按名称、类型、状态筛选
- **借出操作**：选择可用设备、填写借用人信息、自动冻结押金
- **归还操作**：选择借出记录、自动退还押金
- **损坏管理**：前台登记损坏待确认、管理员确认损坏并扣减押金
- **押金流水**：冻结 / 退还 / 扣减流水记录，支持按设备、借用人、类型筛选
- **设备详情**：押金变化时间线、每次操作人信息
- **离线补录台**：断网时离线登记借出/归还/损坏，联网后批量同步，支持冲突检测与解决、JSON 导入导出
- **预约排队**：已借出设备可预约排队，归还后自动锁定下一位取件人
- **CSV 导出**：管理员可导出台账、借还记录、押金流水 CSV 文件
- **权限控制**：
  - 前台：办理借出、归还、查看台账和流水
  - 管理员：前台全部权限 + 确认损坏 + 调整台账 + 导出记录

## 技术栈

- **前端**：React 18 + TypeScript + TailwindCSS 3 + Vite + Zustand + Lucide Icons
- **后端**：Express 4 + TypeScript (tsx)
- **数据库**：SQLite (better-sqlite3)，数据持久化存储在 `data/clinic.db`
- **认证**：JWT (jsonwebtoken) + bcryptjs 密码哈希

## 本地启动

### 前置要求

- Node.js >= 18

### 安装依赖

```bash
npm install
```

### 启动开发环境

```bash
npm run dev
```

该命令会同时启动：
- **前端**：http://localhost:5173 （Vite 开发服务器）
- **后端**：http://localhost:3001 （Express + tsx + nodemon）

### 首次启动

首次启动会自动：
1. 在项目根目录创建 `data/clinic.db` SQLite 数据库文件
2. 自动创建所有数据表
3. 自动注入样例账号和初始设备数据

### 样例账号

| 角色 | 用户名 | 密码 |
|------|--------|------|
| 管理员 | `admin` | `admin123` |
| 前台 | `front_desk` | `front123` |

### 初始样例设备

| 名称 | 类型 | 押金 |
|------|------|------|
| 轮椅-001 | 轮椅 | ¥200.00 |
| 轮椅-002 | 轮椅 | ¥200.00 |
| 雾化器-001 | 雾化器 | ¥150.00 |
| 血压计-001 | 血压计 | ¥100.00 |

## 验收指南

### 主流程：新增设备 → 借出 → 归还

1. 以 `admin` 登录，在「设备台账」点击「添加设备」，填写名称、类型、押金
2. 在「借还操作」→「借出」Tab，选择刚新增的设备，填写借用人姓名和电话，点击「确认借出」
3. 回到「设备台账」，设备状态变为「已借出」
4. 在「借还操作」→「归还」Tab，找到刚才的借出记录，点击「归还」
5. 回到「设备台账」，设备状态恢复为「可用」
6. 进入「押金流水」，应能看到冻结 + 退还两条记录，操作人正确显示

### 边界情况验证

1. **借用已借出设备**：尝试借出一台状态为「已借出」的设备 → 应弹出错误提示，余额不变
2. **重复退押金**：对一条已归还的记录再次点击「归还」 → 应弹出错误提示 "该记录已归还，不可重复操作"，余额不变
3. **非管理员确认损坏**：使用 `front_desk` 账号登录，尝试确认损坏 → 应被禁止，余额不变

### 数据一致性验证

1. 办理若干借还操作后，关闭浏览器和终端
2. 重新 `npm run dev` 启动
3. 验证设备状态、借用人、押金流水、筛选结果与关闭前完全一致
4. 管理员登录后导出三类 CSV，内容应与界面数据一致

## 项目结构

```
.
├── api/                    # 后端代码
│   ├── middleware/         # 认证中间件
│   ├── routes/             # API 路由（auth/equipments/borrows/deposits/export）
│   ├── db.ts               # SQLite 数据库初始化
│   ├── app.ts              # Express 应用配置
│   └── server.ts           # 本地服务启动入口
├── src/                    # 前端代码
│   ├── components/         # 复用组件（Layout/Modal/Drawer/Toast）
│   ├── pages/              # 页面（Login/Equipment/BorrowReturn/DepositLog）
│   ├── store/              # Zustand 状态管理
│   ├── utils/              # API 封装、工具函数
│   ├── types/              # TypeScript 类型定义
│   └── App.tsx             # 路由配置
├── data/                   # SQLite 数据库文件目录（运行时生成）
└── README.md
```

## API 概览

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/api/auth/login` | 公开 | 登录获取 JWT |
| GET | `/api/auth/me` | 登录 | 获取当前用户 |
| GET | `/api/equipments` | 登录 | 设备列表（支持 status/name/type 筛选） |
| POST | `/api/equipments` | admin | 新建设备 |
| PUT | `/api/equipments/:id` | admin | 更新设备 |
| GET | `/api/equipments/:id/detail` | 登录 | 设备详情（含押金流水和操作日志） |
| POST | `/api/borrows` | 登录 | 借出设备 |
| PUT | `/api/borrows/:id/return` | 登录 | 归还设备 |
| PUT | `/api/borrows/:id/damage` | 登录 | 报损设备（标记待确认） |
| PUT | `/api/borrows/:id/confirm-damage` | admin | 确认损坏（扣减押金） |
| GET | `/api/borrows` | 登录 | 借还记录列表（支持筛选） |
| GET | `/api/deposits` | 登录 | 押金流水列表（支持筛选） |
| GET | `/api/export/equipments` | admin | 导出台账 CSV |
| GET | `/api/export/borrows` | admin | 导出借还 CSV |
| GET | `/api/export/deposits` | admin | 导出押金 CSV |

## 常用命令

```bash
npm run dev          # 启动前端+后端开发服务器
npm run client:dev   # 仅启动前端
npm run server:dev   # 仅启动后端
npm run check        # TypeScript 类型检查
npm run build        # 前端构建
npm run lint         # ESLint 检查
```
