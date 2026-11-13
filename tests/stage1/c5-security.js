// C5(채팅 zip 가져오기 → 권한 초기화) + restore-backup 보안 확인. 임시 감자알 + 가짜 claude(요약·채팅을 흉내, 실제 Claude는 실행하지 않음)
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');
const zipTool = require('../../tools/gamja-zip.js');

const ROOT = path.join(__dirname, '..', '..', 'data', 'test-work', 'b');
const SERVER = path.join(__dirname, '..', '..', 'server.js');
const PW = 'testpw1234';
let port = 27300;
const results = [];
const ok = (id, cond, note) => { results.push({ id, pass: !!cond }); console.log(cond ? 'PASS' : 'FAIL', id, note || ''); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rawReq(p, method, path_, { body, headers = {}, cookie, host } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const h = { ...headers, ...(data ? { 'Content-Length': data.length } : {}), ...(data && !headers['Content-Type'] ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) };
    const r = http.request({ host: host || '127.0.0.1', port: p, path: path_, method, headers: h, localAddress: host && host !== '127.0.0.1' ? host : undefined }, (res) => {
      let s = ''; res.on('data', (d) => (s += d)); res.on('end', () => { let j = {}; try { j = JSON.parse(s); } catch {} resolve({ status: res.statusCode, json: j, text: s, headers: res.headers }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
function fresh(name) {
  const dir = path.join(ROOT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'data', 'conversations'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
  return dir;
}
fs.mkdirSync(ROOT, { recursive: true });
const FAKE = path.join(ROOT, 'fake-claude.js');
fs.writeFileSync(FAKE, `#!/usr/bin/env node
const fs = require('fs'); const http = require('http');
const a = process.argv.slice(2);
if (a.includes('--version')) { console.log('9.9.9 (fake)'); process.exit(0); }
let input = ''; process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const rec = { args: a, cwd: process.cwd(), at: Date.now() };
  const done = () => {
    fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(rec) + '\\n');
    if (a.includes('stream-json')) console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 's' }));
    else console.log(JSON.stringify({ result: '가짜 요약', total_cost_usd: 0 }));
  };
  let ck = ''; try { ck = fs.readFileSync(process.env.FAKE_COOKIE_FILE, 'utf8'); } catch {}
  if (!ck) return done();
  const r = http.request({ host: '127.0.0.1', port: process.env.FAKE_PORT, path: '/api/perm', headers: { Cookie: ck } }, (res) => {
    let s = ''; res.on('data', (d) => (s += d)); res.on('end', () => { try { rec.permCrews = [...new Set(JSON.parse(s).rules.map((x) => x.crew))]; } catch {} done(); });
  });
  r.on('error', done); r.end();
});
`);
fs.chmodSync(FAKE, 0o755);

async function startServer(dir, env = {}) {
  const p = port++;
  const logFile = path.join(dir, 'fake.log');
  const cookieFile = path.join(dir, 'cookie.txt');
  const child = spawn(process.execPath, [SERVER], { cwd: dir, env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(p), APP_PASSWORD: PW, DATA_DIR: path.join(dir, 'data'), PROJECTS_DIR: path.join(dir, 'projects'), GAMJA_NO_MIGRATE: '1', CLAUDE_BIN: FAKE, FAKE_LOG: logFile, FAKE_COOKIE_FILE: cookieFile, FAKE_PORT: String(p), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d)); child.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 50; i++) { try { await rawReq(p, 'GET', '/api/me'); break; } catch { await sleep(200); } }
  const lg = await rawReq(p, 'POST', '/api/login', { body: { password: PW } });
  const cookie = String((lg.headers['set-cookie'] || [])[0] || '').split(';')[0];
  fs.writeFileSync(cookieFile, cookie);
  return {
    p, cookie, logFile, setCookieHeader: String((lg.headers['set-cookie'] || [])[0] || ''),
    api: (m, u, b, headers) => rawReq(p, m, u, { body: b, cookie, headers }),
    fakeCalls: () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
    srvLog: () => log,
    stop: async () => { child.kill('SIGTERM'); await sleep(300); },
  };
}
async function chat(s, project, message) { // SSE 응답이 끝날 때까지 읽는다
  return rawReq(s.p, 'POST', '/api/chat', { body: { project, message }, cookie: s.cookie });
}
async function makeZip(file, crew, withMd) {
  const entries = [
    { name: 'gamja-room.json', data: Buffer.from(JSON.stringify({ format: 'gamja-room', version: 1, crew, title: '테스트', meta: null, legacy: false, files: 1 })) },
    { name: 'conversation.json', data: Buffer.from(JSON.stringify({ messages: [{ role: 'user', text: '안녕', ts: 1 }, { role: 'bot', text: '네', ts: 2 }] })) },
    ...(withMd ? [{ name: 'crew/CLAUDE.md', data: Buffer.from('테스트 지침') }] : []),
    { name: 'folder/note.txt', data: Buffer.from('hello') },
  ];
  const out = fs.createWriteStream(file);
  await zipTool.writeZip(out, entries);
  await new Promise((r) => out.end(r));
}
const MIG = JSON.stringify({ done: true, at: 1, count: 0, notified: true });
const RULE = (crew) => ({ [crew]: [{ rule: 'Bash(ls:*)', cmd: 'ls', ts: 1 }] });
async function seedOnce(s, d, crew) { // 크루 폴더 + 허용 카드가 있는 대화를 만들고 "이번만 허용"을 눌러 permOnce를 만든다
  fs.mkdirSync(path.join(d, 'projects', crew), { recursive: true });
  fs.writeFileSync(path.join(d, 'data', 'conversations', `p_${encodeURIComponent(crew)}.json`), JSON.stringify({ messages: [{ role: 'bot', text: 'x', ts: 1, denied: [{ id: 'abc123', cmd: 'ls /tmp', risk: 'run', once: true }] }] }));
  return s.api('POST', '/api/perm/answer', { project: crew, id: 'abc123', mode: 'once' });
}
const allowedOf = (call) => { const i = call.args.indexOf('--allowedTools'); return i >= 0 ? call.args[i + 1] : ''; };

(async () => {
  // ---------- C5 ----------
  { const d = fresh('c5'); fs.writeFileSync(path.join(d, 'data', 'permissions.json'), JSON.stringify({ ...RULE('CY'), ...RULE('CX'), ...RULE('CZ') })); fs.writeFileSync(path.join(d, 'data', 'perm-migration.json'), MIG);
    const s = await startServer(d);
    // 대조군: 가져오기 없이 CY의 규칙·이번만 허용이 실제 실행 인자에 실리는지 (검출 방법이 맞는지 확인)
    const a1 = await seedOnce(s, d, 'CY');
    ok('C5.ctrl.seed', a1.status === 200, `이번만 허용 카드 응답 ${a1.status}`);
    await chat(s, 'CY', '안녕');
    const cy = s.fakeCalls().filter((c) => c.args.includes('stream-json')).pop();
    ok('C5.ctrl.detect', cy && allowedOf(cy).includes('Bash(ls /tmp)') && allowedOf(cy).includes('Bash(ls:*)'), '대조군: 인자에 항상/이번만 규칙이 실림(검출 가능)');
    // 본 시험: CX에 규칙 + permOnce를 만든 뒤, 크루 폴더를 파일로 직접 지워(API를 거치지 않고) 크루가 없는 상태로 가져온다
    const a2 = await seedOnce(s, d, 'CX');
    fs.rmSync(path.join(d, 'projects', 'CX'), { recursive: true, force: true });
    fs.rmSync(path.join(d, 'data', 'conversations', 'p_CX.json'), { force: true });
    const before = (await s.api('GET', '/api/perm')).json.rules.map((r) => r.crew);
    ok('C5.pre', a2.status === 200 && before.includes('CX'), 'CX 규칙·이번만 허용이 있는 상태에서 크루만 사라짐');
    const zip = path.join(d, 'in.zip'); await makeZip(zip, 'CX', true);
    const nCalls = s.fakeCalls().length;
    const imp = await rawReq(s.p, 'POST', '/api/rooms/import', { body: fs.readFileSync(zip), headers: { 'Content-Type': 'application/zip' }, cookie: s.cookie });
    ok('C5.import', imp.status === 200 && imp.json.crewCreated === true && fs.existsSync(path.join(d, 'projects', 'CX', 'CLAUDE.md')), `가져오기 ${imp.status}: crewCreated=${imp.json.crewCreated}, 새 크루 폴더·지침 생성`);
    const after = (await s.api('GET', '/api/perm')).json.rules.map((r) => r.crew);
    ok('C5.perms', !after.includes('CX') && after.includes('CZ'), '새 크루 CX의 항상 허용 규칙 0, 다른 크루(CZ)는 유지');
    ok('C5.disk', !/"CX"/.test(fs.readFileSync(path.join(d, 'data', 'permissions.json'), 'utf8')), '디스크에서도 CX 규칙 삭제');
    const sum = s.fakeCalls().slice(nCalls)[0];
    ok('C5.summary.args', sum && allowedOf(sum) === 'Read Grep Glob' && !allowedOf(sum).includes('Bash'), `요약 호출은 읽기 전용 도구만(--allowedTools "${sum && allowedOf(sum)}"), 크루 규칙을 쓰지 않음`);
    ok('C5.summary.order', sum && Array.isArray(sum.permCrews) && !sum.permCrews.includes('CX'), `요약이 시작된 시점에 이미 CX 규칙이 비어 있음 (그때 규칙 보유 크루: ${sum && JSON.stringify(sum.permCrews)})`);
    // permOnce: 새 방에서 실제 실행 인자로 확인
    await chat(s, imp.json.room, '안녕');
    const run = s.fakeCalls().filter((c) => c.args.includes('stream-json')).pop();
    ok('C5.once', run && run.cwd.includes('chat-') && !allowedOf(run).includes('Bash(ls /tmp)') && !allowedOf(run).includes('Bash(ls:*)'), '새 방의 첫 실행 인자에 이전 규칙(항상·이번만) 없음');
    // 이미 있는 크루에 붙이는 경우(현재 동작): 규칙을 건드리지 않는다 — 2단계에서 "항상 새 크루"로 바뀔 부분
    fs.mkdirSync(path.join(d, 'projects', 'CZ'), { recursive: true });
    const zip2 = path.join(d, 'in2.zip'); await makeZip(zip2, 'CZ', false);
    const imp2 = await rawReq(s.p, 'POST', '/api/rooms/import', { body: fs.readFileSync(zip2), headers: { 'Content-Type': 'application/zip' }, cookie: s.cookie });
    ok('C5.attach', imp2.status === 200 && imp2.json.crewCreated === false && (await s.api('GET', '/api/perm')).json.rules.some((r) => r.crew === 'CZ'), '기존 크루에 붙이면 기존 규칙 유지 (현재 동작, 2단계에서 항상 새 크루로 바뀜)');
    await s.stop(); }

  // ---------- restore-backup 보안 ----------
  { const d = fresh('sec'); const goodBackup = JSON.stringify({ A: [{ rule: 'Bash(ls:*)', cmd: 'ls', ts: 1 }] });
    fs.writeFileSync(path.join(d, 'data', 'permissions.backup-20260101-000000.json'), goodBackup);
    const s = await startServer(d);
    const URLP = '/api/perm/restore-backup';
    // 인증
    const noAuth = await rawReq(s.p, 'POST', URLP, {});
    ok('S.noauth', noAuth.status === 401, `로그인 없이: ${noAuth.status}`);
    const badCookie = await rawReq(s.p, 'POST', URLP, { cookie: 'cc_session=1.abc.def' });
    ok('S.badcookie', badCookie.status === 401, `가짜 쿠키: ${badCookie.status}`);
    // 쿠키 속성
    ok('S.cookie', /HttpOnly/.test(s.setCookieHeader) && /SameSite=Strict/.test(s.setCookieHeader), s.setCookieHeader.replace(/=[^;]+;/, '=…;'));
    // GET은 처리하지 않는다
    const getR = await s.api('GET', URLP);
    ok('S.method', getR.status === 404, `GET: ${getR.status}`);
    // 외부(같은 와이파이) 접속 — 와이파이 접속이 꺼져 있을 때 (기본)
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
    if (lan) {
      let r1; try { r1 = await rawReq(s.p, 'POST', URLP, { cookie: s.cookie, host: lan.address }); } catch (e) { r1 = { status: 'err ' + e.code }; }
      ok('S.lan.off', r1.status === 403 || String(r1.status).startsWith('err'), `와이파이 접속 꺼짐 + 유효한 쿠키, 외부 주소(${lan.address})에서: ${r1.status}`);
    } else console.log('SKIP S.lan.off: 외부 주소가 없어 확인 못 함');
    // Origin 검사 여부 (다른 사이트에서 온 요청인 척)
    const C = { confirm: true };
    const evil = await s.api('POST', URLP, C, { Origin: 'http://evil.example', 'Sec-Fetch-Site': 'cross-site' });
    ok('S.origin.evil', evil.status === 403, `다른 출처(Origin: evil) + 유효한 쿠키 → ${evil.status}`);
    const evil2 = await s.api('POST', URLP, C, { Origin: 'http://evil.example' });
    ok('S.origin.evil2', evil2.status === 403, `Origin만 다름 → ${evil2.status}`);
    const evil3 = await s.api('POST', URLP, C, { Origin: 'null' });
    ok('S.origin.null', evil3.status === 403, `Origin: null → ${evil3.status}`);
    const evil4 = await s.api('POST', URLP, C, { Origin: `http://127.0.0.1:${s.p}.evil.example` });
    ok('S.origin.suffix', evil4.status === 403, `주소 뒤에 붙인 가짜 → ${evil4.status}`);
    ok('S.origin.noeffect', !fs.existsSync(path.join(d, 'data', 'permissions.json')) || !/"A"/.test(fs.readFileSync(path.join(d, 'data', 'permissions.json'), 'utf8')), '거절된 요청은 권한을 바꾸지 않음');
    // 정상 요청: 화면(같은 주소 Origin) / Origin 없음(앱·내부 호출)
    const same = await s.api('POST', URLP, C, { Origin: `http://127.0.0.1:${s.p}` });
    ok('S.origin.same', same.status === 200, `같은 주소 Origin → ${same.status}`);
    // 확인(confirm) 필요
    const noConf = await s.api('POST', URLP, {}); ok('S.confirm.missing', noConf.status === 400, `confirm 없음 → ${noConf.status}`);
    const falseConf = await s.api('POST', URLP, { confirm: 'true' }); ok('S.confirm.string', falseConf.status === 400, `confirm이 문자열 → ${falseConf.status}`);
    const okR = await s.api('POST', URLP, C);
    ok('S.normal', okR.status === 200 && okR.json.count === 1, JSON.stringify(okR.json));
    // 채팅 알림 기록: 프로젝트를 넘기면 그 방에 알림이 남는다
    await s.api('POST', '/api/projects', { name: 'NT' });
    const nt = await s.api('POST', URLP, { confirm: true, project: 'NT' });
    const conv = await s.api('GET', '/api/history?project=NT');
    ok('S.notice', nt.status === 200 && /되돌렸어요/.test(JSON.stringify(conv.json)), `복구 알림이 채팅에 남음 (${nt.status})`);
    // 경로 조작: 파일 이름은 요청에서 받지 않는다. 본문에 file/path를 넣어도 무시되는지
    const trav = await s.api('POST', URLP, { confirm: true, file: '../../server.js', path: '/etc/passwd', id: '../x' });
    ok('S.traversal.param', trav.status === 200 && trav.json.file === 'permissions.backup-20260101-000000.json', `본문의 file/path 무시, 결과 파일=${trav.json.file}`);
    // 백업 폴더에 이름만 비슷한 가짜 파일: 정규식에 안 맞으면 무시
    fs.writeFileSync(path.join(d, 'data', 'permissions.backup-evil.json.bak'), '{}');
    fs.writeFileSync(path.join(d, 'data', 'permissions.backup-99999999-999999-prerestore.json'), '{"Z":[{"rule":"Bash(*)"}]}');
    fs.writeFileSync(path.join(d, 'data', 'permissions.backup-99999999-999999 x.json'), '{"Z":[{"rule":"Bash(*)"}]}');
    const r3 = await s.api('POST', URLP, C);
    ok('S.names', r3.status === 200 && r3.json.file === 'permissions.backup-20260101-000000.json', `이름이 규칙에 안 맞거나 prerestore면 대상 아님 (선택: ${r3.json.file})`);
    // 백업 파일 검증: 배열 / 깨진 JSON / 잘못된 구조
    const bad = (name, content) => { for (const f of fs.readdirSync(path.join(d, 'data'))) if (/^permissions\.backup-/.test(f)) fs.rmSync(path.join(d, 'data', f)); fs.writeFileSync(path.join(d, 'data', name), content); };
    bad('permissions.backup-30000101-000000.json', '[1,2]');
    const r4 = await s.api('POST', URLP, C); ok('S.val.array', r4.status === 400, `배열: ${r4.status}`);
    bad('permissions.backup-30000101-000000.json', '{"A":');
    const r5 = await s.api('POST', URLP, C); ok('S.val.broken', r5.status === 400, `깨진 JSON: ${r5.status}`);
    // 구조·내용 검증: 하나라도 이상하면 전체 거절, 현재 권한은 그대로
    const R = (rule, extra = {}) => ({ rule, cmd: 'x', ts: 1, ...extra });
    const GOOD = { G: [R('Bash(ls:*)')] };
    const cases = {
      'S.val.notarray': { A: 'string-not-array' },
      'S.val.rulenum': { B: [{ rule: 5 }] },
      'S.val.itemstring': { B: ['Bash(ls:*)'] },
      'S.val.broad1': { C: [R('Bash(*)')] },
      'S.val.broad2': { C: [R('Bash(:*)')] },
      'S.val.broad3': { C: [R('Bash(node:*)')] },
      'S.val.broad4': { C: [R('Bash()')] },
      'S.val.notbash': { C: [R('Read(/etc/passwd)')] },
      'S.val.over100': { C: Array.from({ length: 101 }, (_, i) => R(`Bash(echo ${i})`)) },
      'S.val.longrule': { C: [R('Bash(echo ' + 'a'.repeat(400) + ')')] },
      'S.val.control': { C: [R('Bash(ls\n-la)')] },
      'S.val.badcmd': { C: [R('Bash(ls)', { cmd: 5 })] },
      'S.val.badts': { C: [R('Bash(ls)', { ts: 'x' })] },
      'S.val.secret': { C: [R('Bash(cat /etc/shadow)')] },
      'S.val.critical': { C: [R('Bash(sudo rm -rf /)')] },
      'S.val.proto': JSON.parse('{"__proto__":[{"rule":"Bash(ls)"}]}'),
      'S.val.mixed': { ...GOOD, Z: [R('Bash(*)')] }, // 좋은 것과 나쁜 것이 섞이면 전체 거절 (일부만 복구하지 않음)
    };
    const permsBefore = await s.api('GET', '/api/perm');
    for (const [id, data] of Object.entries(cases)) {
      bad('permissions.backup-30000101-000000.json', id === 'S.val.proto' ? '{"__proto__":[{"rule":"Bash(ls)"}]}' : JSON.stringify(data));
      const r = await s.api('POST', URLP, C);
      const now = await s.api('GET', '/api/perm');
      ok(id, r.status === 400 && JSON.stringify(now.json) === JSON.stringify(permsBefore.json), `거절 ${r.status}, 현재 권한 그대로 · ${(r.json.error || '').slice(0, 60)}`);
    }
    // 정상 형식은 통과하고 기존 동작(되돌리기 전 현재 상태를 -prerestore로 백업)을 유지
    bad('permissions.backup-30000101-000000.json', JSON.stringify({ G: [R('Bash(ls:*)'), R('Bash(git status)')], H: [R('Bash(echo hi)')] }));
    const pre = fs.readdirSync(path.join(d, 'data')).filter((f) => /prerestore/.test(f)).length;
    const good = await s.api('POST', URLP, C);
    ok('S.val.good', good.status === 200 && good.json.count === 3, JSON.stringify(good.json));
    ok('S.val.prerestore', fs.readdirSync(path.join(d, 'data')).filter((f) => /prerestore/.test(f)).length === pre + 1, '복구 전 현재 상태를 -prerestore 백업으로 남김(기존 동작 유지)');
    // lstat: 심볼릭 링크·폴더는 대상이 될 수 없다
    const realFile = path.join(d, 'real-target.json');
    fs.writeFileSync(realFile, JSON.stringify({ L: [R('Bash(ls:*)')] }));
    bad('permissions.backup-30000101-000000.json', '{}');
    fs.rmSync(path.join(d, 'data', 'permissions.backup-30000101-000000.json'));
    fs.symlinkSync(realFile, path.join(d, 'data', 'permissions.backup-30000101-000000.json'));
    const sl = await s.api('POST', URLP, C);
    const nowSl = await s.api('GET', '/api/perm');
    ok('S.lstat.symlink', sl.status === 400 && !JSON.stringify(nowSl.json).includes('"L"'), `심볼릭 링크 백업 거절 ${sl.status}`);
    fs.rmSync(path.join(d, 'data', 'permissions.backup-30000101-000000.json'));
    fs.mkdirSync(path.join(d, 'data', 'permissions.backup-30000101-000000.json'));
    const dr = await s.api('POST', URLP, C);
    ok('S.lstat.dir', dr.status === 400, `폴더 거절 ${dr.status}`);
    fs.rmdirSync(path.join(d, 'data', 'permissions.backup-30000101-000000.json'));
    // 다른 권한 변경 API도 Origin 검사: 위조 요청은 막고, 같은 주소는 통과
    const rm1 = await s.api('POST', '/api/perm/remove', { crew: 'G', rule: 'Bash(ls:*)' }, { Origin: 'http://evil.example' });
    ok('S.origin.remove.evil', rm1.status === 403 && (await s.api('GET', '/api/perm')).json.rules.some((x) => x.crew === 'G'), `perm/remove 위조 → ${rm1.status}`);
    const rm2 = await s.api('POST', '/api/perm/remove', { crew: 'G', rule: 'Bash(ls:*)' }, { Origin: `http://127.0.0.1:${s.p}` });
    ok('S.origin.remove.same', rm2.status === 200 && !(await s.api('GET', '/api/perm')).json.rules.some((x) => x.crew === 'G' && x.rule === 'Bash(ls:*)'), `perm/remove 정상 → ${rm2.status}`);
    const an = await s.api('POST', '/api/perm/answer', { project: 'NT', id: 'x', mode: 'no' }, { Origin: 'http://evil.example' });
    ok('S.origin.answer.evil', an.status === 403, `perm/answer 위조 → ${an.status}`);
    const ak = await s.api('POST', '/api/perm/migration-notice/ack', {}, { Origin: 'http://evil.example' });
    ok('S.origin.ack.evil', ak.status === 403, `migration-notice/ack 위조 → ${ak.status}`);
    // 화면이 쓰는 다른 API는 Origin이 달라도 영향 없음(범위를 권한 API로 한정)
    const me = await s.api('GET', '/api/perm', undefined, { Origin: 'http://evil.example' });
    ok('S.origin.scope', me.status === 200, `GET /api/perm은 그대로 → ${me.status}`);
    await s.stop(); }

  // ---------- 같은 와이파이 접속을 켠 경우: 로그인한 외부 기기도 되돌리기는 못 한다 ----------
  { const d = fresh('sec-lan');
    fs.writeFileSync(path.join(d, 'data', 'permissions.backup-20260101-000000.json'), JSON.stringify({ A: [{ rule: 'Bash(ls:*)', cmd: 'ls', ts: 1 }] }));
    fs.writeFileSync(path.join(d, 'data', 'settings.json'), JSON.stringify({ lanAccess: true }));
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
    const s = await startServer(d);
    if (lan) {
      const lg = await rawReq(s.p, 'POST', '/api/login', { body: { password: PW }, host: lan.address });
      const ck = String((lg.headers['set-cookie'] || [])[0] || '').split(';')[0];
      const meR = await rawReq(s.p, 'GET', '/api/perm', { cookie: ck, host: lan.address });
      const r = await rawReq(s.p, 'POST', '/api/perm/restore-backup', { body: { confirm: true }, cookie: ck, host: lan.address });
      ok('S.lan.on.noaccess', meR.status === 200 && r.status === 403, `와이파이 접속 켬 + 외부 주소 + 로그인: 다른 API ${meR.status}, 되돌리기 ${r.status}`);
      const local = await s.api('POST', '/api/perm/restore-backup', { confirm: true });
      ok('S.lan.on.local', local.status === 200, `같은 설정에서 이 폰 안의 요청은 허용 ${local.status}`);
      const fwd = await s.api('POST', '/api/perm/restore-backup', { confirm: true }, { 'X-Forwarded-For': '8.8.8.8' });
      ok('S.local.forwarded', fwd.status === 403, `프록시 흔적(X-Forwarded-For)이 있으면 로컬로 보지 않음 ${fwd.status}`);
      const cf = await s.api('POST', '/api/perm/restore-backup', { confirm: true }, { 'CF-Connecting-IP': '8.8.8.8' });
      ok('S.local.cf', cf.status === 403, `CF-Connecting-IP가 있으면 거절 ${cf.status}`);
    } else console.log('SKIP S.lan.on: 외부 주소가 없어 확인 못 함');
    await s.stop(); }

  // ---------- tools/perm-policy.js: 따옴표 안의 글자 오탐 수정 (정책은 그대로) ----------
  { const { tier, redirectsOutside } = require('../../tools/perm-policy.js');
    const G = ['/root/projects/gamja', '/root/projects/gamja/data'];
    const notDanger = (id, cmd) => ok(id, tier(cmd, G).tier !== 'danger', `${cmd.slice(0, 70)} → ${tier(cmd, G).tier}`);
    const danger = (id, cmd) => ok(id, tier(cmd, G).tier === 'danger', `${cmd.slice(0, 70)} → ${tier(cmd, G).tier}`);
    // 오탐이던 것: 따옴표 안의 글자
    notDanger('PP.fp1', "printf 'a >> /root/x' > rel.txt");
    notDanger('PP.fp2', 'echo "use > /tmp/foo to redirect" > notes.md');
    notDanger('PP.fp3', "git commit -m 'docs: explain >> ~/file'");
    notDanger('PP.fp4', 'echo "a > $HOME/x" > out.txt');
    notDanger('PP.fp5', 'echo "say \\"x\\" > /tmp/y" > out.txt');
    // 진짜 밖으로 쓰기는 그대로 위험
    danger('PP.real1', 'echo x > /etc/y');
    danger('PP.real2', 'echo x >> ~/f');
    danger('PP.real3', 'echo x > $HOME/x');
    danger('PP.real4', 'echo x > ../x');
    danger('PP.real5', 'echo x > "/etc/y"');
    danger('PP.real6', "echo 'safe text' > /etc/y");
    danger('PP.real7', 'echo "a > b" >> /root/x');
    danger('PP.real8', 'echo x >/etc/y');
    ok('PP.devnull', tier('echo x > /dev/null', G).tier !== 'danger', '/dev/null은 그대로 허용');
    // 글을 다른 프로그램으로 실행하는 모양은 따옴표 안도 예전처럼 검사 (정책 약화 없음)
    danger('PP.eval', 'eval "echo x > /etc/y"');
    danger('PP.sh', 'sh -c "echo x > /etc/y"');
    danger('PP.awk', `awk 'BEGIN{print "x" > "/etc/y"}'`);
    danger('PP.unclosed', 'echo "abc > /etc/y');
    // 위험 단계의 다른 규칙은 그대로
    danger('PP.secret', 'cat /etc/shadow');
    danger('PP.critical', 'sudo rm -rf /');
    danger('PP.guard', 'ls /root/projects/gamja/data');
    ok('PP.fn', typeof redirectsOutside === 'function', 'redirectsOutside 내보냄'); }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n합계 ${results.length}건, 통과 ${results.length - failed.length}, 실패 ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('테스트 오류', e); process.exit(2); });
