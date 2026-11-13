#!/usr/bin/env node
'use strict';
// 첫 운영 병합(절차 C) 도구. 운영 감자알에 점검 모드가 없을 때를 위한 것이다. 쓰려면 성호의 별도 승인이 필요하다.
//   preflight --candidate <폴더> --manifest <파일> --base <파일> --port N [--confirm-no-transfer]    사전 점검만 (아무것도 바꾸지 않는다)
//   apply     (preflight와 같은 옵션) [--step-delay-ms N(시험용)]   사전 점검 → 백업(.env·data 포함)·복원 연습 → 안정 버전 심기 → 파일 교체 → restart-request, 한 번에
//   verify    --port N                 재시작 뒤 사람 대신 읽기 전용으로 확인 (새 코드로 도는지, 화면 파일이 맞는지, 기존 대화·크루가 그대로인지)
//   restore   --port N [--no-restart] [--force-kill]  백업한 파일로 되돌리기(+검사 뒤 재시작 요청). 이 도구가 새로 만든 파일만 지운다. data·.env는 건드리지 않는다
//             --force-kill: 로그인·재시작 API까지 깨졌을 때만 쓰는 마지막 수단(감자알 프로세스를 끝내 start.sh가 다시 켜게 함)
//   status
// 공통: --app <코드 폴더> --data <DATA_DIR>. 비밀번호는 환경변수 APP_PASSWORD 또는 <앱>/.env 에서 읽고 출력하지 않는다.
// 종료 코드: 0 성공, 4 사전 점검 실패(아무것도 바뀌지 않음), 5 교체 실패(자동 복원함), 6 verify 실패·restore 확인 실패
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
// 비밀번호·쿠키가 출력으로 나가지 않게 출력 단계에서 가린다 (tools/redact.js). 디버그 출력을 나중에 넣어도 가려진다
const TM = require('./test-mode');
const FAULT = (TM.ON && process.env.GAMJA_SUPERVISED !== '1') ? TM.env('FM_FAULT') : undefined; // 시험 전용. 운영(start.sh 감시 아래)에서는 켜지지 않는다
const redactor = require('./redact').createRedactor();
redactor.install();

const SKIP_TOP = new Set(['data', '.env', 'node_modules', '.git']); // server.js와 같아야 한다
const DATA_SKIP = new Set(['test-work', 'versions', 'first-merge-backup', 'deploy-backup', 'public-export']); // 백업에서 뺀다 (크거나 다시 만들 수 있는 것)
const ABSENT = '0'.repeat(64);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const shaFile = (f) => { try { return sha256(fs.readFileSync(f)); } catch (e) { return e.code === 'ENOENT' ? ABSENT : 'unreadable'; } };
function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const v = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true; o[a.slice(2)] = v; } else o._.push(a);
  }
  return o;
}
function writeJson(file, obj) {
  const tmp = `${file}.tmp-${process.pid}`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeSync(fd, JSON.stringify(obj, null, 1)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
function readList(file) { // "sha256␣␣경로" 줄들
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([0-9a-f]{64})\s+(\S.*)$/);
    if (!m) { if (line.trim()) throw new Error(`목록 줄을 읽을 수 없어요: ${line.slice(0, 60)}`); continue; }
    if (m[2].startsWith('/') || m[2].split('/').includes('..') || SKIP_TOP.has(m[2].split('/')[0])) throw new Error(`허용되지 않는 경로: ${m[2]}`);
    out.push({ rel: m[2], sha: m[1] });
  }
  return out;
}
const orderKey = (rel) => (rel.startsWith('tools/') ? 0 : rel === 'server.js' ? 1 : rel === 'public/style.css' ? 2 : rel === 'public/i18n.js' ? 3 : rel === 'public/app.js' ? 4 : rel.startsWith('public/') ? 5 : 0); // 화면은 마지막에, 화면 중에서도 index.html·app.js가 가장 뒤
const fail = (code, obj) => { console.log(JSON.stringify({ ok: false, ...obj })); process.exit(code); };
const out = (obj) => console.log(JSON.stringify({ ok: true, ...obj }));

