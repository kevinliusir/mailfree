/**
 * 数据库模块统一导出
 * @module db
 */

export { initDatabase, setupDatabase } from './init.js';
export { getDatabaseWithValidation, getInitializedDatabase } from './connection.js';
export {
  getOrCreateMailboxId,
  getMailboxIdByAddress,
  checkMailboxOwnership,
  toggleMailboxPin,
  getTotalMailboxCount,
  getForwardTarget,
  getMailboxTotp,
  setMailboxTotp,
  clearMailboxTotp
} from './mailboxes.js';
export {
  createUser,
  updateUser,
  deleteUser,
  listUsersWithCounts,
  getUserStats,
  assignMailboxToUser,
  getUserMailboxes,
  unassignMailboxFromUser,
  getUserTotp,
  getUserTotpByUsername,
  setUserTotp,
  clearUserTotp
} from './users.js';
export {
  recordSentEmail,
  updateSentEmail
} from './sentEmails.js';
