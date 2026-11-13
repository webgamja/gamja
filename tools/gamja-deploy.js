#!/usr/bin/env node
'use strict';
// 안전한 배포 도구: 점검 모드 → 작업 끝 기다리기(Drain) → 백업 → 파일 교체 → (재시작은 감자알의 기존 장치) → 검증 → 점검 해제.
// 사용: node tools/gamja-deploy.js <명령> --app <앱 폴더> --data <DATA_DIR> [옵션]
//   begin    --candidate <폴더> --manifest <파일> [--base <파일>] [--allow-room 방] [--timeout 초] [--message 문구]   점검 켜기 → Drain → 백업
//            --base: 후보를 만들 때 본 운영 파일의 지문(sha256 + 경로, 없는 파일은 0을 64개). 지금 디스크가 다르면 덮어쓰지 않고 멈춘다
//   swap                                                                                        파일 교체(실패하면 자동 복원) → 재시작 요청 파일
//   verify   [--timeout 초] [--port N]                                                          새 코드로 돌고 있는지 확인 → 맞으면 점검 해제
//   rollback [--timeout 초]                                                                     백업으로 되돌리기 (필요하면 재시작 요청) → 확인 후 점검 해제
//   recover                                                                                     교체 도중 이 도구가 죽었을 때: 백업으로 복원
//   maint-on / maint-off / drain / status                                                       점검 모드·작업 현황만 따로
// 이 도구는 운영에서 쓰려면 별도 승인이 필요하다. 시험은 staging(별도 폴더·별도 DATA_DIR)에서만 한다.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const M = require('./maintenance');

const SKIP_TOP = new Set(['data', '.env', 'node_modules', '.git']); // server.js의 SKIP_TOP과 같아야 한다 (코드 지문 계산이 같아야 하므로)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
function parseArgs(argv) {
  const o = { _: [], allow: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      if (k === 'allow-room') o.allow.push(String(v)); else o[k] = v;
    } else o._.push(a);
  }
  return o;
}
// server.js의 codeHash()와 같은 계산 (실행 중인 코드의 지문과 비교하기 위해)
function codeHash(dir) {
  const h = crypto.createHash('sha256');
  (function walk(d, rel) {
    for (const name of fs.readdirSync(d).sort()) {
      if (!rel && SKIP_TOP.has(name)) continue;
      const full = path.join(d, name);
      if (fs.statSync(full).isDirectory()) walk(full, rel + name + '/');
      else h.update(rel + name).update('\0').update(fs.readFileSync(full));
    }
  })(dir, '');
  return h.digest('hex').slice(0, 12);
}
function writeJson(file, obj) {
  const tmp = `${file}.tmp-${process.pid}`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeSync(fd, JSON.stringify(obj, null, 1)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function readManifest(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([0-9a-f]{64})\s+(\S.*)$/);
    if (!m) { if (line.trim()) throw new Error(`매니페스트 줄을 읽을 수 없어요: ${line.slice(0, 60)}`); continue; }
    if (m[2].startsWith('/') || m[2].split('/').includes('..') || SKIP_TOP.has(m[2].split('/')[0])) throw new Error(`허용되지 않는 경로: ${m[2]}`);
    out.push({ rel: m[2], sha: m[1] });
  }
  if (!out.length) throw new Error('매니페스트가 비어 있어요');
  return out;
}
// 후보를 만든 시점의 운영 파일 지문(기준). 그 뒤에 운영 파일이 바뀌었으면 후보가 그 변경을 덮어쓰게 되므로 멈춘다
const ABSENT = '0'.repeat(64);
function baseMismatch(P, baseFile) {
  const bad = [];
  for (const e of readManifest(baseFile)) { const now = fileSha(path.join(P.app, e.rel)) || ABSENT; if (now !== e.sha) bad.push(e.rel); }
  return bad;
}
const fileSha = (f) => { try { return sha256(fs.readFileSync(f)); } catch { return null; } };
// 교체 순서: tools → server.js → public (시작할 때 읽는 파일이 먼저, 요청마다 읽는 화면이 마지막)
const order = (list) => [...list.filter((e) => e.rel.startsWith('tools/')), ...list.filter((e) => e.rel === 'server.js'), ...list.filter((e) => e.rel.startsWith('public/')), ...list.filter((e) => !/^(tools\/|public\/)/.test(e.rel) && e.rel !== 'server.js')];

