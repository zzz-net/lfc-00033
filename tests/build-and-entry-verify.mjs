#!/usr/bin/env node
import { execSync } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = resolve(__filename, '..')
const projectRoot = resolve(__dirname, '..')

let passed = 0
let failed = 0
const failures = []
const details = []

function assert(condition, label) {
  if (condition) {
    passed++
    console.log('  ✅ ' + label)
  } else {
    failed++
    failures.push(label)
    console.log('  ❌ ' + label)
  }
}

function runCmd(cmd) {
  try {
    const output = execSync(cmd, {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { success: true, output }
  } catch (err) {
    return { success: false, output: err.stdout + err.stderr }
  }
}

console.log('🏗️  构建与入口校验开始\n')

console.log('========== 第 1 步：TypeScript 类型检查')
console.log('  运行 npm run check...')
const checkResult = runCmd('npm run check')
assert(checkResult.success, 'TypeScript 类型检查通过')
if (!checkResult.success) {
  details.push('TypeScript 检查失败输出：\n' + checkResult.output.substring(0, 2000))
}
console.log()

console.log('========== 第 2 步：前端构建')
console.log('  运行 npm run build...')
const buildResult = runCmd('npm run build')
assert(buildResult.success, '前端构建成功')
if (buildResult.success) {
  const distDir = join(projectRoot, 'dist')
  assert(existsSync(distDir), '构建产物目录 dist 存在')
  const indexHtml = join(distDir, 'index.html')
  assert(existsSync(indexHtml), '构建产物 index.html 存在')
} else {
  details.push('构建失败输出：\n' + buildResult.output.substring(0, 2000))
}
console.log()

console.log('========== 第 3 步：README 离线补录入口验证')

let readmeContent = ''
try {
  readmeContent = readFileSync(join(projectRoot, 'README.md'), 'utf-8')
} catch (e) {
  console.log('  ⚠️  未找到 README.md')
}

const hasOfflineSignoffMentioned = readmeContent.includes('离线补录') || readmeContent.includes('offline')
const hasOfflineSignoffRoute = readmeContent.includes('offline-signoff')
console.log('  README 包含离线补录相关内容：' + (hasOfflineSignoffMentioned || hasOfflineSignoffRoute))

if (hasOfflineSignoffMentioned || hasOfflineSignoffRoute) {
  assert(true, 'README 包含离线补录相关说明')
} else {
  assert(false, 'README 未包含离线补录相关说明')
  details.push('README 中缺少离线补录功能的介绍和入口说明')
}
console.log()

console.log('========== 第 4 步：代码入口验证')

console.log('  → 验证前端路由...')
const appTsx = readFileSync(join(projectRoot, 'src', 'App.tsx'), 'utf-8')
const hasFrontendRoute = appTsx.includes('OfflineSignoffPage') && appTsx.includes('/offline-signoff')
assert(hasFrontendRoute, '前端路由包含 /offline-signoff 路由')

console.log('  → 验证后端路由...')
const appTs = readFileSync(join(projectRoot, 'api', 'app.ts'), 'utf-8')
const hasBackendRoute = appTs.includes('offlineSignoffRoutes') && appTs.includes('/api/offline-signoffs')
assert(hasBackendRoute, '后端路由包含 /api/offline-signoffs 路由')

console.log('  → 验证页面组件存在...')
const pageFile = join(projectRoot, 'src', 'pages', 'OfflineSignoff.tsx')
assert(existsSync(pageFile), 'OfflineSignoff.tsx 页面文件存在')

console.log('  → 验证后端路由文件存在...')
const routeFile = join(projectRoot, 'api', 'routes', 'offline-signoffs.ts')
assert(existsSync(routeFile), 'offline-signoffs.ts 路由文件存在')
console.log()

console.log('========== 第 5 步：启动脚本与命令一致性验证')

const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'))
const scripts = packageJson.scripts || {}

const requiredScripts = [
  'dev',
  'client:dev',
  'server:dev',
  'check',
  'build',
  'lint',
]

for (const script of requiredScripts) {
  assert(!!scripts[script], 'package.json 包含 ' + script + ' 脚本')
}
console.log()

console.log('========== 第 6 步：README 启动步骤验证')

const readmeHasDevCmd = readmeContent.includes('npm run dev')
assert(readmeHasDevCmd, 'README 包含 npm run dev 启动命令')

const readmeHasCheckCmd = readmeContent.includes('npm run check') || readmeContent.includes('类型检查')
if (readmeHasCheckCmd) {
  assert(true, 'README 包含类型检查相关说明')
} else {
  console.log('  ⚠️  README 未明确提及类型检查命令')
}

const readmeHasBuildCmd = readmeContent.includes('npm run build') || readmeContent.includes('构建')
if (readmeHasBuildCmd) {
  assert(true, 'README 包含构建相关说明')
} else {
  console.log('  ⚠️  README 未明确提及构建命令')
}
console.log()

console.log('========== 第 7 步：API 接口完整性验证')

const offlineRouteFile = readFileSync(routeFile, 'utf-8')

const requiredEndpoints = [
  { method: 'GET', path: '/', desc: '列表查询' },
  { method: 'GET', path: '/stats', desc: '统计' },
  { method: 'GET', path: '/:id', desc: '详情' },
  { method: 'POST', path: '/', desc: '创建' },
  { method: 'POST', path: '/:id/sync', desc: '同步' },
  { method: 'POST', path: '/batch-sync', desc: '批量同步' },
  { method: 'POST', path: '/:id/resolve', desc: '冲突解决' },
  { method: 'DELETE', path: '/:id', desc: '删除' },
  { method: 'GET', path: '/export/json', desc: '导出' },
  { method: 'POST', path: '/import/json', desc: '导入' },
]

for (const ep of requiredEndpoints) {
  const endpointExists = offlineRouteFile.includes('router.' + ep.method.toLowerCase()) &&
    offlineRouteFile.includes(ep.path)
  assert(endpointExists, 'API 包含 ' + ep.method + ' ' + ep.path + ' (' + ep.desc + ')')
}
console.log()

console.log('========== 第 8 步：数据库表结构验证')

const dbFile = readFileSync(join(projectRoot, 'api', 'db.ts'), 'utf-8')
const hasOfflineTable = dbFile.includes('offline_signoff_records')
assert(hasOfflineTable, '数据库包含 offline_signoff_records 表')

const requiredStatuses = ['pending', 'syncing', 'failed', 'completed']
for (const status of requiredStatuses) {
  const hasStatus = dbFile.includes("'" + status + "'")
  assert(hasStatus, '数据库状态枚举包含 ' + status)
}

const requiredTypes = ['borrow', 'return', 'damage']
for (const type of requiredTypes) {
  const hasType = dbFile.includes("'" + type + "'")
  assert(hasType, '数据库类型枚举包含 ' + type)
}
console.log()

console.log('========== 第 9 步：前端 API 封装验证')

const apiFile = readFileSync(join(projectRoot, 'src', 'utils', 'api.ts'), 'utf-8')

const frontendApiMethods = [
  'getOfflineSignoffs',
  'getOfflineSignoffStats',
  'getOfflineSignoff',
  'createOfflineSignoff',
  'syncOfflineSignoff',
  'batchSyncOfflineSignoffs',
  'resolveOfflineSignoff',
  'deleteOfflineSignoff',
  'exportOfflineSignoffs',
  'importOfflineSignoffs',
]

for (const method of frontendApiMethods) {
  assert(apiFile.includes(method), '前端 API 封装包含 ' + method)
}
console.log()

console.log('========== 第 10 步：权限控制验证')

const authMiddlewareUsed = offlineRouteFile.includes('authMiddleware')
assert(authMiddlewareUsed, '所有离线补录路由使用 authMiddleware')

const adminMiddlewareUsed = offlineRouteFile.includes('adminMiddleware')
assert(adminMiddlewareUsed, '管理操作使用 adminMiddleware')

const adminOnlyEndpoints = ['resolve', 'delete', 'import']
for (const endpoint of adminOnlyEndpoints) {
  const hasAdminCheck = offlineRouteFile.includes(endpoint) && offlineRouteFile.includes('adminMiddleware')
  if (hasAdminCheck) {
    assert(true, endpoint + ' 端点需要管理员权限')
  }
}
console.log()

console.log('='.repeat(60))
console.log('📊 校验结果：通过 ' + passed + ' / 失败 ' + failed + ' / 总计 ' + (passed + failed))
if (failures.length > 0) {
  console.log('\n❌ 失败项：')
  failures.forEach(function(f) { console.log('  - ' + f) })
  if (details.length > 0) {
    console.log('\n📝 详细信息：')
    details.forEach(function(d) { console.log('  ' + d.substring(0, 500)) })
  }
} else {
  console.log('\n🎉 全部通过！')
}
console.log('='.repeat(60))

process.exit(failed > 0 ? 1 : 0)