function req(port, method, p, { cookie, body, timeout = 5000 } = {}) {
  return new Promise((res) => {
    const b = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port, path: p, method, timeout, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(b ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } : {}) } }, (rs) => {
      const c = []; rs.on('data', (x) => c.push(x));
      rs.on('end', () => { const buf = Buffer.concat(c); let j = {}; try { j = JSON.parse(buf); } catch (_) {} res({ status: rs.statusCode, json: j, buf, headers: rs.headers }); });
    });
    r.on('error', () => res({ status: 0, json: {}, buf: Buffer.alloc(0), headers: {} }));
    r.on('timeout', () => r.destroy());
    r.end(b);
  });
}
function loadPassword(app) { // 감자알이 시작할 때 읽는 <앱>/.env 를 먼저 본다 (이 도구를 돌리는 셸의 환경변수는 다른 값일 수 있다)
  let pw = '';
  try { const m = fs.readFileSync(path.join(app, '.env'), 'utf8').match(/^\s*(?:export\s+)?APP_PASSWORD=(.*)$/m); if (m) pw = m[1].trim().replace(/^['"]|['"]$/g, ''); } catch (_) {}
  redactor.add(pw); redactor.add(process.env.APP_PASSWORD || ''); // 어느 쪽 값이든 출력에서 가린다
  return pw || process.env.APP_PASSWORD || '';
}
async function login(port, pw) {
  if (!pw) return '';
  redactor.add(pw);
  const r = await req(port, 'POST', '/api/login', { body: { password: pw } });
  const ck = r.status === 200 ? String((r.headers['set-cookie'] || [])[0] || '').split(';')[0] : '';
  const val = ck.split('=').slice(1).join('='); if (val) redactor.add(val); // 세션 쿠키 값도 가린다
  return ck;
}
// /proc에서 이 앱 폴더에서 돌고 있는 감자알(node server.js)을 찾는다
function findServer(app) {
  const real = fs.realpathSync(app);
  for (const n of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(n)) continue;
    try {
      const cmd = fs.readFileSync(`/proc/${n}/cmdline`, 'utf8').split('\0');
      if (!/node/.test(path.basename(cmd[0])) || path.basename(cmd[1] || '') !== 'server.js') continue;
      if (fs.realpathSync(`/proc/${n}/cwd`) !== real) continue;
      return { pid: Number(n) };
    } catch (_) {}
  }
  return null;
}
function childrenOf(pid) {
  const l = [];
  for (const n of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(n)) continue;
    try { const st = fs.readFileSync(`/proc/${n}/stat`, 'utf8'); const f = st.slice(st.lastIndexOf(')') + 2).split(' '); if (Number(f[1]) === pid) l.push(path.basename(fs.readFileSync(`/proc/${n}/cmdline`, 'utf8').split('\0')[0] || '?')); } catch (_) {}
  }
  return l;
}
function established(port) { // 이 포트로 연결된 소켓 수 (참고용: 브라우저가 열어 둔 연결도 포함)
  let n = 0; const hex = port.toString(16).toUpperCase().padStart(4, '0');
  for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) { try { for (const line of fs.readFileSync(f, 'utf8').split('\n').slice(1)) { const c = line.trim().split(/\s+/); if (c[3] === '01' && c[1] && c[1].endsWith(':' + hex)) n++; } } catch (_) {} }
  return n;
}
function copyModes(src, dst) {
  const st = fs.lstatSync(src);
  if (st.isSymbolicLink()) return;
  fs.chmodSync(dst, st.mode & 0o777);
  if (st.isDirectory()) for (const n of fs.readdirSync(src)) copyModes(path.join(src, n), path.join(dst, n));
}
function copyCodeTree(app, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const name of fs.readdirSync(app)) {
    if (SKIP_TOP.has(name)) continue;
    fs.cpSync(path.join(app, name), path.join(dest, name), { recursive: true });
    copyModes(path.join(app, name), path.join(dest, name)); // cpSync는 umask 때문에 권한이 달라질 수 있어 원본 권한을 그대로 맞춘다
    if (FAULT === 'seed-error-mid' && ++n >= 2) throw Object.assign(new Error('ENOSPC: no space left on device (시험 주입)'), { code: 'ENOSPC' });
    if (FAULT === 'seed-kill-mid' && ++n >= 2) process.kill(process.pid, 'SIGKILL');
  }
}
// 코드 트리 전체의 목록: 종류(파일·폴더·링크), 권한, 지문(파일) 또는 링크 대상
function treeManifest(root, skipTop) {
  const m = new Map();
  (function w(d, rel) {
    for (const n of fs.readdirSync(d).sort()) {
      if (!rel && skipTop && skipTop.has(n)) continue;
      const f = path.join(d, n); const st = fs.lstatSync(f); const r = rel + n;
      if (st.isSymbolicLink()) m.set(r, `l ${fs.readlinkSync(f)}`);
      else if (st.isDirectory()) { m.set(r + '/', `d ${(st.mode & 0o777).toString(8)}`); w(f, r + '/'); }
      else if (st.isFile()) m.set(r, `f ${(st.mode & 0o777).toString(8)} ${shaFile(f)}`);
    }
  })(root, '');
  return m;
}
function diffManifests(a, b) { // a(원본)와 b(복사본)가 다른 곳
  const d = [];
  for (const [k, v] of a) { if (!b.has(k)) d.push('없음: ' + k); else if (b.get(k) !== v) d.push('다름: ' + k); }
  for (const k of b.keys()) if (!a.has(k)) d.push('더 있음: ' + k);
  return d;
}
function walkFiles(dir, skipTop) {
  const l = [];
  (function w(d, rel) { for (const n of fs.readdirSync(d)) { if (!rel && skipTop && skipTop.has(n)) continue; const f = path.join(d, n); const st = fs.lstatSync(f); if (st.isDirectory()) w(f, rel + n + '/'); else if (st.isFile()) l.push(rel + n); } })(dir, '');
  return l.sort();
}
function setup(a) {
  if (!a.app || !a.data) fail(4, { code: 'usage', msg: '--app 과 --data 가 필요해요' });
  const app = path.resolve(a.app), data = path.resolve(a.data);
  return { app, data, journal: path.join(data, 'first-merge-journal.json'), flag: path.join(data, 'restart-request'), bkRoot: path.join(data, 'first-merge-backup') };
}
function loadPlan(a) {
  if (!a.candidate || !a.manifest) fail(4, { code: 'usage', msg: '--candidate 와 --manifest 가 필요해요' });
  return { cand: path.resolve(a.candidate), list: readList(a.manifest).sort((x, y) => orderKey(x.rel) - orderKey(y.rel) || (x.rel < y.rel ? -1 : 1)), base: a.base ? readList(a.base) : null };
}

