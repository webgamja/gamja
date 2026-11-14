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

const crypto = require('crypto');
const MIG = JSON.stringify({ done: true, at: 1, count: 0, notified: true });
const V1X = '지침 v1\n';
const H = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);
(async () => {
  const d = fresh('upd'); fs.writeFileSync(path.join(d, 'data', 'perm-migration.json'), MIG);
  // 가짜 GitHub: index.json과 지침 파일을 돌려준다
  const MDGOOD = '# 원격 지침 v4\n'; let mdServe = MDGOOD;
  const idx = () => JSON.stringify({ format: 'gamja-crews', version: 1, crews: [{ id: 'c-site', latest: '4.0', hash: H(MDGOOD), official: true, old: [H(V1X)] }, { id: '../evil', latest: '1', hash: 'zz' }] });
  const fake = http.createServer((q, r) => {
    if (q.url === '/index.json') { r.end(idx()); return; }
    if (q.url === '/crews/c-site/4.0.md') { r.end(mdServe); return; }
    r.statusCode = 404; r.end('no');
  });
  await new Promise((rs) => fake.listen(0, '127.0.0.1', rs));
  const s = await startServer(d, { CREWS_BASE_URL: `http://127.0.0.1:${fake.address().port}` });
  const crew = '홈테스트';
  ok('mk', (await s.api('POST', '/api/projects', { name: crew })).status === 200);
  const V1 = '지침 v1\n';
  let r = await s.api('POST', '/api/project-settings', { project: crew, instructions: V1, tpl: { id: 'c-site', ver: '3.1' } });
  ok('settings', r.status === 200, r.status);
  let info = (await s.api('GET', '/api/projects')).json.crews?.[crew];
  ok('tpl.recorded', info?.tpl?.id === 'c-site' && info.tpl.ver === '3.1' && info.tpl.edited === false, JSON.stringify(info));
  ok('hash', info?.hash === H(V1), info?.hash + ' vs ' + H(V1));
  // 직접 수정 → edited
  const f = path.join(d, 'projects', crew, 'CLAUDE.md');
  fs.writeFileSync(f, V1 + '내가 고침\n');
  info = (await s.api('GET', '/api/projects')).json.crews[crew];
  ok('edited.true', info.tpl.edited === true);
  // 업데이트
  const V2 = '지침 v2\n';
  r = await s.api('POST', '/api/crew-update', { project: crew, tpl: { id: 'c-site', ver: '3.2' }, instructions: V2 });
  ok('update', r.status === 200 && r.json.info?.tpl?.ver === '3.2' && r.json.info.tpl.edited === false, JSON.stringify(r.json));
  ok('update.file', fs.readFileSync(f, 'utf8') === V2);
  ok('update.backup', r.json.info.backups === 1, r.json.info.backups);
  // 되돌리기
  r = await s.api('POST', '/api/crew-update-undo', { project: crew });
  ok('undo', r.status === 200, JSON.stringify(r.json));
  ok('undo.file', fs.readFileSync(f, 'utf8') === V1 + '내가 고침\n');
  info = (await s.api('GET', '/api/projects')).json.crews[crew];
  ok('undo.tpl', info.tpl.ver === '3.1' && info.tpl.edited === true && info.backups === 0, JSON.stringify(info));
  r = await s.api('POST', '/api/crew-update-undo', { project: crew });
  ok('undo.none404', r.status === 404, r.status);
  // 백업 3개 유지
  for (let i = 0; i < 5; i++) { await s.api('POST', '/api/crew-update', { project: crew, tpl: { id: 'c-site', ver: '3.2' }, instructions: 'x' + i + '\n' }); await sleep(20); }
  info = (await s.api('GET', '/api/projects')).json.crews[crew];
  ok('backup.max3', info.backups === 3, info.backups);
  // 이름 바꾸기 → 기록 이동
  r = await s.api('POST', '/api/projects/rename', { project: crew, newName: '홈테스트2' });
  ok('rename', r.status === 200, r.status);
  info = (await s.api('GET', '/api/projects')).json.crews['홈테스트2'];
  ok('rename.moved', info?.tpl?.ver === '3.2' && info.backups === 3, JSON.stringify(info));
  // 잘못된 입력
  r = await s.api('POST', '/api/crew-update', { project: crew, tpl: { id: 5, ver: 'x' }, instructions: 'x' });
  ok('bad.tpl', r.status >= 400 || !r.json.info?.tpl, r.status);
  // ---------- GitHub 크루 목록 ----------
  const c2 = '원격테스트';
  await s.api('POST', '/api/projects', { name: c2 });
  await s.api('POST', '/api/project-settings', { project: c2, instructions: V1X, tpl: { id: 'c-site', ver: '3.2' } });
  r = await s.api('GET', '/api/crew-index');
  ok('index.fetch', r.status === 200 && r.json.crews.length === 1 && r.json.crews[0].latest === '4.0' && r.json.crews[0].official === true, JSON.stringify(r.json));
  ok('index.drops.bad', !r.json.crews.some((c) => c.id.includes('evil')));
  ok('index.cached.file', fs.existsSync(path.join(d, 'data', 'crews-index.json')));
  r = await s.api('POST', '/api/crew-update', { project: c2, tpl: { id: 'c-site', ver: '3.9' }, remote: true });
  ok('remote.badver', r.status === 502, r.status + ' ' + r.json.error);
  mdServe = '# 바꿔치기\n';
  r = await s.api('POST', '/api/crew-update', { project: c2, tpl: { id: 'c-site', ver: '4.0' }, remote: true });
  ok('remote.hashmismatch', r.status === 502 && fs.readFileSync(path.join(d, 'projects', c2, 'CLAUDE.md'), 'utf8') === V1X, r.status + ' ' + r.json.error);
  mdServe = MDGOOD;
  r = await s.api('POST', '/api/crew-update', { project: c2, tpl: { id: 'c-site', ver: '4.0' }, remote: true });
  ok('remote.ok', r.status === 200 && fs.readFileSync(path.join(d, 'projects', c2, 'CLAUDE.md'), 'utf8') === MDGOOD && r.json.info.tpl.ver === '4.0' && r.json.info.backups === 1, r.status + JSON.stringify(r.json));
  mdServe = 'x'.repeat(70000); // 목록의 해시와 달라도, 크기 제한에서 먼저 막힌다
  r = await s.api('POST', '/api/crew-update', { project: c2, tpl: { id: 'c-site', ver: '4.0' }, remote: true });
  ok('remote.toolarge', r.status === 502, r.status);
  await new Promise((rs) => fake.close(rs)); // 인터넷 끊김
  r = await s.api('POST', '/api/crew-update', { project: c2, tpl: { id: 'c-site', ver: '4.0' }, remote: true });
  ok('remote.offline', r.status === 502 && /인터넷/.test(r.json.error), r.status + ' ' + r.json.error);
  r = await s.api('GET', '/api/crew-index?refresh=1');
  ok('index.offline.fallback', r.status === 200 && r.json.crews.length === 1, JSON.stringify(r.json));
  await s.stop();
  const bad = results.filter((x) => !x.pass).length;
  console.log(bad ? `FAILED ${bad}` : 'ALL PASS'); process.exit(bad ? 1 : 0);
})();
