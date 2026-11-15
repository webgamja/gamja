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
  const child = spawn(process.execPath, [SERVER], { cwd: dir, env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(p), APP_PASSWORD: PW, DATA_DIR: path.join(dir, 'data'), PROJECTS_DIR: path.join(dir, 'projects'), GAMJA_NO_MIGRATE: '1', CLAUDE_BIN: FAKE, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 50; i++) { try { await rawReq(p, 'GET', '/api/me'); break; } catch { await sleep(200); } }
  const lg = await rawReq(p, 'POST', '/api/login', { body: { password: PW } });
  const cookie = String((lg.headers['set-cookie'] || [])[0] || '').split(';')[0];
  return { p, api: (m, u, b) => rawReq(p, m, u, { body: b, cookie }), stop: async () => { child.kill('SIGTERM'); await sleep(300); } };
}
const MIG = JSON.stringify({ done: true, at: 1, count: 0, notified: true });
(async () => {
  const d = fresh('readd'); fs.writeFileSync(path.join(d, 'data', 'perm-migration.json'), MIG);
  const s = await startServer(d);
  const crew = 'f-tarot';
  ok('mk', (await s.api('POST', '/api/projects', { name: crew })).status === 200);
  await s.api('POST', '/api/project-settings', { project: crew, instructions: '타로\n', tpl: { id: 'f-tarot', ver: '1.2.0' } });
  // 방 하나 더 + 대화
  const room = (await s.api('POST', '/api/rooms', { crew })).json.room;
  ok('room', /^@/.test(room), room);
  const convDir = path.join(d, 'data', 'conversations');
  const wr = (rid, text) => fs.writeFileSync(path.join(convDir, fs.readdirSync(convDir).find((f) => decodeURIComponent(f.replace(/\.json$/, '')).includes(rid)) || `${encodeURIComponent(rid)}.json`), text);
  void wr;
  const r0 = await s.api('POST', '/api/projects/delete', { project: crew });
  ok('delete', r0.status === 200, JSON.stringify(r0.json));
  let t = (await s.api('GET', '/api/trash')).json.items;
  ok('trash.listed', t.length === 1 && t[0].crew === crew && t[0].hasFolder && t[0].tpl === 'f-tarot', JSON.stringify(t));
  // 1) 보관 폴더가 있으면 되살림
  let r = await s.api('POST', '/api/archive/restore', { id: t[0].id });
  ok('restore.folder', r.status === 200 && fs.existsSync(path.join(d, 'projects', crew, 'CLAUDE.md')), JSON.stringify(r.json));
  ok('restore.rooms', r.json.rooms.some((x) => x.to === room), JSON.stringify(r.json.rooms));
  // 2) 폴더 정리된 뒤: 방만 되살림
  await s.api('POST', '/api/projects/delete', { project: crew });
  t = (await s.api('GET', '/api/trash')).json.items;
  fs.rmSync(path.join(d, 'data', 'trash'), { recursive: true, force: true });
  fs.readdirSync(path.join(d, 'projects')).filter((n) => n.startsWith('.trash')).forEach((n) => fs.rmSync(path.join(d, 'projects', n), { recursive: true, force: true }));
  t = (await s.api('GET', '/api/trash')).json.items;
  ok('trash.nofolder', t.length === 1 && !t[0].hasFolder, JSON.stringify(t));
  r = await s.api('POST', '/api/archive/restore', { id: t[0].id });
  ok('restore.nofolder404', r.status === 404, r.status);
  ok('mk2', (await s.api('POST', '/api/projects', { name: crew })).status === 200);
  r = await s.api('POST', '/api/archive/restore', { id: t[0].id, roomsOnly: true });
  ok('roomsOnly', r.status === 200 && r.json.rooms.some((x) => x.to === room), JSON.stringify(r));
  const conv = JSON.parse(fs.readFileSync(path.join(convDir, fs.readdirSync(convDir).find((f) => f.includes(room.slice(1))) || ''), 'utf8'));
  ok('room.crew', conv.crew === crew, JSON.stringify(conv).slice(0, 120));
  t = (await s.api('GET', '/api/trash')).json.items;
  ok('trash.empty', t.length === 0, JSON.stringify(t));
  await s.stop();
  const bad = results.filter((x) => !x.pass).length;
  console.log(bad ? `FAIL ${bad}` : 'ALL PASS');
  process.exit(bad ? 1 : 0);
})();