async function preflight(a, P, plan) {
  const checks = []; const add = (id, ok, detail) => checks.push({ id, ok: !!ok, detail });
  const bad = plan.list.filter((e) => shaFile(path.join(plan.cand, e.rel)) !== e.sha);
  add('candidate-matches-manifest', !bad.length && plan.list.length > 0, bad.length ? `다른 파일: ${bad.slice(0, 5).map((e) => e.rel).join(', ')}` : `${plan.list.length}개`);
  if (plan.base) {
    const diff = plan.base.filter((e) => shaFile(path.join(P.app, e.rel)) !== e.sha);
    add('production-fingerprint-matches-base', !diff.length, diff.length ? `기준과 다른 운영 파일: ${diff.slice(0, 5).map((e) => e.rel).join(', ')}` : `${plan.base.length}개 같음`);
    const unlisted = plan.list.filter((e) => !plan.base.some((b) => b.rel === e.rel));
    add('every-replaced-file-has-a-base', !unlisted.length, unlisted.length ? `기준 없는 교체 대상: ${unlisted.map((e) => e.rel).join(', ')}` : '');
  } else add('production-fingerprint-matches-base', false, '--base 가 없어요');
  const j = readJson(P.journal);
  add('no-unfinished-merge', !j || !['swapping', 'swapped-unverified', 'restore-failed'].includes(j.phase), j ? `이전 기록 상태: ${j.phase}` : '');
  add('no-pending-restart-request', !fs.existsSync(P.flag), fs.existsSync(P.flag) ? 'data/restart-request 가 이미 있어요' : '');
  const s = findServer(P.app);
  add('server-running', !!s, s ? `pid ${s.pid}` : '이 폴더에서 도는 감자알을 찾지 못했어요');
  const me = await req(a.port, 'GET', '/api/me');
  const upSec = me.status === 200 && me.json.boot ? Math.floor((Date.now() - me.json.boot) / 1000) : -1; // /api/me의 boot = 감자알이 켜진 시각(ms). /proc 시간은 proot에서 어긋난다
  add('server-up-30s-or-more', upSec >= 30, `${upSec}초`);
  add('server-answers', me.status === 200, `HTTP ${me.status}`);
  const kids = s ? childrenOf(s.pid) : ['?'];
  add('no-claude-child-processes', kids.length === 0, kids.length ? `자식 프로세스 ${kids.join(',')}` : '0건');
  const pw = loadPassword(P.app); const cookie = me.status === 200 ? await login(a.port, pw) : '';
  add('login-for-readonly-checks', !!cookie, cookie ? 'ok' : '비밀번호로 로그인하지 못했어요 (진행 중 답변을 확인할 수 없음)');
  let rooms = [];
  if (cookie) {
    const ch = await req(a.port, 'GET', '/api/chats', { cookie }); rooms = Array.isArray(ch.json.chats) ? ch.json.chats : [];
    const running = rooms.filter((r) => r.running).map((r) => r.name);
    add('no-chat-running', ch.status === 200 && !running.length, ch.status !== 200 ? `HTTP ${ch.status}` : running.length ? `진행 중: ${running.slice(0, 5).join(', ')}` : `${rooms.length}개 방 모두 대기`);
  }
  const cs = established(a.port);
  add('no-transfer-confirmed-by-human', a['confirm-no-transfer'] === true, `연결 ${cs}개 (옛 감자알은 내보내기·업로드 진행을 알려 주지 않아요. 사람이 확인하고 --confirm-no-transfer 를 붙여야 해요)`);
  for (const [dir, label] of [['import-journal', '가져오기 기록'], ['import-tmp', '가져오기 임시']]) { try { const n = fs.readdirSync(path.join(P.data, dir)).filter((x) => !x.startsWith('.')); if (dir === 'import-journal') add('no-unfinished-import', !n.some((x) => { const r = readJson(path.join(P.data, dir, x)); return r && r.phase && !['done', 'cancelled', 'rolled-back'].includes(r.phase); }), `${label} ${n.length}개`); } catch (_) {} }
  let need = 0; try { for (const f of walkFiles(P.data, DATA_SKIP)) need += fs.statSync(path.join(P.data, f)).size; } catch (_) {}
  try { for (const f of walkFiles(P.app, SKIP_TOP)) need += fs.statSync(path.join(P.app, f)).size; } catch (_) {} // 안정 버전(코드 전체 복사본)과 .seed 임시 복사본 몫
  let free = Infinity; try { const sf = fs.statfsSync(P.data); free = sf.bavail * sf.bsize; } catch (_) {}
  add('enough-disk-for-backup', free > need * 2 + 50e6, `백업 약 ${(need / 1e6).toFixed(1)}MB, 여유 ${free === Infinity ? '?' : (free / 1e6).toFixed(0) + 'MB'}`);
  add('env-file-present-for-backup', fs.existsSync(path.join(P.app, '.env')), '.env');
  return { checks, ok: checks.every((c) => c.ok), rooms, cookie, server: s };
}

