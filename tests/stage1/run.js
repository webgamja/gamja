// 1단계 테스트: 임시 감자알(별도 데이터 폴더·포트)을 띄워 권한 정리·생명주기를 확인한다. 개발 폰 데이터는 건드리지 않는다.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', 'data', 'test-work', 'a');
const SERVER = path.join(__dirname, '..', '..', 'server.js');
const PW = 'testpw1234';
let port = 27100;
const results = [];
const ok = (id, cond, note) => { results.push({ id, pass: !!cond, note: note || '' }); console.log(cond ? 'PASS' : 'FAIL', id, note || ''); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function req(p, method, path_, body, cookie) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = http.request({ host: '127.0.0.1', port: p, path: path_, method, headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}), ...(cookie ? { Cookie: cookie } : {}) } }, (res) => {
      let s = ''; res.on('data', (d) => (s += d)); res.on('end', () => { let j = {}; try { j = JSON.parse(s); } catch {} resolve({ status: res.statusCode, json: j, headers: res.headers }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
async function startServer(dir, env = {}) {
  const p = port++;
  const child = spawn(process.execPath, [SERVER], { cwd: dir, env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(p), APP_PASSWORD: PW, DATA_DIR: path.join(dir, 'data'), PROJECTS_DIR: path.join(dir, 'projects'), GAMJA_NO_MIGRATE: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d)); child.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 50; i++) { try { await req(p, 'GET', '/api/status'); break; } catch { await sleep(200); } }
  const lg = await req(p, 'POST', '/api/login', { password: PW });
  const cookie = String((lg.headers['set-cookie'] || [])[0] || '').split(';')[0];
  const api = (m, u, b) => req(p, m, u, b, cookie);
  return { p, child, api, log: () => log, stop: async () => { child.kill('SIGTERM'); await sleep(300); } };
}
function fresh(name) {
  const dir = path.join(ROOT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
  return dir;
}
const PERMF = (dir) => path.join(dir, 'data', 'permissions.json');
const listData = (dir, re) => fs.readdirSync(path.join(dir, 'data')).filter((f) => re.test(f));
// 일부러 모양이 이상한 규칙 파일(키 순서·공백·중복 키)
const WEIRD = Buffer.from('{ "c1" : [ {"rule":"Bash(ls:*)","cmd":"ls","ts":1} ],\n\n   "c2":[{"rule":"Bash(git status:*)","cmd":"git status","ts":2}] , "c1": [] }\n');
const RULES = (names) => Buffer.from(JSON.stringify(Object.fromEntries(names.map((n) => [n, [{ rule: 'Bash(ls:*)', cmd: 'ls', ts: 1 }]]))));

(async () => {
  // P2: 규칙이 없는 폰
  { const d = fresh('p2'); const s = await startServer(d);
    const n = await s.api('GET', '/api/perm/migration-notice');
    ok('P2', n.json.show === false && !listData(d, /^permissions\.backup/).length && !fs.existsSync(path.join(d, 'data', 'perm-migration.json')), '백업·표식·안내 없음');
    await s.stop(); }
  // P1 + P8 + P3 + P5
  { const d = fresh('p1'); fs.writeFileSync(PERMF(d), WEIRD); const s = await startServer(d);
    const bk = listData(d, /^permissions\.backup-[\w-]+\.json$/);
    ok('P1.backup', bk.length === 1, bk.join());
    ok('P8', bk.length === 1 && sha(fs.readFileSync(path.join(d, 'data', bk[0]))) === sha(WEIRD), '바이트 동일(키 순서·공백·중복 키 포함)');
    const mode = bk.length ? (fs.statSync(path.join(d, 'data', bk[0])).mode & 0o777) : 0;
    ok('P1.mode', mode === 0o600, mode.toString(8));
    ok('P1.reset', JSON.stringify(JSON.parse(fs.readFileSync(PERMF(d), 'utf8'))) === '{}', '활성 규칙 비어 있음');
    ok('P1.marker', JSON.parse(fs.readFileSync(path.join(d, 'data', 'perm-migration.json'), 'utf8')).count === 1, '표식 count=1 (중복 키는 마지막 값이 적용돼 c1=빈 목록)');
    const list0 = await s.api('GET', '/api/perm');
    ok('P1.api', list0.json.rules.length === 0, '/api/perm 규칙 0');
    const n1 = await s.api('GET', '/api/perm/migration-notice');
    ok('P1.notice', n1.json.show === true && n1.json.count === 1, '안내 대상');
    await s.api('POST', '/api/perm/migration-notice/ack', {});
    const n2 = await s.api('GET', '/api/perm/migration-notice');
    ok('P1.ack', n2.json.show === false, '확인 뒤 다시 안 뜸');
    // P5 복구
    const r = await s.api('POST', '/api/perm/restore-backup', { confirm: true });
    ok('P5.restore', r.status === 200 && r.json.count === 1, JSON.stringify(r.json));
    const list1 = await s.api('GET', '/api/perm');
    ok('P5.active', list1.json.rules.length === 1, '규칙 복구됨');
    ok('P5.prerestore', listData(d, /prerestore/).length === 1, '되돌리기 전 상태도 백업');
    await s.stop();
    // P3: 다시 시작 — 복구한 뒤에는 표식 때문에 다시 초기화하지 않는다
    const s2 = await startServer(d);
    ok('P3', listData(d, /^permissions\.backup-[\w-]+\.json$/).filter((f) => !f.includes('prerestore')).length === 1, '재시작해도 재초기화·새 백업 없음');
    const list2 = await s2.api('GET', '/api/perm');
    ok('P3.keep', list2.json.rules.length === 1, '복구한 규칙 유지');
    await s2.stop(); }
  // P3b: 초기화만 한 뒤 재시작
  { const d = fresh('p3'); fs.writeFileSync(PERMF(d), WEIRD); const s = await startServer(d); await s.stop();
    const s2 = await startServer(d);
    ok('P3b', listData(d, /^permissions\.backup-/).length === 1 && (await s2.api('GET', '/api/perm/migration-notice')).json.show === true, '재시작: 새 백업 없음, 아직 확인 안 했으면 안내 유지');
    await s2.stop(); }
  // P4: 백업 실패 → 초기화하지 않음
  { const d = fresh('p4'); fs.writeFileSync(PERMF(d), WEIRD); const s = await startServer(d, { GAMJA_TEST_FAIL: 'perm-backup' });
    ok('P4.file', sha(fs.readFileSync(PERMF(d))) === sha(WEIRD), '원본 파일 그대로');
    ok('P4.active', (await s.api('GET', '/api/perm')).json.rules.length === 1, '원래 규칙 유지');
    ok('P4.nomarker', !fs.existsSync(path.join(d, 'data', 'perm-migration.json')), '표식 없음');
    ok('P4.log', /초기화하지 않았어요/.test(s.log()), '오류 로그');
    await s.stop(); }
  // P6: 손상 파일(잘린 JSON / 비UTF-8 / 앞부분 쓰레기)
  const corrupt = { trunc: Buffer.from('{"c1":[{"rule":"Bash(ls:*)","cm'), bin: Buffer.concat([Buffer.from([0xff, 0xfe, 0x00]), Buffer.from('{"a":1}')]), junk: Buffer.from('zzz{"c1":[]}') };
  for (const [k, buf] of Object.entries(corrupt)) {
    const d = fresh('p6' + k); fs.writeFileSync(PERMF(d), buf); const s = await startServer(d);
    const cf = listData(d, /^permissions\.corrupt-/);
    ok(`P6.${k}`, cf.length === 1 && sha(fs.readFileSync(path.join(d, 'data', cf[0]))) === sha(buf) && fs.readFileSync(PERMF(d), 'utf8').trim() === '{}', '원본 바이트 보존 후 빈 규칙');
    ok(`P6.${k}.alive`, (await s.api('GET', '/api/perm')).status === 200, '감자알 정상 동작');
    await s.stop();
  }
  // P7: 손상 + 보존 실패
  { const d = fresh('p7'); fs.writeFileSync(PERMF(d), corrupt.trunc); const s = await startServer(d, { GAMJA_TEST_FAIL: 'perm-backup' });
    ok('P7.file', sha(fs.readFileSync(PERMF(d))) === sha(corrupt.trunc), '디스크 원본 그대로');
    ok('P7.alive', (await s.api('GET', '/api/perm')).json.rules.length === 0, '메모리에서만 빈 규칙');
    await s.stop();
    const s2 = await startServer(d); // 이번엔 보존이 된다 (재시작 때 재시도)
    ok('P7.retry', listData(d, /^permissions\.corrupt-/).length === 1, '재시작 때 보존 재시도 성공');
    await s2.stop(); }
  // C 시리즈: 표식을 미리 만들어(= 이미 초기화한 폰) 규칙이 살아 있는 상태에서 생명주기 확인
  const MIG = JSON.stringify({ done: true, at: 1, count: 0, notified: true });
  const setup = (name, names) => { const d = fresh(name); fs.writeFileSync(PERMF(d), RULES(names)); fs.writeFileSync(path.join(d, 'data', 'perm-migration.json'), MIG); return d; };
  const rulesOf = async (s) => [...new Set((await s.api('GET', '/api/perm')).json.rules.map((r) => r.crew))].sort().join(',');
  // C1: 만들기 / 삭제 후 같은 이름 만들기
  { const d = setup('c1', ['X', 'Y']); const s = await startServer(d);
    ok('C1.pre', (await rulesOf(s)) === 'X,Y', '시작 시 규칙 있음');
    const mk = await s.api('POST', '/api/projects', { name: 'X' });
    ok('C1.create', mk.status === 200 && (await rulesOf(s)) === 'Y', 'X 만들기 → X 규칙 0, Y는 그대로');
    fs.mkdirSync(path.join(d, 'projects', 'Y'), { recursive: true });
    const del = await s.api('POST', '/api/projects/delete', { project: 'Y' });
    ok('C1.delete', del.status === 200 && (await rulesOf(s)) === '', '삭제 → Y 규칙 0');
    const again = await s.api('POST', '/api/projects', { name: 'Y' });
    ok('C1.recreate', again.status === 200 && (await rulesOf(s)) === '', '같은 이름 다시 만들기 → 0');
    ok('C1.disk', fs.readFileSync(PERMF(d), 'utf8').replace(/\s/g, '') === '{}', '디스크에도 반영');
    await s.stop(); }
  // C3: 이름 변경
  { const d = setup('c3', ['A', 'B', 'K']); fs.mkdirSync(path.join(d, 'projects', 'A'), { recursive: true }); const s = await startServer(d);
    const rn = await s.api('POST', '/api/projects/rename', { project: 'A', newName: 'B' });
    ok('C3', rn.status === 200 && (await rulesOf(s)) === 'K', `A→B 이름 변경: A·B 규칙 모두 0, K 유지 (${await rulesOf(s)})`);
    await s.stop(); }
  // C2: 휴지통 복구 (삭제 → 재시작하며 규칙을 되살려 놓고 → 복구 → 규칙 0)
  { const d = setup('c2', ['Z']); fs.mkdirSync(path.join(d, 'projects', 'Z'), { recursive: true }); fs.mkdirSync(path.join(d, 'data', 'conversations'), { recursive: true }); }
  { const d = path.join(ROOT, 'c2'); fs.mkdirSync(path.join(d, 'data', 'conversations'), { recursive: true }); fs.writeFileSync(path.join(d, 'data', 'conversations', 'p_Z.json'), JSON.stringify({ messages: [{ role: 'user', text: 'hi', ts: 1 }] }));
    const s = await startServer(d);
    const del = await s.api('POST', '/api/projects/delete', { project: 'Z' });
    const arch = path.join(d, 'data', 'conversations', 'archive');
    const ids = fs.existsSync(arch) ? fs.readdirSync(arch).map((f) => f.replace(/\.json$/, '')) : [];
    await s.stop();
    fs.writeFileSync(PERMF(d), RULES(['Z', 'Q'])); // 되살아난 규칙을 흉내
    const s2 = await startServer(d);
    ok('C2.pre', (await rulesOf(s2)) === 'Q,Z', `삭제=${del.status}, 보관 ${ids.length}건, 규칙 있음`);
    const rs = await s2.api('POST', '/api/archive/restore', { id: ids[0] });
    ok('C2.restore', rs.status === 200 && (await rulesOf(s2)) === 'Q', `원래 이름 복구 → Z 규칙 0 (${rs.status} ${JSON.stringify(rs.json).slice(0, 80)})`);
    await s2.stop(); }
  // C4: permOnce — 메모리 상태라 삭제·생성 시 비워지는지는 코드 경로(clearCrewPerms)로 확인
  const src = fs.readFileSync(SERVER, 'utf8');
  ok('C4', /function clearCrewPerms[\s\S]{0,200}permOnce\.delete\(n\)/.test(src), 'clearCrewPerms가 permOnce도 비움(코드 확인)');
  ok('C5.code', /crewCreated = true;\s*clearCrewPerms\(crew\)/.test(src), '채팅 zip 가져오기 새 크루 → 권한 비움(코드 확인, 실행 테스트는 아님)');

  const failed = results.filter((r) => !r.pass);
  console.log(`\n합계 ${results.length}건, 통과 ${results.length - failed.length}, 실패 ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('테스트 오류', e); process.exit(2); });