// ---- 작업 현황 읽기 ----
const paths = (o) => ({ app: path.resolve(String(o.app || '')), data: path.resolve(String(o.data || '')), journal: path.join(path.resolve(String(o.data || '')), 'deploy-journal.json'), act: path.join(path.resolve(String(o.data || '')), 'activity-state.json'), flag: path.join(path.resolve(String(o.data || '')), 'restart-request') });
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
function readActivity(P) {
  const st = readJson(P.act);
  if (!st || st.v !== 1) return { ok: false, why: '작업 현황 파일이 없거나 읽을 수 없어요' };
  if (Date.now() - st.updatedAt > 3000) return { ok: false, why: `작업 현황이 ${Math.round((Date.now() - st.updatedAt) / 1000)}초째 갱신되지 않아요 (감자알이 멈췄거나 꺼짐)`, st };
  if (!pidAlive(st.pid)) return { ok: false, why: `감자알(pid ${st.pid})이 살아 있지 않아요`, st };
  return { ok: true, st };
}
// 점검 중이고 작업이 모두(허용한 작업방의 답변은 제외) 끝났는지. 두 번 연속 0이어야 성공 (판정과 신규 요청 차단 사이의 틈을 닫는다)
async function drain(P, { timeoutS = 60, except = null } = {}) {
  const t0 = Date.now(); let zeros = 0; let last = null;
  while (true) {
    const flag = M.readState(path.join(P.data, M.FILE_NAME));
    if (!flag.on) return { ok: false, code: 'not-in-maintenance', why: '점검 모드가 꺼져 있어요' };
    const a = readActivity(P);
    if (!a.ok) { zeros = 0; last = { why: a.why }; }
    else if (a.st.maintenance.since !== flag.since || !a.st.maintenance.on) { zeros = 0; last = { why: '감자알이 아직 이번 점검 파일을 보지 못했어요' }; }
    else {
      const ex = new Set(except || flag.allowRooms || []);
      const left = a.st.items.filter((i) => !((i.kind === 'chat' || i.kind === 'group-chat') && ex.has(i.room)));
      // items는 50개까지만 남기므로 총합과 다르면 모자란 만큼 남은 것으로 본다
      const hidden = a.st.total - a.st.items.length;
      last = { total: left.length + Math.max(0, hidden), by: a.st.by, items: left };
      if (last.total === 0) { zeros++; if (zeros >= 2) return { ok: true, waitedMs: Date.now() - t0, boot: a.st.boot, pid: a.st.pid, hash: a.st.hash }; } else zeros = 0;
    }
    if (Date.now() - t0 > timeoutS * 1000) return { ok: false, code: 'drain-timeout', why: `${timeoutS}초 안에 끝나지 않았어요`, remaining: last, waitedMs: Date.now() - t0 };
    await sleep(zeros ? 1000 : 400);
  }
}

// ---- 백업·복원 ----
function backupFiles(P, list, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const index = {};
  for (const e of list) {
    const src = path.join(P.app, e.rel);
    if (fs.existsSync(src)) {
      const dst = path.join(dir, 'files', e.rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      const h = fileSha(dst);
      if (h !== fileSha(src)) throw new Error(`백업 확인 실패: ${e.rel}`);
      index[e.rel] = h;
    } else index[e.rel] = null; // 새 파일: 복원할 때 지운다
  }
  writeJson(path.join(dir, 'index.json'), { v: 1, at: Date.now(), index });
  return index;
}
function restore(P, dir) {
  const idx = readJson(path.join(dir, 'index.json'));
  if (!idx) throw new Error('백업 목록을 읽을 수 없어요');
  const failed = [];
  for (const [rel, h] of Object.entries(idx.index)) {
    const dst = path.join(P.app, rel);
    try {
      if (h === null) { fs.rmSync(dst, { force: true }); continue; }
      if (fileSha(dst) === h) continue;
      const src = path.join(dir, 'files', rel);
      if (fileSha(src) !== h) throw new Error('백업 파일이 손상됨');
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst + '.new');
      fs.renameSync(dst + '.new', dst);
    } catch (e) { failed.push(`${rel}: ${e.message}`); }
  }
  return failed;
}
function diskMatches(P, list) { return list.filter((e) => fileSha(path.join(P.app, e.rel)) !== e.sha).map((e) => e.rel); }

function getJournal(P) { const j = readJson(P.journal); return j && j.v === 1 ? j : null; }
function setJournal(P, j) { writeJson(P.journal, { ...j, v: 1, updatedAt: Date.now() }); }
const out = (obj, code = 0) => { console.log(JSON.stringify(obj, null, 1)); process.exit(code); };

