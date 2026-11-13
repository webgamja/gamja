'use strict';
const TM = require('./test-mode'); // 시험용 주입 지점은 시험 모드에서만 (tools/test-mode.js)
// 채팅 zip 가져오기 (3단계): 저널을 쓰며 하는 단계별 설치, 되돌리기, 재시작 복구, 동시 변경 잠금, 격리
// 설계: docs/import-permission-safety-proposal.md 5절. 새 크루·새 방만 만들고 기존 크루·대화·권한은 건드리지 않는다.
const fs = require('fs');
const { parseJsonSafe } = require('./safe-json');
const DIAG_MAX_CONV = 512 * 1024 * 1024; // 앱이 쓴 대화 파일은 이보다 훨씬 작다
const path = require('path');
const crypto = require('crypto');
const zipTool = require('./gamja-zip');
const J = require('./import-journal');

class ImportError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

const CREW_RE = /^crew-[a-z0-9]{6}$/;
const ROOMDIR_RE = /^chat-[a-z0-9]{3,8}$/;
const ROOMID_RE = /^@[a-z0-9]{3,8}$/;
const IMPORT_RE = /^[0-9a-f]{32}$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 디스크 오류를 쉬운 말로
function friendly(e) {
  if (e instanceof ImportError) return { code: e.code, message: e.message, status: e.status };
  const c = e && e.code;
  if (c === 'ENOSPC') return { code: 'no-space', message: '저장 공간이 모자라서 가져오지 못했어요. 공간을 비운 뒤 다시 해 주세요.', status: 507 };
  if (c === 'EROFS' || c === 'EACCES' || c === 'EPERM') return { code: 'read-only', message: '저장 위치에 쓸 수 없어서 가져오지 못했어요. (읽기 전용이거나 권한이 없어요)', status: 500 };
  if (c === 'EXDEV') return { code: 'cross-device', message: '저장 위치가 서로 달라서 안전하게 옮길 수 없어 가져오지 못했어요.', status: 500 };
  if (c === 'EIO') return { code: 'disk-error', message: '디스크에 안전하게 기록하지 못해서 가져오지 못했어요.', status: 500 };
  return { code: 'install-failed', message: `가져오지 못했어요: ${e && e.message}`, status: 500 };
}

