'use strict';
// 점검 모드: 배포·교체 같은 일을 하는 동안 새 사용자 작업을 막는다.
// 상태는 DATA_DIR/maintenance.json 한 파일이 전부다 (파일이 있으면 점검 중, 없으면 정상).
//   - 파일이 없다(ENOENT) → 정상. 지우기만 하면 재시작 없이 바로 풀린다.
//   - 파일은 있는데 읽을 수 없거나 내용이 깨졌다 → 안전한 쪽(점검 중)으로 본다. corrupt: true 로 알려 준다.
//   - 쓸 때는 임시 파일에 쓰고 fsync 한 뒤 rename 한다 (반쪽 파일이 보이지 않는다).
// 이 모듈은 HTTP로 상태를 바꾸는 길을 만들지 않는다. 켜고 끄는 일은 tools/gamja-maint.js(파일 쓰기)로만 한다.
const fs = require('fs');
const path = require('path');

const FILE_NAME = 'maintenance.json';
const DEFAULT_MESSAGE = '지금 감자를 점검하고 있어요. 잠시 뒤에 다시 시도해 주세요.';
const MAX_MESSAGE = 300;

// 점검 중에도 막지 않는 /api 경로(와 방법): 로그인 상태 확인, 로그아웃, 점검 상태 보기, 복구 상태 보기, 답변 중지, 재시작·되돌리기
// (복구 길은 점검 중에도 열려 있어야 한다. 재시작은 server.js의 Drain 대기를 거친다). 방법까지 맞아야 통과한다
const ALWAYS_OK = new Map([
  ['/api/me', ['GET']], ['/api/logout', ['POST']], ['/api/maintenance', ['GET']], ['/api/import/recovery', ['GET']],
  ['/api/stop', ['POST']], ['/api/status', ['GET']], ['/api/admin/restart', ['POST']], ['/api/admin/rollback', ['POST']],
]);
// GET이지만 일(zip 만들기·내려받기)을 시작하는 경로
const GET_BLOCKED = (p) => p === '/api/rooms/export' || p === '/api/rooms/export/file';

function validate(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  if (o.v !== 1) return null;
  if (typeof o.since !== 'number' || !Number.isFinite(o.since)) return null;
  if (o.message !== undefined && typeof o.message !== 'string') return null;
  if (o.allowRooms !== undefined && !(Array.isArray(o.allowRooms) && o.allowRooms.every((r) => typeof r === 'string'))) return null;
  return {
    since: o.since,
    message: (o.message || '').slice(0, MAX_MESSAGE) || DEFAULT_MESSAGE,
    reason: typeof o.reason === 'string' ? o.reason.slice(0, 200) : '',
    allowRooms: (o.allowRooms || []).slice(0, 10),
  };
}

// 파일을 한 번 읽어서 상태로 바꾼다 (캐시 없음)
function readState(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return { on: false, corrupt: false };
    return { on: true, corrupt: true, message: DEFAULT_MESSAGE, since: 0, reason: `읽을 수 없음(${(e && e.code) || 'error'})`, allowRooms: [] };
  }
  let v = null;
  try { v = validate(JSON.parse(raw)); } catch { v = null; }
  if (!v) return { on: true, corrupt: true, message: DEFAULT_MESSAGE, since: 0, reason: '점검 파일이 손상됨', allowRooms: [] };
  return { on: true, corrupt: false, ...v };
}

// ttlMs 기본값 0: 요청마다 파일을 읽는다. 기억해 두면 켠 뒤·푼 뒤 최대 ttlMs 동안 옛 상태로 판단해, 켠 뒤에 보낸 쓰기 요청이 통과한다(13.1차 시험으로 확인)
function createMaintenance(dataDir, { ttlMs = 0 } = {}) {
  const file = path.join(dataDir, FILE_NAME);
  let cache = null; let at = 0;
  function state() {
    const now = Date.now();
    if (!cache || ttlMs <= 0 || now - at >= ttlMs || now < at) { cache = readState(file); at = now; }
    return cache;
  }
  // 점검 중이라 이 요청을 막아야 하면 { status, body, headers }, 아니면 null.
  // /api/chat 은 본문을 읽어야 방을 알 수 있어서 여기서는 통과시키고, chatBlocked()가 따로 판단한다
  function check(method, p) {
    const s = state();
    if (!s.on) return null;
    if ((ALWAYS_OK.get(p) || []).includes(method)) return null;
    if (p === '/api/chat' && method === 'POST') return null;
    if (method === 'GET' && !GET_BLOCKED(p)) return null;
    return block(s);
  }
  function block(s) {
    return { status: 503, body: { error: s.message, code: 'maintenance', corrupt: s.corrupt }, headers: { 'Retry-After': '5' } };
  }
  function chatBlocked(room) {
    const s = state();
    if (!s.on) return null;
    if (!s.corrupt && s.allowRooms.includes(String(room))) return null; // 점검 파일이 정상일 때만, 지정한 작업방(운영자 방)은 열어 둔다
    return block(s);
  }
  const publicInfo = () => { const s = state(); return s.on ? { on: true, message: s.message, since: s.since, corrupt: s.corrupt } : { on: false }; };
  return { state, check, chatBlocked, publicInfo, file };
}

// ---- 파일 쓰기 (gamja-maint.js가 쓴다) ----
function writeState(dataDir, { message, reason, allowRooms } = {}) {
  const file = path.join(dataDir, FILE_NAME);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const prev = readState(file);
  const body = { v: 1, since: prev.on && !prev.corrupt ? prev.since : Date.now(), message: String(message || DEFAULT_MESSAGE).slice(0, MAX_MESSAGE), reason: String(reason || '').slice(0, 200), allowRooms: Array.isArray(allowRooms) ? allowRooms.map(String) : [] };
  const fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeSync(fd, JSON.stringify(body)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  try { const dfd = fs.openSync(dataDir, 'r'); try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); } } catch { /* 폴더 fsync가 안 되는 곳 */ }
  return body;
}
function clearState(dataDir) {
  const file = path.join(dataDir, FILE_NAME);
  fs.rmSync(file, { force: true });
  try { for (const f of fs.readdirSync(dataDir)) if (f.startsWith(FILE_NAME + '.') && f.endsWith('.tmp')) fs.rmSync(path.join(dataDir, f), { force: true }); } catch { /* 폴더 없음 */ }
}

module.exports = { createMaintenance, readState, writeState, clearState, FILE_NAME, DEFAULT_MESSAGE };