function restoreFiles(P, j) { // 백업으로 되돌린다. 이 도구가 새로 만든 파일만 지운다
  const errs = []; const bk = path.join(P.bkRoot, j.id, 'app');
  for (const e of j.files) {
    const dst = path.join(P.app, e.rel);
    try {
      fs.rmSync(dst + '.fm-new', { force: true });
      if (e.before === ABSENT) { if (shaFile(dst) === e.after) fs.rmSync(dst, { force: true }); else if (shaFile(dst) !== ABSENT) errs.push(`지우지 않음(내용이 달라요): ${e.rel}`); continue; }
      const src = path.join(bk, e.rel);
      if (shaFile(src) !== e.before) { errs.push(`백업이 손상됐어요: ${e.rel}`); continue; }
      if (shaFile(dst) === e.before) continue;
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst + '.fm-new'); const fd = fs.openSync(dst + '.fm-new', 'r'); fs.fsyncSync(fd); fs.closeSync(fd);
      fs.renameSync(dst + '.fm-new', dst);
      if (shaFile(dst) !== e.before) errs.push(`복원 뒤 지문이 달라요: ${e.rel}`);
    } catch (err) { errs.push(`${e.rel}: ${err.message}`); }
  }
  return errs;
}

async function apply(a, P, plan) {
  const pf = await preflight(a, P, plan);
  if (!pf.ok) fail(4, { code: 'preflight-failed', failed: pf.checks.filter((c) => !c.ok), checks: pf.checks });
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const j = { v: 1, id, phase: 'backing-up', t0: Date.now(), candidate: plan.cand, files: plan.list.map((e) => ({ rel: e.rel, after: e.sha, before: shaFile(path.join(P.app, e.rel)) })), pre: { boot: (await req(a.port, 'GET', '/api/me')).json.boot, rooms: {} } };
  j.pre.last = {};
  for (const r of pf.rooms) { const st = await req(a.port, 'GET', `/api/status?project=${encodeURIComponent(r.name)}`, { cookie: pf.cookie }); j.pre.rooms[r.name] = st.json.count; if (r.last && r.last.text) j.pre.last[r.name] = r.last.text; }
  fs.mkdirSync(P.bkRoot, { recursive: true });
  writeJson(P.journal, j);
  // 1) 백업: 바뀔 파일 + .env + data (시험·버전·기존 백업 제외). 복사한 모든 파일의 지문을 원본과 다시 비교한다
  const bk = path.join(P.bkRoot, id); const bad = [];
  try {
    for (const e of j.files) if (e.before !== ABSENT) { const d = path.join(bk, 'app', e.rel); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(P.app, e.rel), d); if (shaFile(d) !== e.before) bad.push(e.rel); }
    if (fs.existsSync(path.join(P.app, '.env'))) { fs.mkdirSync(path.join(bk, 'env'), { recursive: true }); fs.copyFileSync(path.join(P.app, '.env'), path.join(bk, 'env', '.env')); fs.chmodSync(path.join(bk, 'env', '.env'), 0o600); if (shaFile(path.join(bk, 'env', '.env')) !== shaFile(path.join(P.app, '.env'))) bad.push('.env'); }
    for (const f of walkFiles(P.data, DATA_SKIP)) { const s = path.join(P.data, f); const d = path.join(bk, 'data', f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, d); if (shaFile(d) !== shaFile(s)) bad.push('data/' + f); }
    // 복원 연습: 백업만으로 옛 파일 세트를 임시 폴더에 다시 만들 수 있는지 (기준 지문과 같은지)
    const rh = path.join(bk, 'rehearsal'); const rbad = [];
    for (const e of j.files) if (e.before !== ABSENT) { const d = path.join(rh, e.rel); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(bk, 'app', e.rel), d); if (shaFile(d) !== e.before) rbad.push(e.rel); }
    fs.rmSync(rh, { recursive: true, force: true });
    if (rbad.length) bad.push('복원 연습 실패: ' + rbad.join(','));
  } catch (err) { bad.push(err.message); }
  if (bad.length) { j.phase = 'backup-failed'; writeJson(P.journal, j); fail(4, { code: 'backup-failed', bad: bad.slice(0, 10) }); }
  // 2) 복구 장치 심기: start.sh의 자동 복구와 rollback()이 쓰는 data/versions 에 "지금 코드"를 안정 버전으로 남긴다.
  //    (옛 감자알은 코드 폴더 안의 data/versions 에 저장하지 못하는 버그가 있어서, 이게 없으면 새 코드가 기동 때 죽어도 자동 복구가 없다)
  // 숨김 임시 폴더(.seed-…)에 전체를 복사하고, 원본과 목록·권한·지문이 모두 같은지 확인한 뒤에야 이름을 바꿔 나타낸다.
  // 도중에 끊기거나 디스크가 차도 반쪽 폴더가 안정 버전처럼 보이지 않는다(start.sh 자동 복구는 data/versions 의 가장 새 폴더를 그대로 되돌린다).
  // 실패하면 아직 아무 파일도 바꾸지 않은 상태에서 여기서 멈춘다.
  const vdir = path.join(P.data, 'versions'); const tmpSeed = path.join(vdir, `.seed-${id}`);
  try {
    fs.mkdirSync(vdir, { recursive: true });
    for (const n of fs.readdirSync(vdir)) if (n.startsWith('.seed-')) fs.rmSync(path.join(vdir, n), { recursive: true, force: true }); // 앞서 끊긴 시도가 남긴 임시 복사본
    copyCodeTree(P.app, tmpSeed);
    if (FAULT === 'seed-corrupt-file') fs.appendFileSync(path.join(tmpSeed, 'server.js'), '\n// 깨짐(시험 주입)\n');
    if (FAULT === 'seed-missing-file') fs.rmSync(path.join(tmpSeed, 'tools'), { recursive: true, force: true });
    if (FAULT === 'seed-mode-change') fs.chmodSync(path.join(tmpSeed, 'server.js'), 0o600);
    const want = treeManifest(P.app, SKIP_TOP), got = treeManifest(tmpSeed, null);
    const diffs = diffManifests(want, got);
    if (diffs.length) throw new Error(`안정 버전 복사본이 원본과 달라요(${diffs.length}건): ${diffs.slice(0, 5).join(', ')}`);
    const final = path.join(vdir, `${Date.now()}-${sha256([...want].map(([k, v]) => k + v).join('\n')).slice(0, 12)}`);
    fs.renameSync(tmpSeed, final);
    try { const dfd = fs.openSync(vdir, 'r'); try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); } } catch (_) {}
    j.seed = path.basename(final); j.seedFiles = want.size;
  } catch (err) { fs.rmSync(tmpSeed, { recursive: true, force: true }); j.phase = 'seed-failed'; writeJson(P.journal, j); fail(4, { code: 'seed-failed', msg: err.message, codeUntouched: true }); }
  // 3) 교체 (+ restart-request) — 한 스크립트에서. 중간에 실패하면 바로 복원한다
  j.phase = 'swapping'; j.done = 0; writeJson(P.journal, j);
  const delay = Number(a['step-delay-ms']) || 0;
  try {
    for (const e of j.files) {
      const dst = path.join(P.app, e.rel); fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(plan.cand, e.rel), dst + '.fm-new');
      const fd = fs.openSync(dst + '.fm-new', 'r'); fs.fsyncSync(fd); fs.closeSync(fd);
      if (shaFile(dst + '.fm-new') !== e.after) throw new Error(`복사본 지문이 달라요: ${e.rel}`);
      fs.renameSync(dst + '.fm-new', dst); j.done++; writeJson(P.journal, j);
      if (delay) await sleep(delay);
    }
    const dbad = j.files.filter((e) => shaFile(path.join(P.app, e.rel)) !== e.after);
    if (dbad.length) throw new Error('교체 뒤 지문이 달라요: ' + dbad.map((e) => e.rel).join(','));
    fs.writeFileSync(P.flag, `첫 병합 ${id}: 파일 ${j.files.length}개 교체`);
    j.phase = 'swapped-unverified'; j.swappedAt = Date.now(); writeJson(P.journal, j);
  } catch (err) {
    const errs = restoreFiles(P, j); fs.rmSync(P.flag, { force: true });
    j.phase = errs.length ? 'restore-failed' : 'rolled-back'; j.error = err.message; j.restoreErrors = errs; writeJson(P.journal, j);
    fail(5, { code: 'swap-failed', msg: err.message, restored: !errs.length, restoreErrors: errs });
  }
  out({ id, phase: j.phase, replaced: j.files.length, seed: j.seed, backup: bk, restartRequest: true });
}

