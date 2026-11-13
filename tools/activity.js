'use strict';
// 진행 중인 사용자 작업을 세는 표 (Drain: 작업이 다 끝날 때까지 기다리기 위해).
// 원칙: 작업이 "끝났다"는 사실은 실제 작업 상태에서 읽는다. 별도 카운터를 믿지 않는다.
//   - chat / group-chat : projectRuns(방별 진행 표) + 살아 있는 claude 프로세스 수
//   - export            : 폴더 잠금(만드는 중) + 내려받는 중인 연결
//   - import            : 가져오기 흐름의 받는 중·설치 중·기록 잠금
//   - upload / mutate   : 본문을 받거나 처리 중인 요청 (응답 연결이 닫히면 해제)
const KINDS = ['chat', 'group-chat', 'import', 'export', 'upload', 'mutate'];

function createActivity(sources = {}) {
  const reqs = new Map(); let seq = 0;
  // 요청 하나를 추적한다. 돌려주는 end는 몇 번 불러도 한 번만 해제한다
  function begin(kind, meta = {}) {
    const id = ++seq; reqs.set(id, { kind, since: Date.now(), ...meta });
    let done = false;
    return () => { if (done) return false; done = true; reqs.delete(id); return true; };
  }
  // res가 끝나거나 연결이 끊기면(close는 둘 다에서 난다) 해제
  function trackRes(res, kind, meta) {
    const end = begin(kind, meta);
    res.once('close', end); res.once('finish', end); res.once('error', end);
    return end;
  }
  function snapshot() {
    const by = Object.fromEntries(KINDS.map((k) => [k, 0]));
    const items = [];
    const add = (kind, meta) => { by[kind]++; items.push({ kind, ...meta }); };
    for (const r of (sources.chatRuns ? sources.chatRuns() : [])) add(r.group ? 'group-chat' : 'chat', { room: r.room, since: r.since });
    const children = sources.liveChildren ? sources.liveChildren() : 0;
    const chatCount = by.chat + by['group-chat'];
    if (children > chatCount) { by.chat += children - chatCount; items.push({ kind: 'chat', room: '(프로세스)', note: '표에 없는 살아 있는 claude 프로세스' }); }
    const ex = sources.exportBusy ? sources.exportBusy() : { building: 0, downloading: 0 };
    for (let i = 0; i < ex.building; i++) add('export', { phase: 'building' });
    for (let i = 0; i < ex.downloading; i++) add('export', { phase: 'downloading' });
    const im = sources.importBusy ? sources.importBusy() : { receiving: 0, committing: 0, lock: false };
    if (im.receiving) add('import', { phase: 'receiving' });
    if (im.committing || im.lock) add('import', { phase: 'committing' });
    for (const r of reqs.values()) add(r.kind, { phase: 'request', path: r.path, since: r.since });
    return { total: items.length, by, items };
  }
  return { begin, trackRes, snapshot, KINDS };
}

// 요청 경로 → 작업 종류. 이 표에 없는 변경 요청은 mutate
function kindOfRequest(method, p) {
  if (p === '/api/upload') return 'upload';
  if (p.startsWith('/api/rooms/import/') && method !== 'GET') return 'import';
  if (p === '/api/rooms/export' || p === '/api/rooms/export/file') return 'export';
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null; // 읽기만 하는 요청은 세지 않는다
  if (p === '/api/chat' || p === '/api/stop' || p === '/api/admin/restart' || p === '/api/admin/rollback') return null; // 재시작·되돌리기 요청은 스스로를 기다리지 않게 센 표에 넣지 않는다
   // 답변은 projectRuns가 센다 (응답 연결과 상관없이 끝까지 도는 일)
  return 'mutate';
}

module.exports = { createActivity, kindOfRequest, KINDS };