function createTx(d) {
  const JDIR = path.join(d.DATA_DIR, 'import-journal');
  const DONE = path.join(d.DATA_DIR, 'import-done');
  const TMP = path.join(d.DATA_DIR, 'import-tmp');
  const store = J.createJournalStore(JDIR);
  const st = { phase: 'ready', unhealthy: null, quarantine: new Map(), last: null, lock: null };

  // ----- 완료 기록 -----
  const doneFile = (id) => path.join(DONE, `${id}.json`);
  function writeDone(id, rec) {
    fs.mkdirSync(DONE, { recursive: true });
    J.writeDurable(doneFile(id), JSON.stringify({ ...rec, finishedAt: Date.now() }), 0o600);
  }
  function readDone(id) {
    try {
      const r = JSON.parse(fs.readFileSync(doneFile(id), 'utf8'));
      return r && typeof r === 'object' && typeof r.status === 'string' ? r : null;
    } catch (_) { return null; }
  }

  // ----- 경로: 저널에는 이름만 적고, 경로는 검증한 이름으로 다시 만든다 -----
  function validTx(tx) {
    const t = tx.targets;
    return typeof tx.txId === 'string' && J.TXID_RE.test(tx.txId) && IMPORT_RE.test(String(tx.importId || ''))
      && CREW_RE.test(String(t.crewFolder)) && ROOMDIR_RE.test(String(t.roomDir)) && ROOMID_RE.test(String(t.roomId))
      && String(t.roomDir).slice(5) === String(t.roomId).slice(1);
  }
  const paths = (tx) => ({
    crewDir: path.join(d.CREWS_DIR, tx.targets.crewFolder),
    roomDir: path.join(d.ROOMS_DIR, tx.targets.roomDir),
    conv: d.convFile(tx.targets.roomId),
    crewStage: path.join(d.CREWS_DIR, `.stage-${tx.txId}`),
    roomStage: path.join(d.ROOMS_DIR, `.stage-${tx.txId}`),
    zipDir: path.join(TMP, String(tx.importId)),
  });
  const rmTree = (p) => {
    fs.rmSync(p, { recursive: true, force: true });
    if (exists(path.dirname(p))) J.fsyncDir(path.dirname(p)); // 상위 폴더가 이미 없으면(시작 때 임시 폴더를 통째로 치운 경우) 할 일이 없다
  };
  const exists = (p) => { try { fs.lstatSync(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
  const modeOf = (file, dflt) => { try { return fs.statSync(file).mode & 0o777; } catch (_) { return dflt; } };
  const writeUi = () => J.writeDurable(d.UI_FILE, JSON.stringify(d.getUi()), modeOf(d.UI_FILE, 0o644));
  // 대화 파일 저장이 중간에 끊겨 남은 임시 파일을 치운다
  function rmConvTmp(tx) {
    const base = path.basename(paths(tx).conv);
    try { for (const n of fs.readdirSync(d.CONV_DIR)) if (n.startsWith(`${base}.tmp-`)) fs.rmSync(path.join(d.CONV_DIR, n), { force: true }); } catch (_) { /* 폴더 없음 */ }
  }

  // ----- 되돌리기 (설치 실패와 재시작 복구가 같은 함수를 쓴다, 여러 번 해도 같은 결과) -----
  // touchTargets=false: 새 이름이 이미 있어서 (우리가 만든 것이 아니라서) 설치를 시작하지 않은 경우. stage와 zip만 치운다
  function undoUi(tx) {
    const ui = d.getUi();
    const conflicts = [];
    let changed = false;
    const after = (tx.after && tx.after.ui) || {};
    for (const map of Object.keys(after)) {
      for (const key of Object.keys(after[map])) {
        const cur = ui[map] && ui[map][key];
        if (!cur || cur.v === null || cur.v === undefined) continue; // 이미 없거나 지운 표시: 할 일 없음
        if (sameJson(cur.v, after[map][key].v)) {
          const prev = tx.before && tx.before.ui && tx.before.ui[map] && tx.before.ui[map][key];
          ui[map][key] = prev ? { v: prev.v, ts: Date.now() } : { v: null, ts: Date.now() };
          changed = true;
        } else conflicts.push(`${map}.${key}`); // 그 사이 다른 곳이 바꿨다: 덮어쓰지 않는다
      }
    }
    if (changed) writeUi();
    return conflicts;
  }
  function rollback(tx, { touchTargets = true } = {}) {
    const p = paths(tx);
    const out = { conflicts: [] };
    if (touchTargets) {
      J.hit('rollback-start');
      if (exists(p.conv)) { fs.rmSync(p.conv, { force: true }); J.fsyncDir(d.CONV_DIR); }
      rmConvTmp(tx);
      d.dropConvCache(tx.targets.roomId);
      J.hit('rollback-after-conv');
      rmTree(p.roomDir);
      J.hit('rollback-after-room');
      rmTree(p.crewDir);
      J.hit('rollback-after-crew');
      out.conflicts = undoUi(tx);
      J.hit('rollback-after-ui');
      d.clearCrewPerms(tx.targets.crewFolder); // 새 이름의 권한 기억만 (메모리의 이번만 허용 포함)
    }
    rmTree(p.crewStage);
    rmTree(p.roomStage);
    rmTree(p.zipDir);
    return out;
  }

  // 설치 상태를 실제 파일로 확인하고, 어긋난 곳을 모두 적어서 돌려준다 (빈 배열 = 온전).
  // damaged: 대화 파일이 있는데 읽을 수 없거나 모양이 틀린 경우. 사용자가 크루를 지우거나 이름을 바꾼 것과는 다른, 데이터 자체의 문제다
  function diagnose(tx) {
    const p = paths(tx);
    const problems = [];
    let damaged = false;
    const isDir = (f) => { try { return fs.statSync(f).isDirectory(); } catch (_) { return false; } };
    if (!isDir(p.crewDir)) problems.push('크루 폴더가 없어요');
    if (!isDir(p.roomDir)) problems.push('방 폴더가 없어요');
    let c = null;
    let exists = false;
    try {
      const st = fs.statSync(p.conv);
      exists = true;
      if (st.size > DIAG_MAX_CONV) throw Object.assign(new Error('big'), { code: 'TOOBIG' }); // 너무 크면 읽지 않는다 (메모리 보호)
      try { c = parseJsonSafe(fs.readFileSync(p.conv), { maxBytes: DIAG_MAX_CONV, maxDepth: 64, maxNodes: 20000000 }); } catch (_) { c = null; }
    } catch (e) {
      if (e.code === 'TOOBIG') { problems.push('대화 파일이 비정상적으로 커요'); damaged = true; }
      else { problems.push(e.code === 'ENOENT' ? '대화 파일이 없어요' : `대화 파일을 읽을 수 없어요 (${e.code})`); if (e.code !== 'ENOENT') damaged = true; }
    }
    if (exists && !problems.some((x) => x.startsWith('대화 파일'))) {
      if (!c || typeof c !== 'object' || !Array.isArray(c.messages)) { problems.push('대화 파일이 깨졌어요'); damaged = true; }
      else if (c.dir !== tx.targets.roomDir || c.crew !== tx.targets.crewFolder) problems.push('대화 파일의 크루·방 정보가 달라요');
    }
    let e = null;
    try { e = d.getUi().crew && d.getUi().crew[tx.targets.crewFolder]; } catch (_) { /* 무시 */ }
    if (!(e && e.v)) problems.push('화면 정보에 이 크루가 없어요');
    return { problems, damaged };
  }
  const verifyInstalled = (tx) => diagnose(tx).problems.length === 0;
  const failedRec = (tx, reason, code) => ({ status: 'failed', sessionHash: tx.sessionHash, sha256: tx.sha256, reason, code });
  const doneRec = (tx) => ({ status: 'done', sessionHash: tx.sessionHash, sha256: tx.sha256, ...(tx.result || {}) });

  // ----- 동시 변경 잠금 (메모리에만 있다. 감자알이 죽으면 풀린다) -----
  const lock = {
    acquire(by) { if (st.lock) throw new ImportError('busy', '다른 가져오기를 마무리하는 중이에요.', 409); st.lock = { by, since: Date.now() }; },
    release() { st.lock = null; },
    held: () => !!st.lock,
  };

  // ----- 격리 -----
  // lock=false: 기록만 격리한다(데이터와 저널은 그대로, 화면과 API는 막지 않는다). 완료된 설치를 사용자가 지우거나 이름을 바꾼 경우에 쓴다
  function quarantineTx(tx, err, { lock = true } = {}) {
    st.quarantine.set(tx.txId, { crew: tx.targets.crewFolder, roomDir: tx.targets.roomDir, roomId: tx.targets.roomId, error: String(err && err.message || err).slice(0, 300), since: Date.now(), lock });
    try {
      if (tx.state !== 'quarantined') tx.prevState = tx.state;
      tx.state = 'quarantined';
      tx.error = String(err && err.message || err).slice(0, 300);
      store.save(tx);
    } catch (_) { /* 저널을 못 써도 메모리 격리는 유지 */ }
  }
  function isQuarantined(name) {
    if (!st.quarantine.size) return false;
    const s = String(name || '');
    const at = s.indexOf('@');
    const crew = at > 0 ? s.slice(0, at) : at < 0 ? s : '';
    for (const q of st.quarantine.values()) {
      if (q.lock === false) continue;
      if (s === q.crew || s === q.roomId || s === q.roomDir || (crew && crew === q.crew)) return true;
    }
    return false;
  }
  function quarantinedRoomIds() { return new Set([...st.quarantine.values()].filter((q) => q.lock !== false).map((q) => q.roomId)); }

  // ----- 설치 (저널을 쓰면서 단계별로) -----
  function pickNames() {
    const have = new Set(d.listProjects().map((n) => n.toLowerCase()));
    const crewChars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let crewFolder;
    for (;;) {
      crewFolder = 'crew-';
      for (let i = 0; i < 6; i++) crewFolder += crewChars[crypto.randomInt(crewChars.length)];
      if (!have.has(crewFolder) && !exists(path.join(d.CREWS_DIR, crewFolder))) break;
    }
    let rid;
    do { rid = `@${Math.random().toString(36).slice(2, 7).padEnd(5, '0')}`; }
    while (exists(d.convFile(rid)) || exists(path.join(d.ROOMS_DIR, `chat-${rid.slice(1)}`)));
    return { crewFolder, roomId: rid, roomDir: `chat-${rid.slice(1)}` };
  }
  // 저널에 "할 것"을 적고 → 실제로 하고 → "함"을 적는다. 어느 지점에서 꺼져도 복구가 실제 상태를 보고 되돌린다
  function step(tx, op, fn) {
    tx.steps.push({ op, done: false });
    store.save(tx);
    J.hit(`before-${op}`);
    J.hit(`do-${op}`);
    fn();
    J.hit(`after-${op}`);
    tx.steps[tx.steps.length - 1].done = true;
    store.save(tx);
    J.hit(`marked-${op}`);
  }
  // 준비 단계에서 실패: stage와 zip만 치운다 (기존 데이터는 한 줄도 바뀌지 않았다)
  function abortPreparing(tx, e) {
    const f = friendly(e);
    try { rollback(tx, { touchTargets: false }); } catch (_) { /* 남으면 다음 시작 때 정리 */ }
    try { writeDone(tx.importId, failedRec(tx, f.message, f.code)); } catch (_) { /* 무시 */ }
    try { store.remove(tx.txId); } catch (_) { /* 무시 */ }
    return f;
  }
  const throwFriendly = (f) => { throw new ImportError(f.code, f.message, f.status); };

  async function run(job, plan, handoff, limits) {
    const zip = path.join(TMP, job.id, 'upload.zip');
    const txId = store.newId();
    const tx = {
      txId, importId: job.id, sessionHash: job.sessionHash, sha256: job.sha256, state: 'preparing', startedAt: Date.now(),
      targets: pickNames(), stage: { crew: `.stage-${txId}`, room: `.stage-${txId}` }, before: null, after: null, result: null, steps: [],
    };
    const p = paths(tx);
    try { store.save(tx); } catch (e) { throwFriendly(friendly(e)); } // 저널을 못 쓰면 아무것도 만들지 않고 끝낸다
    let copied = 0;
    let hn;
    try {
      J.hit('after-preparing');
      fs.mkdirSync(d.CREWS_DIR, { recursive: true });
      fs.mkdirSync(d.ROOMS_DIR, { recursive: true });
      J.hit('mkdir-stage');
      fs.mkdirSync(p.crewStage);
      fs.mkdirSync(p.roomStage);
      J.fsyncDir(d.CREWS_DIR);
      J.fsyncDir(d.ROOMS_DIR);
      if (plan.mdText.trim()) J.writeDurable(path.join(p.crewStage, 'CLAUDE.md'), plan.mdText.endsWith('\n') ? plan.mdText : plan.mdText + '\n', 0o644);
      J.hit('extract');
      const budget = { left: limits.total };
      for (const f of plan.install) {
        const dest = path.join(p.roomStage, f.sub);
        if (!dest.startsWith(p.roomStage + path.sep)) throw new ImportError('unsafe-name', '안전하지 않은 파일 이름이에요.');
        await zipTool.extractVerified(zip, f.e, dest, { maxFile: limits.file, budget, ratio: limits.ratio }, p.roomStage);
        copied++;
      }
      J.hit('after-extract');
      if (TM.env('PREP_DELAY_MS')) await new Promise((r) => setTimeout(r, Number(TM.env('PREP_DELAY_MS')))); // 시험 전용: 준비 단계를 느리게 해서 다른 요청이 끼어들게 한다
      J.fsyncTree(p.roomStage);
      J.fsyncTree(p.crewStage);
      J.hit('after-stage');
      const sumDir = path.join(TMP, job.id, 'summary');
      fs.mkdirSync(sumDir, { recursive: true, mode: 0o700 });
      hn = await handoff(sumDir);
      J.hit('after-summary');
    } catch (e) { throwFriendly(abortPreparing(tx, e)); }

    const folder = tx.targets.crewFolder;
    const meta = { ...(plan.meta || {}), name: plan.displayName };
    const notice = `📥 다른 감자에서 가져왔어요${copied ? ` (결과물 ${copied}개)` : ''}\n\n${hn.note}`;
    const conv = { sessionId: null, messages: [...plan.msgs, { role: 'notice', text: notice, ts: Date.now() }].slice(-d.MAX_MESSAGES), participants: [folder], crew: folder, dir: tx.targets.roomDir, handoff: hn.note };
    const prefs = plan.cv && plan.cv.prefs;
    if (prefs && typeof prefs === 'object' && !Array.isArray(prefs) && JSON.stringify(prefs).length < 4000) conv.prefs = prefs;
    conv.updatedAt = Date.now();

    try { lock.acquire('import'); } catch (e) { throwFriendly(abortPreparing(tx, e)); }
    try {
      // 새 이름이 그 사이 생겼다면 우리가 만든 것이 아니므로 지우지 않고 설치를 그만둔다
      if (exists(p.crewDir) || exists(p.roomDir) || exists(p.conv)) throwFriendly(abortPreparing(tx, new ImportError('conflict', '새로 만들 이름이 이미 있어서 설치하지 않았어요. 다시 해 주세요.', 409)));
      try {
        tx.before = { ui: { crew: { [folder]: null } }, perms: { [folder]: null }, projectConf: { [folder]: null } };
        tx.after = { ui: { crew: { [folder]: { v: meta, ts: Date.now() } } } };
        tx.result = { roomId: tx.targets.roomId, crewFolder: folder, title: plan.title, displayName: plan.displayName, copied, summarized: hn.summarized, meta };
        tx.state = 'committing';
        store.save(tx);
        J.hit('after-committing');
        step(tx, 'rename-crew', () => J.renameNew(p.crewStage, p.crewDir));
        step(tx, 'rename-room', () => J.renameNew(p.roomStage, p.roomDir));
        step(tx, 'ui-perms', () => {
          const ui = d.getUi();
          if (!ui.crew) ui.crew = {};
          ui.crew[folder] = tx.after.ui.crew[folder];
          writeUi();
          d.clearCrewPerms(folder);
        });
        step(tx, 'conv', () => {
          fs.mkdirSync(d.CONV_DIR, { recursive: true });
          J.writeDurable(p.conv, JSON.stringify(conv), 0o644);
          d.dropConvCache(tx.targets.roomId);
        });
        // 완료 처리 (승인된 설계 순서): 저널 committed(fsync) → 완료 기록(fsync) → 저널 삭제 → zip 삭제 → 성공 응답
        tx.state = 'committed';
        store.save(tx);
        J.hit('after-committed');
      } catch (e) {
        const f = friendly(e);
        try {
          const r = rollback(tx);
          if (r.conflicts.length) console.error('되돌리기: 그 사이 바뀐 값은 덮어쓰지 않았어요:', r.conflicts.join(', '));
          tx.state = 'rolledback';
          try { store.save(tx); } catch (_) { /* 무시 */ }
          try { writeDone(job.id, failedRec(tx, f.message, f.code)); store.remove(tx.txId); } catch (_) { /* 저널이 남으면 다음 시작 때 마무리 */ }
        } catch (re) {
          console.error('되돌리기 실패, 격리합니다:', re.message);
          quarantineTx(tx, re);
          try { writeDone(job.id, failedRec(tx, f.message, f.code)); } catch (_) { /* 무시 */ }
        }
        throwFriendly(f);
      }
      // committed 이후의 오류는 설치를 되돌리지 않는다. 남은 정리는 다음 시작 때 복구가 마무리한다
      try {
        writeDone(job.id, doneRec(tx));
        J.hit('after-done-record');
        J.hit('before-journal-delete');
        store.remove(tx.txId);
        J.hit('after-journal-delete');
        rmTree(p.zipDir);
        J.hit('after-zip-removed');
      } catch (e) { console.error('가져오기 마무리 정리 실패 (저널은 다음 시작 때 정리돼요):', e.message); }
      return tx.result;
    } finally { lock.release(); }
  }

  // ----- 재시작 복구 -----
  function finishCommitted(tx) {
    const rec = readDone(tx.importId);
    if (!(rec && rec.status === 'done' && rec.roomId === tx.targets.roomId)) writeDone(tx.importId, doneRec(tx));
    rmTree(paths(tx).zipDir);
    store.remove(tx.txId);
  }
  function failAndRemove(tx, reason, code) {
    writeDone(tx.importId, failedRec(tx, reason, code));
    store.remove(tx.txId);
  }
  function handleTx(tx, sum) {
    const state = tx.state === 'quarantined' ? (tx.prevState || 'committing') : tx.state;
    const note = (r) => { if (r.conflicts.length) { sum.conflicts.push(...r.conflicts); console.error('복구: 그 사이 바뀐 값은 덮어쓰지 않았어요:', r.conflicts.join(', ')); } };
    if (state === 'preparing') {
      rollback(tx, { touchTargets: false });
      failAndRemove(tx, '가져오기가 끝나기 전에 감자알이 꺼져서 취소됐어요.', 'interrupted');
      sum.cleaned++;
    } else if (state === 'rolledback') {
      note(rollback(tx));
      failAndRemove(tx, '가져오지 못해서 되돌렸어요.', 'rolled-back');
      sum.rolledBack++;
    } else if (state === 'committed') {
      // committed = 설치가 끝까지 됐다는 뜻이다. 지금 어긋나 있다면 그 뒤에 사용자가 크루나 방을 지우거나 이름을 바꿨거나 파일이 상했을 수 있다.
      // 어느 쪽이든 되돌리기(삭제)는 하지 않는다. 사용자 데이터와 휴지통을 지우지 않고, 원인을 저널과 로그에 적어 격리한다
      const dg = diagnose(tx);
      if (tx.result && tx.result.roomId === tx.targets.roomId && !dg.problems.length) { finishCommitted(tx); sum.finished++; }
      else {
        const why = (tx.result && tx.result.roomId === tx.targets.roomId ? dg.problems : ['저널의 설치 결과가 올바르지 않아요']).join(', ');
        tx.diag = { problems: dg.problems, damaged: dg.damaged, at: Date.now() };
        console.error(`가져오기 복구: 완료된 설치가 어긋나 있어서 지우지 않고 격리합니다 (${tx.txId}): ${why}`);
        try { rmTree(paths(tx).zipDir); } catch (_) { /* 임시 zip만 치운다. 못 치우면 다음 시작 때 */ }
        try { const old = readDone(tx.importId); if (!(old && old.status === 'done')) writeDone(tx.importId, { status: 'unclear', sessionHash: tx.sessionHash, sha256: tx.sha256, reason: `설치는 끝났지만 지금 상태를 확인하지 못했어요: ${why}`, code: 'unclear', ...(tx.result || {}) }); } catch (_) { /* 무시 */ }
        quarantineTx(tx, `committed 확인 불일치: ${why}`, { lock: dg.damaged });
        sum.quarantined++;
      }
    } else { // committing (격리 상태였던 것 포함)
      note(rollback(tx));
      failAndRemove(tx, '가져오는 도중 감자알이 꺼져서 되돌렸어요. 다시 가져와 주세요.', 'rolled-back');
      sum.rolledBack++;
    }
  }
  // 가져오기 임시 폴더(import-tmp) 안의 주인 없는 폴더만 지운다. 아래 조건을 모두 만족하는 것만 지우고, 나머지는 그대로 둔다:
  // 이름이 가져오기 아이디 모양(32자리 16진수), 링크가 아닌 진짜 폴더, 안에 가져오기가 만드는 항목(upload.zip, summary)만 있음,
  // 아직 남아 있는 저널이 쓰는 아이디가 아님. 지울 때는 링크를 따라가지 않는다.
  function sweepOrphanTmp(keepIds) {
    const out = { removed: [], kept: [] };
    let top;
    try { top = fs.lstatSync(TMP); } catch (_) { return out; }
    if (!top.isDirectory()) { if (top.isSymbolicLink()) out.kept.push('(import-tmp 링크)'); return out; } // 링크는 따라가지 않는다
    let names = [];
    try { names = fs.readdirSync(TMP); } catch (_) { return out; }
    for (const n of names) {
      const fp = path.join(TMP, n);
      let ok = IMPORT_RE.test(n) && !keepIds.has(n);
      if (ok) {
        try {
          if (!fs.lstatSync(fp).isDirectory()) ok = false;
          else ok = fs.readdirSync(fp).every((x) => x === 'upload.zip' || x === 'summary');
        } catch (_) { ok = false; }
      }
      if (!ok) { out.kept.push(n); continue; }
      try { fs.rmSync(fp, { recursive: true, force: true }); out.removed.push(n); } catch (_) { out.kept.push(n); }
    }
    return out;
  }
  async function recover() {
    st.phase = 'recovering';
    st.unhealthy = null;
    st.quarantine.clear();
    const sum = { rolledBack: 0, finished: 0, cleaned: 0, bad: [], tmpRemoved: 0, quarantined: 0, conflicts: [] };
    try {
      const delay = Number(TM.env('RECOVER_DELAY_MS') || 0);
      if (delay) await sleep(delay);
      // 공유 데이터를 읽을 수 없으면 일관성을 확인할 수 없다: 아무것도 바꾸지 않고 관련 API를 막아 둔다
      try {
        if (fs.existsSync(d.UI_FILE)) {
          const u = JSON.parse(fs.readFileSync(d.UI_FILE, 'utf8'));
          if (!u || typeof u !== 'object' || Array.isArray(u)) throw new Error('모양이 올바르지 않아요');
        }
      } catch (e) { st.unhealthy = `ui-state를 읽을 수 없어요 (${e.message})`; }
      try { fs.readdirSync(d.CONV_DIR); } catch (e) { if (e.code !== 'ENOENT') st.unhealthy = `대화 폴더를 읽을 수 없어요 (${e.code})`; }
      if (st.unhealthy) { console.error('가져오기 복구를 건너뜁니다:', st.unhealthy); return sum; }
      try { for (const n of fs.readdirSync(path.dirname(d.UI_FILE))) if (n.startsWith(`${path.basename(d.UI_FILE)}.tmp-`)) fs.rmSync(path.join(path.dirname(d.UI_FILE), n), { force: true }); } catch (_) { /* 무시 */ }
      const sc = store.scan();
      sum.bad = sc.bad;
      sum.tmpRemoved = sc.tmpRemoved;
      for (const tx of sc.txs) {
        if (!validTx(tx)) { // 내용이 이상한 저널은 건드리지 않고 .bad로 옮긴다
          try { fs.renameSync(path.join(JDIR, `${tx.txId}.json`), path.join(JDIR, `${tx.txId}.json.bad`)); } catch (_) { /* 무시 */ }
          sum.bad.push(`${tx.txId}.json`);
          continue;
        }
        try { handleTx(tx, sum); } catch (e) {
          console.error('가져오기 복구 실패, 격리합니다:', tx.txId, e.message);
          quarantineTx(tx, e);
          sum.quarantined++;
        }
      }
      // 저널 없이 남은 stage 폴더
      for (const base of new Set([d.CREWS_DIR, d.ROOMS_DIR])) {
        let names = [];
        try { names = fs.readdirSync(base); } catch (_) { /* 폴더 없음 */ }
        for (const n of names) {
          const m = /^\.stage-([0-9a-f]{24})$/.exec(n);
          if (m && !exists(path.join(JDIR, `${m[1]}.json`))) { try { rmTree(path.join(base, n)); sum.cleaned++; } catch (_) { /* 무시 */ } }
        }
      }
      // 임시 zip 폴더 중 주인이 없는 것(저널 삭제 뒤 정리가 실패한 것, 검사만 하고 끝난 것)을 정리한다
      const keepIds = new Set(sc.txs.filter((t) => exists(path.join(JDIR, `${t.txId}.json`))).map((t) => String(t.importId)));
      const orphan = sweepOrphanTmp(keepIds);
      sum.orphanTmp = orphan.removed;
      sum.orphanKept = orphan.kept;
      sum.cleaned += orphan.removed.length;
      if (sum.rolledBack || sum.finished || sum.cleaned || sum.bad.length || sum.quarantined) console.log('가져오기 복구:', JSON.stringify({ ...sum, conflicts: sum.conflicts.length }));
      return sum;
    } catch (e) {
      st.unhealthy = `복구 중 오류: ${e.message}`;
      console.error(st.unhealthy);
      return sum;
    } finally {
      st.phase = st.unhealthy ? 'unhealthy' : 'ready';
      st.last = { ...sum, at: Date.now() };
    }
  }
  const info = () => ({
    phase: st.phase, unhealthy: st.unhealthy, locked: !!st.lock, quarantined: [...st.quarantine.values()],
    last: st.last, durabilityWarnings: J.warnings.slice(),
  });
  return { run, recover, lock, isQuarantined, quarantinedRoomIds, info, writeDone, readDone, state: st, store, paths, diagnose };
}

module.exports = { createTx, ImportError, friendly };
