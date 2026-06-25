/**
 * App 模块入口
 * @module modules/app
 */

export * from './ui-helpers.js';
export * from './confirm-dialog.js';
export * from './auto-refresh.js';
export * from './random-name.js';
export * from './mailbox-state.js';
export * from './email-list.js';
export * from './mailbox-list.js';
export * from './session.js';
export * from './domains.js';
export * from './compose.js';

// 导入并重新导出默认对象
import uiHelpers from './ui-helpers.js';
import confirmDialog from './confirm-dialog.js';
import autoRefresh from './auto-refresh.js';
import randomName from './random-name.js';
import mailboxState from './mailbox-state.js';
import emailListModule from './email-list.js';
import mailboxListModule from './mailbox-list.js';
import session from './session.js';
import domains from './domains.js';
import compose from './compose.js';

export {
  uiHelpers,
  confirmDialog,
  autoRefresh,
  randomName,
  mailboxState,
  emailListModule,
  mailboxListModule,
  session,
  domains,
  compose
};
