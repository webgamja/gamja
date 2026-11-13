'use strict';
const TM = require('./test-mode'); // 시험용 주입 지점은 시험 모드에서만 (tools/test-mode.js)
// 채팅 zip 가져오기 (3단계): 저널(Journal)과 내구성 보조 도구
// - 저널 파일은 임시 이름에 쓰고 fsync → rename → 폴더 fsync 순서로 저장한다 (반쯤 쓰인 저널이 생기지 않게)
// - 테스트용 주입 지점(hit): 환경변수 GAMJA_TEST_CRASH / GAMJA_TEST_THROW / GAMJA_TEST_FSYNC 가 있을 때만 켜진다 (운영에서는 아무 일도 하지 않는다)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- 테스트용 주입 지점 ----------
// GAMJA_TEST_CRASH=<지점>[#<몇 번째>] : 그 지점에서 감자알을 강제로 끝낸다 (kill -9와 같은 SIGKILL)
// GAMJA_TEST_THROW=<지점>[:<오류코드>]  : 그 지점에서 오류를 낸다 (ENOSPC, EROFS, EXDEV 등)
// GAMJA_TEST_FSYNC=file|dir|dir-io|both  : fsync를 실패시킨다 (dir = 폴더 fsync 미지원 오류(EINVAL), dir-io = 폴더 fsync 입출력 오류(EIO), file = 파일 fsync 입출력 오류)
const counts = Object.create(null);
let fsyncArmed = !TM.env('FSYNC_AFTER'); // GAMJA_TEST_FSYNC_AFTER=<지점>: 그 지점을 지난 뒤부터만 fsync 실패를 주입
function hit(name) {
  if (name === TM.env('FSYNC_AFTER')) fsyncArmed = true;
  const c = TM.env('CRASH');
  if (c) {
    const [n, k] = c.split('#');
    if (n === name) {
      counts[name] = (counts[name] || 0) + 1;
      if (counts[name] === Number(k || 1)) process.kill(process.pid, 'SIGKILL');
    }
  }
  const t = TM.env('THROW');
  if (t) {
    const [n, code] = t.split(':');
    if (n === name) {
      const e = new Error(`테스트 주입: ${name}${code ? ' ' + code : ''}`);
      if (code) e.code = code;
      throw e;
    }
  }
}

// ---------- fsync ----------
const warnings = []; // 폴더 fsync가 안 되는 환경이면 한 번 기록해 둔다 (실제 상태를 기준으로 복구한다)
function warnOnce(msg) {
  if (!warnings.includes(msg)) { warnings.push(msg); console.error('내구성 경고:', msg); }
}
const UNSUPPORTED = new Set(['EINVAL', 'ENOTSUP', 'EPERM', 'ENOSYS', 'EBADF']);
// 내구성 정책 (문서: docs/stage3-test-report.md)
// - 파일 fsync 실패(미지원 오류 제외): 오류. 저널에 적은 내용이 디스크에 있다는 보장이 깨지므로 설치를 중단하고 되돌린다.
// - 폴더 fsync: 파일 시스템이 폴더 fsync를 지원하지 않는 오류(EINVAL 등)면 경고만 남기고 진행한다. 이때는 어떻게도 보장할 수 없고,
//   복구는 저널이 아니라 실제 폴더·파일 상태를 기준으로 하므로 안전하다.
//   그 밖의 실제 입출력 오류(EIO, ENOSPC, EROFS 등)는 파일 fsync와 똑같이 오류로 던진다. committed 이후의 정리 단계에서 나면
//   설치는 유지하고 다음 시작 때 복구가 마무리한다.
function injected(kind) {
  const f = TM.env('FSYNC');
  return fsyncArmed && (f === kind || f === 'both');
}
function fsyncFile(p) {
  if (injected('file')) { const e = new Error('테스트 주입: 파일 fsync 실패'); e.code = 'EIO'; throw e; }
  const fd = fs.openSync(p, 'r');
  try { fs.fsyncSync(fd); } catch (e) {
    if (UNSUPPORTED.has(e.code)) warnOnce(`파일 fsync를 지원하지 않아요 (${e.code})`); else throw e;
  } finally { fs.closeSync(fd); }
}
function fsyncDir(p) { // 지원하지 않으면 경고 후 false, 실제 오류는 던진다. 성공하면 true
  let fd;
  try {
    if (injected('dir')) { const e = new Error('테스트 주입: 폴더 fsync 미지원'); e.code = 'EINVAL'; throw e; }
    if (injected('dir-io')) { const e = new Error('테스트 주입: 폴더 fsync 입출력 오류'); e.code = 'EIO'; throw e; }
    fd = fs.openSync(p, 'r'); fs.fsyncSync(fd); return true;
  } catch (e) {
    if (UNSUPPORTED.has(e.code)) { warnOnce(`폴더 fsync를 지원하지 않아요 (${e.code}): ${path.basename(p)}`); return false; }
    throw e;
  } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* 무시 */ } }
}
// 폴더 안의 모든 파일과 폴더를 fsync (stage 폴더를 이름 바꾸기 전에)
function fsyncTree(root) {
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) { walk(fp); fsyncDir(fp); } else if (e.isFile()) fsyncFile(fp);
    }
  };
  walk(root);
  fsyncDir(root);
}