async function httpMe(port) {
  return new Promise((ok) => { http.get({ host: '127.0.0.1', port, path: '/api/me', timeout: 2000 }, (r) => { const c = []; r.on('data', (x) => c.push(x)); r.on('end', () => { try { ok({ status: r.statusCode, json: JSON.parse(Buffer.concat(c)) }); } catch { ok({ status: r.statusCode, json: {} }); } }); }).on('error', () => ok({ status: 0, json: {} })).on('timeout', function () { this.destroy(); }); });
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const cmd = o._[0];
  const P = paths(o);
  if (!cmd || !o.data) { console.error('사용법은 파일 맨 위 주석을 보세요 (--app, --data 필요)'); process.exit(2); }
  if (cmd === 'status') {
    const flag = M.readState(path.join(P.data, M.FILE_NAME)); const a = readActivity(P); const j = getJournal(P);
    return out({ maintenance: flag, activity: a.ok ? { total: a.st.total, by: a.st.by, hash: a.st.hash, pid: a.st.pid } : { unavailable: a.why }, journal: j && { phase: j.phase, id: j.id }, diskHash: o.app ? codeHash(P.app) : undefined });
  }
  if (cmd === 'maint-on') { const b = M.writeState(P.data, { message: typeof o.message === 'string' ? o.message : undefined, reason: o.reason, allowRooms: o.allow }); return out({ ok: true, state: b }); }
  if (cmd === 'maint-off') { M.clearState(P.data); return out({ ok: true }); }
  if (cmd === 'drain') { const r = await drain(P, { timeoutS: Number(o.timeout) || 60 }); return out(r, r.ok ? 0 : 3); }

  if (cmd === 'begin') {
    if (!o.app || !o.candidate || !o.manifest) { console.error('--app --candidate --manifest 필요'); process.exit(2); }
    if (getJournal(P) && !['done', 'rolled-back'].includes(getJournal(P).phase)) return out({ ok: false, code: 'journal-open', why: `끝나지 않은 배포 기록이 있어요 (${getJournal(P).phase}). status/recover/rollback부터` }, 4);
    const list = order(readManifest(path.resolve(o.manifest)));
    const cand = path.resolve(o.candidate);
    // 후보가 매니페스트와 같은지 (점검을 켜기 전에 확인: 잘못된 후보로 사용자를 막지 않는다)
    const bad = list.filter((e) => fileSha(path.join(cand, e.rel)) !== e.sha).map((e) => e.rel);
    if (bad.length) return out({ ok: false, code: 'candidate-mismatch', why: '후보 파일이 매니페스트와 달라요', files: bad.slice(0, 10) }, 4);
    if (o.base) {
      let bb; try { bb = baseMismatch(P, path.resolve(String(o.base))); } catch (e) { return out({ ok: false, code: 'base-unreadable', why: e.message }, 4); }
      if (bb.length) return out({ ok: false, code: 'base-changed', why: '후보를 만든 뒤에 운영 파일이 바뀌었어요. 후보를 다시 만들어야 해요', files: bb.slice(0, 10) }, 4);
    }
    // 실행 중 코드 = 디스크 코드여야 백업이 "지금 돌고 있는 코드"가 된다
    const a0 = readActivity(P);
    const diskHash0 = codeHash(P.app);
    M.writeState(P.data, { message: typeof o.message === 'string' ? o.message : '감자를 새 버전으로 바꾸는 중이에요. 잠시 뒤에 다시 시도해 주세요.', reason: 'deploy', allowRooms: o.allow });
    const d = await drain(P, { timeoutS: Number(o.timeout) || 60 });
    if (!d.ok) { // Drain 실패: 점검은 풀고(사용자가 계속 쓸 수 있게) 아무것도 바꾸지 않는다. 일을 강제로 끊지 않는다
      M.clearState(P.data);
      return out({ ok: false, code: d.code, why: d.why, remaining: d.remaining, note: '아무것도 바꾸지 않았고 점검 모드는 해제했어요' }, 3);
    }
    if (d.hash !== diskHash0) {
      M.clearState(P.data);
      return out({ ok: false, code: 'running-differs-from-disk', why: `실행 중인 코드(${d.hash})와 디스크의 코드(${diskHash0})가 달라요. 백업이 실행 중인 코드와 다를 수 있어서 멈췄어요`, note: '점검 모드는 해제했어요. 먼저 재시작해서 맞춘 뒤 다시 하세요' }, 4);
    }
    if (o.base) { // Drain을 기다리는 동안에도 운영 파일이 바뀌지 않았는지 한 번 더
      const bb = baseMismatch(P, path.resolve(String(o.base)));
      if (bb.length) { M.clearState(P.data); return out({ ok: false, code: 'base-changed', why: '기다리는 동안 운영 파일이 바뀌었어요. 후보를 다시 만들어야 해요', files: bb.slice(0, 10), note: '점검 모드는 해제했어요' }, 4); }
    }
    const id = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const dir = path.join(P.data, 'deploy-backup', id);
    let index;
    try { index = backupFiles(P, list, dir); } catch (e) { M.clearState(P.data); return out({ ok: false, code: 'backup-failed', why: e.message, note: '점검 모드는 해제했어요' }, 4); }
    setJournal(P, { id, phase: 'backed-up', candidate: cand, manifest: path.resolve(o.manifest), backup: dir, hash0: d.hash, boot0: d.boot, pid0: d.pid, files: list.length, allow: o.allow });
    return out({ ok: true, id, hash0: d.hash, backup: dir, files: list.length, drainedMs: d.waitedMs });
  }

  if (cmd === 'swap') {
    const j = getJournal(P);
    if (!j || j.phase !== 'backed-up') return out({ ok: false, code: 'wrong-phase', why: `백업이 끝난 상태가 아니에요 (${j ? j.phase : '기록 없음'})` }, 4);
    const flag = M.readState(path.join(P.data, M.FILE_NAME));
    if (!flag.on) return out({ ok: false, code: 'not-in-maintenance', why: '점검 모드가 꺼져 있어서 교체하지 않아요' }, 4);
    const a = readActivity(P);
    if (!a.ok || a.st.pid !== j.pid0 || a.st.boot !== j.boot0) return out({ ok: false, code: 'process-changed', why: 'begin 이후 감자알이 바뀌었거나 응답이 없어요. 교체하지 않아요' }, 4);
    const left = a.st.items.filter((i) => !((i.kind === 'chat' || i.kind === 'group-chat') && new Set(flag.allowRooms).has(i.room)));
    if (left.length) return out({ ok: false, code: 'work-started', why: '그 사이 진행 중인 일이 생겼어요. 교체하지 않아요', remaining: left.slice(0, 10) }, 3);
    const list = order(readManifest(j.manifest));
    setJournal(P, { ...j, phase: 'swapping', done: [] });
    const done = [];
    try {
      for (const e of list) {
        const src = path.join(j.candidate, e.rel); const dst = path.join(P.app, e.rel);
        if (fileSha(src) !== e.sha) throw new Error(`후보 파일이 바뀌었어요: ${e.rel}`);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst + '.new');
        const fd = fs.openSync(dst + '.new', 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        if (fileSha(dst + '.new') !== e.sha) throw new Error(`복사본이 다릅니다: ${e.rel}`);
        fs.renameSync(dst + '.new', dst);
        done.push(e.rel);
      }
      const bad = diskMatches(P, list);
      if (bad.length) throw new Error(`교체 뒤 확인 실패: ${bad.slice(0, 3).join(', ')}`);
    } catch (e) {
      const failed = restore(P, j.backup);
      for (const e2 of list) { try { fs.rmSync(path.join(P.app, e2.rel) + '.new', { force: true }); } catch (_) { /* 정리 실패는 복원 결과에 영향 없음 */ } }
      const back = codeHash(P.app) === j.hash0;
      setJournal(P, { ...j, phase: back && !failed.length ? 'rolled-back' : 'restore-failed', error: e.message, restoreFailed: failed });
      if (back && !failed.length) M.clearState(P.data); // 실행 중 코드와 디스크가 다시 같아졌으니 점검 해제
      return out({ ok: false, code: 'swap-failed', why: e.message, restored: back && !failed.length, restoreFailed: failed, note: back && !failed.length ? '옛 파일로 복원했고 점검 모드를 해제했어요' : '복원도 일부 실패했어요. 점검 모드를 유지합니다. 수동 확인 필요' }, 5);
    }
    setJournal(P, { ...j, phase: 'swapped', newHash: codeHash(P.app), done });
    // 재시작 요청: 감자알이 답변이 끝난 뒤(작업이 끝났는지 한 번 더 확인하고) 검사 → 재시작한다
    fs.writeFileSync(P.flag, `배포 ${j.id}: ${list.length}개 파일 교체`);
    return out({ ok: true, swapped: list.length, newHash: codeHash(P.app), restartRequested: true });
  }

  if (cmd === 'verify') {
    const j = getJournal(P);
    if (!j || j.phase !== 'swapped') return out({ ok: false, code: 'wrong-phase', why: `교체가 끝난 상태가 아니에요 (${j ? j.phase : '기록 없음'})` }, 4);
    const list = readManifest(j.manifest);
    const t0 = Date.now(); const T = (Number(o.timeout) || 90) * 1000; let last = '';
    while (Date.now() - t0 < T) {
      const a = readActivity(P);
      if (a.ok) {
        if (a.st.hash === j.newHash && a.st.pid !== j.pid0 && !diskMatches(P, list).length) {
          if (o.port) { const me = await httpMe(Number(o.port)); if (me.status !== 200 || me.json.boot !== a.st.boot) { last = `/api/me 응답이 맞지 않아요 (${me.status})`; await sleep(500); continue; } }
          M.clearState(P.data);
          setJournal(P, { ...j, phase: 'done', verifiedAt: Date.now() });
          return out({ ok: true, runningHash: a.st.hash, restartedAfterMs: Date.now() - t0, released: true });
        }
        if (a.st.hash === j.hash0 && a.st.pid !== j.pid0) { last = 'old-code-after-restart'; } // start.sh 자동 복구로 옛 코드가 다시 떴을 수 있다
        else if (a.st.pid === j.pid0) last = '아직 옛 감자알이 돌고 있어요 (재시작 전이거나 검사 실패)';
        else last = `실행 중 코드 ${a.st.hash} ≠ 기대 ${j.newHash}`;
      } else last = a.why;
      await sleep(500);
    }
    const a = readActivity(P);
    setJournal(P, { ...j, phase: 'verify-failed', why: last });
    return out({ ok: false, code: 'verify-failed', why: last, running: a.ok ? a.st.hash : null, expected: j.newHash, old: j.hash0, note: '점검 모드는 유지합니다. rollback으로 되돌리세요' }, 6);
  }

  if (cmd === 'rollback' || cmd === 'recover') {
    const j = getJournal(P);
    if (!j || !j.backup) return out({ ok: false, code: 'no-journal', why: '되돌릴 배포 기록이 없어요' }, 4);
    if (cmd === 'recover' && j.phase !== 'swapping') return out({ ok: false, code: 'wrong-phase', why: `교체 도중에 멈춘 기록이 아니에요 (${j.phase})` }, 4);
    if (['done', 'rolled-back'].includes(j.phase)) return out({ ok: false, code: 'wrong-phase', why: `이미 끝난 배포예요 (${j.phase})` }, 4);
    if (!M.readState(path.join(P.data, M.FILE_NAME)).on) M.writeState(P.data, { message: '이전 버전으로 되돌리는 중이에요. 잠시 뒤에 다시 시도해 주세요.', reason: 'rollback', allowRooms: j.allow || [] });
    const failed = restore(P, j.backup);
    for (const e of readManifest(j.manifest)) fs.rmSync(path.join(P.app, e.rel) + '.new', { force: true });
    if (failed.length) { setJournal(P, { ...j, phase: 'restore-failed', restoreFailed: failed }); return out({ ok: false, code: 'restore-failed', files: failed, note: '점검 모드를 유지합니다' }, 5); }
    const disk = codeHash(P.app);
    if (disk !== j.hash0) { setJournal(P, { ...j, phase: 'restore-failed' }); return out({ ok: false, code: 'restore-mismatch', why: `복원 뒤 디스크 지문 ${disk} ≠ 원래 ${j.hash0}`, note: '점검 모드를 유지합니다' }, 5); }
    // 돌고 있는 코드가 옛 코드면 파일만 맞추면 끝. 새 코드가 돌고 있으면 재시작해서 옛 코드로 돌린다
    const T = (Number(o.timeout) || 90) * 1000; const t0 = Date.now(); let a = readActivity(P);
    if (a.ok && a.st.hash !== j.hash0) {
      fs.writeFileSync(P.flag, `되돌리기 ${j.id}`);
      const pid1 = a.st.pid;
      while (Date.now() - t0 < T) { await sleep(500); a = readActivity(P); if (a.ok && a.st.hash === j.hash0 && a.st.pid !== pid1) break; }
    }
    a = readActivity(P);
    if (a.ok && a.st.hash === j.hash0) {
      M.clearState(P.data);
      setJournal(P, { ...j, phase: 'rolled-back', rolledBackAt: Date.now() });
      return out({ ok: true, runningHash: a.st.hash, released: true });
    }
    setJournal(P, { ...j, phase: 'rollback-pending' });
    return out({ ok: false, code: 'rollback-not-confirmed', running: a.ok ? a.st.hash : null, expected: j.hash0, why: a.ok ? '파일은 되돌렸지만 아직 옛 코드로 돌지 않아요 (재시작 대기 중일 수 있어요: 답변이 끝나야 재시작돼요)' : a.why, note: '점검 모드를 유지합니다' }, 6);
  }
  console.error(`알 수 없는 명령: ${cmd}`); process.exit(2);
}
main().catch((e) => { console.error('오류:', e.message); process.exit(1); });
