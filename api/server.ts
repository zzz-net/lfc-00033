/**
 * local server entry file, for local development
 */
import app from './app.js';
import { recoverReservationLocksOnStartup, startPeriodicLockCleanup, stopPeriodicLockCleanup } from './routes/reservations.js';

console.log('[Bootstrap] 正在初始化预约取件锁定台...');
try {
  const recovery = recoverReservationLocksOnStartup();
  console.log(`[Bootstrap] 锁定台恢复完成：释放过期=${recovery.expired_count}，重建锁定=${recovery.relocked_count}，修复孤立=${recovery.fixed_orphan_equipment}`);
} catch (e) {
  console.error('[Bootstrap] 锁定台启动恢复出错，继续启动：', e);
}

startPeriodicLockCleanup(60 * 1000);

/**
 * start server with port
 */
const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  console.log(`Server ready on port ${PORT}`);
});

/**
 * close server
 */
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received');
  stopPeriodicLockCleanup();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received');
  stopPeriodicLockCleanup();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;