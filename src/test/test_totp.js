/**
 * TOTP 算法自检：RFC 6238 官方测试向量（SHA1）。
 * 运行：node src/test/test_totp.js
 */
import { base32Encode, base32Decode, totpCode, verifyTotp, generateSecret, otpauthUri,
  generateBackupCodes, hashBackupCodes, consumeBackupCode } from '../middleware/totp.js';

let fail = 0;
function check(cond, msg) { if (!cond) { fail++; console.error('FAIL:', msg); } }

// RFC 6238 SHA1 seed = ASCII "12345678901234567890"
const SEED = new TextEncoder().encode('12345678901234567890');
const SECRET = base32Encode(SEED);
check(SECRET === 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', `base32 种子应为 GEZD...，实际 ${SECRET}`);

// 官方向量（取 6 位 = 8 位码的后 6 位）
const vectors = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
];
for (const [t, expected] of vectors) {
  const code = await totpCode(SECRET, Math.floor(t / 30));
  check(code === expected, `t=${t}: 期望 ${expected}，实际 ${code}`);
}

// base32 往返
const rt = base32Encode(base32Decode(SECRET));
check(rt === SECRET, `base32 往返一致：${rt}`);

// verifyTotp 接受当前码、拒绝错码
const now = Math.floor(Date.now() / 1000);
const live = await totpCode(SECRET, Math.floor(now / 30));
check(await verifyTotp(SECRET, live), 'verifyTotp 应接受当前码');
check(!(await verifyTotp(SECRET, '000000')), 'verifyTotp 应拒绝明显错码');
check(!(await verifyTotp(SECRET, 'abc')), 'verifyTotp 应拒绝非法格式');

// 密钥与 URI
check(generateSecret().length >= 32, 'generateSecret 长度 >= 32');
check(otpauthUri('a@local.test', SECRET).startsWith('otpauth://totp/'), 'otpauthUri 前缀');

// 备份码
const plain = generateBackupCodes(10);
check(plain.length === 10, '应生成 10 个备份码');
check(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/.test(plain[0]), `备份码格式 XXXX-XXXX，实际 ${plain[0]}`);
const hashed = await hashBackupCodes(plain);
check(hashed.length === 10 && hashed[0].startsWith('pbkdf2:'), '备份码应哈希存');
const r1 = await consumeBackupCode(hashed, plain[0]);
check(r1.ok && r1.remaining.length === 9, '用掉一个码后剩 9 个');
const r2 = await consumeBackupCode(r1.remaining, plain[0]);
check(!r2.ok, '同一码不可重复使用');
const r3 = await consumeBackupCode(hashed, 'ZZZZ-ZZZZ');
check(!r3.ok, '不存在的码应被拒');

if (fail) { console.error(`\n❌ TOTP 自检失败：${fail} 项`); process.exit(1); }
console.log('✅ TOTP 自检全部通过（RFC6238 向量 + base32 + verify + URI + 备份码）');