async function verify(a, P, plan) {
  const j = readJson(P.journal); if (!j) fail(4, { code: 'no-journal' });
  const checks = []; const add = (id, ok, detail) => checks.push({ id, ok: !!ok, detail });
  const me = await req(a.port, 'GET', '/api/me');
  add('server-answers', me.status === 200, `HTTP ${me.status}`);
  add('server-restarted-after-swap', me.status === 200 && me.json.boot && me.json.boot !== j.pre.boot, me.json.boot ? (me.json.boot !== j.pre.boot ? '새로 켜짐' : '아직 옛 프로세스 (boot 같음)') : '');
  const bad = j.files.filter((e) => shaFile(path.join(P.app, e.rel)) !== e.after);
  add('disk-files-are-the-candidate', !bad.length, bad.length ? bad.slice(0, 5).map((e) => e.rel).join(',') : `${j.files.length}개`);
  const cookie = me.status === 200 ? await login(a.port, loadPassword(P.app)) : '';
  add('login-works', !!cookie, '');
  if (cookie) {
    const pub = j.files.filter((e) => e.rel.startsWith('public/'));
    const mism = []; for (const e of pub) { const name = e.rel === 'public/index.html' ? '/' : '/' + e.rel.slice(7); const r = await req(a.port, 'GET', name, { cookie }); if (r.status !== 200 || sha256(r.buf) !== e.after) mism.push(e.rel); }
    add('served-ui-files-match-candidate', !mism.length, mism.length ? `화면 파일이 후보와 달라요(서버·화면 버전 불일치): ${mism.join(',')}` : `${pub.length}개`);
    const mt = await req(a.port, 'GET', '/api/maintenance', { cookie }); add('new-server-features-wired', mt.status === 200, `/api/maintenance HTTP ${mt.status} (새 감자알이면 200, 옛 감자알이면 404)`);
    const ch = await req(a.port, 'GET', '/api/chats', { cookie }); const names = Array.isArray(ch.json.chats) ? ch.json.chats.map((r) => r.name) : [];
    const lost = Object.keys(j.pre.rooms).filter((n) => !names.includes(n));
    add('existing-crews-and-rooms-listed', ch.status === 200 && !lost.length, ch.status !== 200 ? `/api/chats HTTP ${ch.status}` : lost.length ? `사라진 방: ${lost.slice(0, 5).join(',')}` : `${Object.keys(j.pre.rooms).length}개`);
    const less = [];
    for (const [n, c] of Object.entries(j.pre.rooms)) {
      const h = await req(a.port, 'GET', `/api/history?project=${encodeURIComponent(n)}&tail=50`, { cookie }); const st = await req(a.port, 'GET', `/api/status?project=${encodeURIComponent(n)}`, { cookie });
      const last = (j.pre.last || {})[n]; const found = !last || (Array.isArray(h.json.messages) && h.json.messages.some((m) => String(m.text || '').slice(0, 160) === last));
      if (h.status !== 200 || st.status !== 200 || !(st.json.count >= c) || !found) less.push(`${n}(${c}→${st.json.count}${found ? '' : ', 마지막 말을 못 찾음'})`);
    }
    add('existing-conversations-readable-and-not-shorter', !less.length, less.length ? less.slice(0, 5).join(',') : '모두 읽힘');
  }
  const dbad = []; const bkd = path.join(P.bkRoot, j.id, 'data');
  for (const f of walkFiles(bkd)) { const cur = path.join(P.data, f); let st; try { st = fs.statSync(cur); } catch (_) { dbad.push('없어짐: ' + f); continue; } if (st.mtimeMs <= j.t0 + 1 && shaFile(cur) !== shaFile(path.join(bkd, f))) dbad.push('달라짐: ' + f); }
  add('data-files-preserved', !dbad.length, dbad.length ? dbad.slice(0, 5).join(', ') : '백업과 같음(그 뒤 바뀐 파일은 제외)');
  const ok = checks.every((c) => c.ok);
  j.phase = ok ? 'done' : 'verify-failed'; j.verifiedAt = Date.now(); writeJson(P.journal, j);
  if (!ok) fail(6, { code: 'verify-failed', failed: checks.filter((c) => !c.ok), checks, advice: 'restore 로 되돌릴 수 있어요' });
  out({ phase: 'done', checks });
}

