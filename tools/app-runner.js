'use strict';
// 🟢 켜 둔 앱: 크루가 만든 웹 서버를 감자알이 맡아서 계속 켜 둔다.
// 크루는 "gamja-make app start|stop|status|log|restart"로, 사용자는 결과물 화면의 버튼으로 다룬다.
// 규칙: ① 한 방에 하나, 폰 전체에 MAX_TOTAL개까지 ② 시작명령은 serve와 같은 것만 (쉘 없이, 그 방 폴더 안의 파일만)
// ③ 앱이 스스로 꺼지면 기록만 남기고 다시 켜지 않는다 ④ 감자알이 재시작하면 켜 두었던 앱을 다시 켠다
// 이 파일은 require해도 아무 일도 하지 않는다 (gamja-make도 checkStartCmd를 같이 쓴다)
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');

const MAX_TOTAL = 3;
const LOG_MAX = 256 * 1024; // 기록 파일이 이보다 커지면 켤 때 새로 시작한다 (이전 것은 .old로 하나 남김)
const DEFAULT_PORTS = [8080, 8081, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089];

// 시작명령 검사 (serve·app 공통). 문제가 있으면 사용자에게 보여 줄 문장을, 없으면 ''를 돌려준다
function checkStartCmd(cmdv, cwd) {
  if (!Array.isArray(cmdv) || !cmdv.length) return '시작명령이 빠졌어요. 예) -- node server.js';
  if (cmdv.length > 12 || cmdv.some((t) => typeof t !== 'string' || t.length > 200)) return '시작명령이 너무 길어요.';
  if (cmdv.some((t) => /[;&|`$<>()\n\r]/.test(t))) return '시작명령에는 ; & | ` $ < > ( ) 같은 문자를 쓸 수 없어요.';
  const [prog, ...rest] = cmdv;
  const inside = (p) => {
    const abs = path.resolve(cwd, p);
    if (abs !== cwd && !abs.startsWith(cwd + path.sep)) return `이 방 폴더 안의 파일만 쓸 수 있어요: ${p}`;
    if (path.relative(cwd, abs).split(path.sep).some((s) => s.startsWith('.'))) return `점(.)으로 시작하는 파일·폴더는 쓸 수 없어요: ${p}`;
    if (!fs.existsSync(abs)) return `파일이 없어요: ${p}`;
    return '';
  };
  if (prog === 'node' || prog === 'python3') {
    if (rest.some((t) => ['-e', '-p', '-c', '--eval', '--print', '-r', '--require', '--import', '--loader'].includes(t))) return '코드를 바로 적어 실행하는 옵션은 쓸 수 없어요. 파일로 만들어 주세요.';
    if (prog === 'python3' && rest[0] === '-m' && rest[1] === 'http.server') return ''; // 간단한 정적 서버는 허용
    if (rest.includes('-m')) return 'python3 -m은 http.server만 쓸 수 있어요.';
    const file = rest.find((t) => !t.startsWith('-'));
    if (!file) return `${prog} 다음에 실행할 파일 이름이 와야 해요.`;
    return inside(file);
  }
  if (prog === 'npm') {
    if ((rest[0] === 'start' && rest.length === 1) || (rest[0] === 'run' && /^[\w:-]+$/.test(rest[1] || '') && rest.length === 2)) return '';
    return 'npm은 "npm start" 또는 "npm run <이름>"만 쓸 수 있어요.';
  }
  return '시작명령은 node <파일> / npm start / npm run <이름> / python3 <파일> 만 쓸 수 있어요.';
}

function httpUp(port) {
  return new Promise((ok) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 3000, headers: { 'User-Agent': 'gamja-app' } }, (res) => { res.resume(); ok(true); });
    req.on('timeout', () => { req.destroy(); ok(false); });
    req.on('error', () => ok(false));
  });
}
// 포트가 비었는지 (누가 듣고 있으면 false)
function portFree(port) {
  return new Promise((ok) => {
    const s = net.createConnection({ host: '127.0.0.1', port });
    s.setTimeout(1500);
    s.once('connect', () => { s.destroy(); ok(false); });
    s.once('timeout', () => { s.destroy(); ok(true); });
    s.once('error', () => ok(true));
  });
}
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// extraEnv(room): 켤 때마다 더해 줄 환경변수 (예: 연결된 GitHub 열쇠를 받는 git 설정). 켤 때 새로 읽으므로 설정을 바꾸면 restart로 반영된다
function createRunner({ dataDir, reservedPorts = [], extraEnv = () => ({}) }) {
  const stateFile = path.join(dataDir, 'apps.json');
  const logDir = path.join(dataDir, 'apps');
  const apps = new Map(); // room → 기록
  const procs = new Map(); // room → 자식 프로세스
  const busy = new Set(); // 켜거나 끄는 중인 방 (같은 방에 명령이 겹치지 않게)
  let closing = false; // 감자알이 꺼지는 중: 앱이 꺼져도 "스스로 꺼짐"으로 적지 않는다 (다시 켜질 때 되살린다)

  try {
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    for (const a of Array.isArray(saved) ? saved : []) if (a && typeof a.room === 'string') apps.set(a.room, a);
  } catch { /* 처음이거나 못 읽으면 빈 목록 */ }
  function save() {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(stateFile + '.tmp', JSON.stringify([...apps.values()], null, 1));
      fs.renameSync(stateFile + '.tmp', stateFile);
    } catch (e) { console.error('켜 둔 앱 기록을 저장하지 못했어요:', e.message); }
  }
  const logFile = (room) => path.join(logDir, crypto.createHash('sha1').update(room).digest('hex').slice(0, 16) + '.log');
  const running = () => [...apps.values()].filter((a) => a.state === 'running' || a.state === 'starting');

  function view(a) {
    if (!a) return null;
    return { state: a.state, port: a.port, cmd: a.cmd.join(' '), dir: a.dir || '', startedAt: a.startedAt || 0, endedAt: a.endedAt || 0, exitCode: a.exitCode ?? null, note: a.note || '' };
  }
  function tail(room, lines = 60) {
    const n = Math.min(300, Math.max(1, Number(lines) || 60));
    try {
      const f = logFile(room);
      const size = fs.statSync(f).size;
      const len = Math.min(size, 64 * 1024);
      const fd = fs.openSync(f, 'r');
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      fs.closeSync(fd);
      return buf.toString('utf8').split('\n').slice(-n - 1).join('\n').trim();
    } catch { return ''; }
  }
  function killGroup(pid, sig) { try { process.kill(-pid, sig); } catch { try { process.kill(pid, sig); } catch { /* 이미 끝남 */ } } }

  async function start({ room, cwd, cmd, port }) {
    if (busy.has(room)) return { error: '이 방의 앱을 켜거나 끄는 중이에요. 잠시 뒤에 다시 해 주세요.' };
    const cur = apps.get(room);
    if (cur && (cur.state === 'running' || cur.state === 'starting')) return { error: `이 방의 앱이 이미 켜져 있어요 (포트 ${cur.port}). 고친 코드를 반영하려면 restart, 끄려면 stop을 써 주세요.`, app: view(cur) };
    const bad = checkStartCmd(cmd, cwd);
    if (bad) return { error: bad };
    if (running().length >= MAX_TOTAL) return { error: `켜 둘 수 있는 앱은 폰 전체에 ${MAX_TOTAL}개까지예요. 다른 방의 앱을 먼저 꺼 주세요.` };
    let p = Number(port) || 0;
    if (p) {
      if (!Number.isInteger(p) || p < 1024 || p > 65535) return { error: '포트는 1024~65535 사이 숫자여야 해요.' };
      if (reservedPorts.includes(p)) return { error: `${p}번 포트는 감자가 쓰고 있어요. 다른 번호를 써 주세요.` };
      if (!(await portFree(p))) return { error: `${p}번 포트는 이미 다른 프로그램이 쓰고 있어요. 다른 번호를 써 주세요.` };
    } else {
      for (const c of DEFAULT_PORTS) if (!reservedPorts.includes(c) && await portFree(c)) { p = c; break; }
      if (!p) return { error: '8080~8089 포트가 모두 쓰이고 있어요. --port로 번호를 정해 주세요.' };
    }
    busy.add(room);
    try { return await launch({ room, cwd, cmd, port: p }); } finally { busy.delete(room); }
  }

  async function launch({ room, cwd, cmd, port }) {
    fs.mkdirSync(logDir, { recursive: true });
    const lf = logFile(room);
    try { if (fs.statSync(lf).size > LOG_MAX) fs.renameSync(lf, lf + '.old'); } catch { /* 기록 파일이 아직 없음 */ }
    fs.appendFileSync(lf, `\n=== ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} 켬: ${cmd.join(' ')} (포트 ${port}) ===\n`);
    const fd = fs.openSync(lf, 'a');
    let more = {};
    try { more = extraEnv(room) || {}; } catch { /* 더할 환경변수를 못 구해도 앱은 켠다 */ }
    const env = { ...more, PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG || 'C.UTF-8', TMPDIR: process.env.TMPDIR || '/tmp', NODE_ENV: 'development', PORT: String(port), HOST: '127.0.0.1' };
    let child;
    try { child = spawn(cmd[0], cmd.slice(1), { cwd, env, stdio: ['ignore', fd, fd], detached: true }); } catch (e) { fs.closeSync(fd); return { error: `시작하지 못했어요: ${e.message}` }; }
    fs.closeSync(fd);
    const a = { room, cwd, dir: path.relative(room, cwd), cmd, port, pid: child.pid, state: 'starting', startedAt: Date.now(), endedAt: 0, exitCode: null, note: '', want: true };
    apps.set(room, a);
    procs.set(room, child);
    child.on('error', (e) => { fs.appendFileSync(lf, `[감자] 실행 오류: ${e.message}\n`); });
    child.on('exit', (code, sig) => {
      procs.delete(room);
      if (apps.get(room) !== a || closing) return;
      a.endedAt = Date.now(); a.exitCode = code ?? sig ?? null;
      if (a.state !== 'stopping') { a.state = 'crashed'; a.want = false; a.note = '앱이 스스로 꺼졌어요'; try { fs.appendFileSync(lf, `=== 앱이 꺼졌어요 (종료 코드 ${a.exitCode}) ===\n`); } catch {} }
      save();
    });
    save();
    // 켜질 때까지 기다린다 (어떤 응답이든 오면 켜진 것)
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      if (a.state === 'crashed') return { error: `앱이 켜지자마자 꺼졌어요 (종료 코드 ${a.exitCode}).`, log: tail(room, 30), app: view(a) };
      if (await httpUp(port)) { a.state = 'running'; save(); return { ok: true, app: view(a) }; }
      await sleep(400);
    }
    // 응답이 없으면 끈다 (아무도 모르는 프로그램을 남기지 않는다)
    await stopProc(a, '켜지지 않아서 껐어요');
    a.state = 'crashed'; a.want = false; save();
    return { error: `20초 안에 ${port}번 포트에서 응답이 없어서 껐어요. 앱이 PORT 환경변수를 쓰지 않으면 --port로 앱이 쓰는 포트를 알려 주세요.`, log: tail(room, 30), app: view(a) };
  }

  async function stopProc(a, note) {
    a.state = 'stopping';
    const child = procs.get(a.room);
    const pid = child ? child.pid : a.pid;
    if (pid) killGroup(pid, 'SIGTERM');
    const t0 = Date.now();
    while (Date.now() - t0 < 3000 && (procs.has(a.room) || (pid && alive(pid)))) await sleep(150);
    if (pid && (procs.has(a.room) || alive(pid))) killGroup(pid, 'SIGKILL');
    await sleep(200);
    a.state = 'stopped'; a.endedAt = Date.now(); a.want = false; a.note = note || '';
    try { fs.appendFileSync(logFile(a.room), `=== ${note || '껐어요'} ===\n`); } catch {}
  }

  async function stop(room, note = '껐어요') {
    const a = apps.get(room);
    if (!a || !(a.state === 'running' || a.state === 'starting')) return { error: '이 방에 켜져 있는 앱이 없어요.', app: view(a) };
    if (busy.has(room)) return { error: '이 방의 앱을 켜거나 끄는 중이에요. 잠시 뒤에 다시 해 주세요.' };
    busy.add(room);
    try { await stopProc(a, note); save(); return { ok: true, app: view(a) }; } finally { busy.delete(room); }
  }

  async function restart(room) {
    const a = apps.get(room);
    if (!a) return { error: '이 방에서 켠 적 있는 앱이 없어요. 먼저 start로 켜 주세요.' };
    if (a.state === 'running' || a.state === 'starting') { const r = await stop(room, '다시 켜려고 껐어요'); if (r.error) return r; }
    return start({ room, cwd: a.cwd, cmd: a.cmd, port: a.port });
  }

  function status(room) { return view(apps.get(room)); }

  // 감자알이 켜질 때: 켜 두었던 앱을 다시 켠다. 감자알이 갑자기 죽어서 앱이 남아 있으면 먼저 끈다 (그 방 폴더에서 돈 프로그램일 때만)
  async function restore() {
    for (const a of [...apps.values()]) {
      if (a.pid && alive(a.pid)) {
        let same = false;
        try { same = fs.realpathSync(`/proc/${a.pid}/cwd`) === fs.realpathSync(a.cwd); } catch { /* 확인할 수 없으면 건드리지 않는다 */ }
        if (same) { killGroup(a.pid, 'SIGTERM'); await sleep(1500); if (alive(a.pid)) killGroup(a.pid, 'SIGKILL'); await sleep(200); }
      }
      if (a.want && (a.state === 'running' || a.state === 'starting')) {
        a.state = 'stopped';
        if (!fs.existsSync(a.cwd)) { a.want = false; a.note = '방 폴더가 없어서 다시 켜지 못했어요'; continue; }
        for (let i = 0; i < 20 && !(await portFree(a.port)); i++) await sleep(500); // 이전 감자알이 앱을 끄는 중일 수 있다
        const r = await start({ room: a.room, cwd: a.cwd, cmd: a.cmd, port: a.port });
        if (r.error) { const b = apps.get(a.room); if (b) b.note = `감자 재시작 뒤 다시 켜지 못했어요: ${r.error}`; }
      } else if (a.state === 'running' || a.state === 'starting' || a.state === 'stopping') { a.state = 'stopped'; }
    }
    save();
  }

  // 감자알이 꺼질 때 (동기): 켜 둔 앱을 같이 끈다. 다시 켜질 때 restore가 되살리도록 want는 그대로 둔다
  function killAll() {
    closing = true;
    for (const [, child] of procs) killGroup(child.pid, 'SIGTERM');
  }

  // 방이 지워질 때 등
  async function forget(room) { if (apps.get(room)?.state === 'running') await stop(room); apps.delete(room); save(); }

  return { start, stop, restart, status, tail, restore, killAll, forget, list: () => [...apps.values()].map(view) };
}

module.exports = { checkStartCmd, createRunner, MAX_TOTAL };
