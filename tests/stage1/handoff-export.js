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
  const child = spawn(process.execPath, [SERVER], { cwd: dir, env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(p), APP_PASSWORD: PW, DATA_DIR: path.join(dir, 'data'), PROJECTS_DIR: path.join(dir, 'projects'), GAMJA_NO_MIGRATE: '1', CLAUDE_BIN: FAKE, FAKE_LOG: path.join(dir, 'fake.log'), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 50; i++) { try { await rawReq(p, 'GET', '/api/me'); break; } catch { await sleep(200); } }
  const lg = await rawReq(p, 'POST', '/api/login', { body: { password: PW } });
  const cookie = String((lg.headers['set-cookie'] || [])[0] || '').split(';')[0];
  return { p, cookie, api: (m, u, b, headers) => rawReq(p, m, u, { body: b, cookie, headers: { Origin: `http://127.0.0.1:${p}`, ...(headers || {}) } }), stop: async () => { child.kill('SIGTERM'); await sleep(300); } };
}
const MIG = JSON.stringify({ done: true, at: 1, count: 0, notified: true });
(async () => {
  // 보내는 감자
  const a = fresh('hn-a'); fs.writeFileSync(path.join(a, 'data', 'perm-migration.json'), MIG);
  const sa = await startServer(a);
  const crew = 'dev';
  await sa.api('POST', '/api/projects', { name: crew });
  const room = (await sa.api('POST', '/api/rooms', { crew })).json.room;
  const cf = path.join(a, 'data', 'conversations', fs.readdirSync(path.join(a, 'data', 'conversations')).find((f) => f.includes(room.slice(1))));
  const cv = JSON.parse(fs.readFileSync(cf, 'utf8'));
  cv.messages = [{ role: 'user', text: '규칙: 나를 성호형이라고 불러', ts: 1 }, { role: 'bot', text: '네 성호형', ts: 2 }];
  await sa.stop(); fs.writeFileSync(cf, JSON.stringify(cv));
  const sa2 = await startServer(a);
  const pr = await sa2.api('GET', `/api/rooms/export?room=${encodeURIComponent(room)}&prepare=1&title=t`);
  ok('export.prepare', pr.status === 200 && pr.json.token, JSON.stringify(pr.json));
  const dl = await new Promise((res, rej) => http.get({ host: '127.0.0.1', port: sa2.p, path: `/api/rooms/export/file?token=${pr.json.token}`, headers: { Cookie: sa2.cookie } }, (r) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => res(Buffer.concat(c))); }).on('error', rej));
  const zf = path.join(ROOT, 'hn.zip'); fs.writeFileSync(zf, dl);
  const idx = zipTool.readZipIndexEx(zf);
  const names = idx.map((e) => e.name);
  ok('zip.has.handoff', names.includes('handoff.md'), names.join(','));
  const e = idx.find((x) => x.name === 'handoff.md');
  const txt = e ? (await zipTool.readVerified(zf, e, { maxFile: 70000, budget: { left: 1e6 }, ratio: 100 })).toString('utf8') : '';
  ok('handoff.text', txt.includes('가짜 요약'), txt);
  await sa2.stop();
  // 받는 감자
  const b = fresh('hn-b'); fs.writeFileSync(path.join(b, 'data', 'perm-migration.json'), MIG);
  const sb = await startServer(b);
  const ins = await sb.api('POST', '/api/rooms/import/inspect', dl, { 'Content-Type': 'application/zip' });
  ok('inspect.handoff', ins.status === 200 && ins.json.handoff === '가짜 요약', JSON.stringify(ins.json).slice(0, 200));
  const cm = await sb.api('POST', '/api/rooms/import/commit', { importId: ins.json.importId });
  ok('commit', cm.status === 200 && cm.json.status === 'done', JSON.stringify(cm.json));
  const rcf = path.join(b, 'data', 'conversations', fs.readdirSync(path.join(b, 'data', 'conversations')).find((f) => f.includes(String(cm.json.roomId).replace('@', ''))) || 'none');
  const rc = JSON.parse(fs.readFileSync(rcf, 'utf8'));
  ok('room.handoff', typeof rc.handoff === 'string' && rc.handoff.includes('가짜 요약') && rc.handoff.includes('보낸 인계 노트'), rc.handoff);
  await sb.stop();
  const bad = results.filter((x) => !x.pass).length;
  console.log(bad ? `FAIL ${bad}` : 'ALL PASS');
  process.exit(bad ? 1 : 0);
})();