async function restore(a, P) {
  const j = readJson(P.journal); if (!j) fail(4, { code: 'no-journal' });
  if (!fs.existsSync(path.join(P.bkRoot, j.id, 'app')) && j.files.some((e) => e.before !== ABSENT)) fail(4, { code: 'no-backup' });
  const errs = restoreFiles(P, j);
  fs.rmSync(P.flag, { force: true });
  let restarted = null, restartStatus = null;
  if (a['no-restart'] !== true && a.port) {
    const me = await req(a.port, 'GET', '/api/me');
    const bootChanged = async (tries) => { for (let i = 0; i < tries; i++) { await sleep(500); const m = await req(a.port, 'GET', '/api/me'); if (m.status === 200 && m.json.boot && m.json.boot !== me.json.boot) return true; } return false; };
    if (me.status === 200) { // 떠 있는 감자알(새 코드든 옛 코드든)에 검사 뒤 재시작을 요청한다. 안 떠 있으면 start.sh가 디스크의 (복원된) 코드로 다시 켠다
      const cookie = await login(a.port, loadPassword(P.app));
      const rooms = cookie ? (await req(a.port, 'GET', '/api/chats', { cookie })).json.chats : null;
      const cands = [...(Array.isArray(rooms) ? rooms.map((r) => r.name) : []), ...Object.keys((j.pre && j.pre.rooms) || {}), 'gamja'].filter((n, k, arr) => n && arr.indexOf(n) === k);
      for (const room of cands) {
        const rs = await req(a.port, 'POST', '/api/admin/restart', { cookie, body: { project: room }, timeout: 60000 }); restartStatus = rs.status;
        if (rs.status === 400) continue;
        restarted = await bootChanged(120); break;
      }
      // 마지막 수단(--force-kill): 로그인·재시작 API까지 깨졌을 때 감자알 프로세스를 끝내 start.sh가 복원된 코드로 다시 켜게 한다. 지금 이 감자알이 답하는 채팅에서 실행하면 그 답변도 끊긴다
      if (!restarted && a['force-kill'] === true) { const s = findServer(P.app); if (s) { try { process.kill(s.pid, 'SIGTERM'); } catch (_) {} restarted = await bootChanged(120); } }
    }
  }
  const bad = j.files.filter((e) => shaFile(path.join(P.app, e.rel)) !== e.before);
  const up = a.port ? (await req(a.port, 'GET', '/api/me')).status === 200 : null;
  j.phase = bad.length || errs.length ? 'restore-failed' : 'rolled-back'; j.restoredAt = Date.now(); j.restoreErrors = errs; writeJson(P.journal, j);
  if (bad.length || errs.length) fail(6, { code: 'restore-failed', bad: bad.map((e) => e.rel), errs });
  out({ phase: j.phase, restarted: !!restarted, restartStatus, serverAnswers: up, removedNewFiles: j.files.filter((e) => e.before === ABSENT).map((e) => e.rel) });
}

(async () => {
  const a = parseArgs(process.argv.slice(2)); const cmd = a._[0];
  if (a.port) a.port = Number(a.port);
  if (!['preflight', 'apply', 'verify', 'restore', 'status'].includes(cmd)) { console.error(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 11).join('\n')); process.exit(2); }
  const P = setup(a);
  if (cmd === 'status') return out({ journal: readJson(P.journal), server: findServer(P.app), restartRequest: fs.existsSync(P.flag) });
  if ((cmd === 'preflight' || cmd === 'apply' || cmd === 'verify') && !a.port) fail(4, { code: 'usage', msg: '--port 가 필요해요' });
  if (cmd === 'preflight') { const plan = loadPlan(a); const r = await preflight(a, P, plan); console.log(JSON.stringify({ ok: r.ok, checks: r.checks })); process.exit(r.ok ? 0 : 4); }
  if (cmd === 'apply') return apply(a, P, loadPlan(a));
  if (cmd === 'verify') return verify(a, P);
  if (cmd === 'restore') return restore(a, P);
})().catch((e) => { console.log(JSON.stringify({ ok: false, code: 'crash', msg: String(e && e.stack || e).slice(0, 500) })); process.exit(5); });