// 임시 이름에 쓰고 fsync → rename → 폴더 fsync
function writeDurable(file, data, mode = 0o600) {
  hit('write-durable');
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', mode);
    fs.writeSync(fd, data);
    fs.closeSync(fd); fd = undefined;
    fsyncFile(tmp);
    fs.renameSync(tmp, file);
  } catch (e) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* 무시 */ }
    try { fs.rmSync(tmp, { force: true }); } catch (_) { /* 무시 */ }
    throw e;
  }
  fsyncDir(path.dirname(file));
}

// 폴더 이름 바꾸기: 대상이 이미 있으면 거절한다 (빈 폴더 위에 덮어쓰는 일 방지). 끝나면 상위 폴더 fsync
function renameNew(from, to, hookName) {
  if (hookName) hit(hookName);
  try { fs.lstatSync(to); const e = new Error('이미 있는 이름이에요'); e.code = 'EEXIST'; throw e; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  fs.renameSync(from, to);
  fsyncDir(path.dirname(to));
}

// ---------- 저널 저장소 ----------
const TXID_RE = /^[0-9a-f]{24}$/;
function createJournalStore(dir) {
  const file = (txId) => path.join(dir, `${txId}.json`);
  return {
    dir,
    newId: () => crypto.randomBytes(12).toString('hex'),
    save(tx) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); writeDurable(file(tx.txId), JSON.stringify(tx)); },
    remove(txId) { // 지운 뒤 폴더 fsync가 실패해도 오류로 보지 않는다(전원이 나가 저널이 되살아나도 복구가 멱등으로 다시 마무리)
      fs.rmSync(file(txId), { force: true });
      try { fsyncDir(dir); } catch (e) { warnOnce(`저널 삭제 후 폴더 fsync 실패 (${e.code || e.message})`); }
    },
    // 저널 목록: { txs: [tx...], bad: [이름...], tmpRemoved: 수 }. 읽을 수 없는 저널은 .bad로 옮기고, 임시 이름은 지운다
    scan() {
      const out = { txs: [], bad: [], tmpRemoved: 0 };
      let names;
      try { names = fs.readdirSync(dir); } catch (e) { if (e.code === 'ENOENT') return out; throw e; }
      for (const n of names.sort()) {
        const fp = path.join(dir, n);
        if (/\.json\.tmp-/.test(n)) { try { fs.rmSync(fp, { force: true }); out.tmpRemoved++; } catch (_) { /* 무시 */ } continue; }
        const m = /^([0-9a-f]{24})\.json$/.exec(n);
        if (!m) continue; // .bad 등은 건드리지 않는다
        let tx = null;
        try { tx = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (_) { /* 아래에서 처리 */ }
        const ok = tx && typeof tx === 'object' && tx.txId === m[1] && typeof tx.state === 'string' && tx.targets && typeof tx.targets === 'object';
        if (!ok) {
          try { fs.renameSync(fp, `${fp}.bad`); fsyncDir(dir); } catch (_) { /* 무시 */ }
          out.bad.push(n);
          continue;
        }
        out.txs.push(tx);
      }
      return out;
    },
  };
}

module.exports = { hit, fsyncFile, fsyncDir, fsyncTree, writeDurable, renameNew, createJournalStore, warnings, TXID_RE };
