#!/usr/bin/env node
'use strict';
// Claude Code의 PreToolUse 훅: Bash 명령과 웹 도구(WebSearch·WebFetch)를 실행하기 전에 위험 수준을 보고 결정한다.
//   safe → 허용 (묻지 않음) / danger → 차단 (카드 없음) / caution → 아무 말 없이 넘김 (감자알의 허용 카드로 이어진다)
// 어떤 오류가 나도 결정을 내리지 않는다 (기존 방식대로 카드로 물어본다).
// 사용: node perm-hook.js <감자알 폴더> <data 폴더>
const path = require('path');
const { tier, webTier } = require('./perm-policy');

let raw = '';
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    if (process.argv.includes('--codex')) { codex(input); return; }
    if (input.tool_name === 'WebSearch' || input.tool_name === 'WebFetch') {
      if (process.argv.includes('--allow-all')) { out('allow', ''); return; }
      const w = webTier(input.tool_name, input.tool_input || {});
      if (w.tier === 'safe') out('allow', '');
      else if (w.tier === 'danger') {
        record(input, `${input.tool_name}: ${String((input.tool_input || {}).url || '')}`, w.why);
        out('deny', `이 주소는 안전을 위해 열 수 없어요 (${w.why}). 같은 주소를 다시 시도하거나 우회하지 말고, 사용자에게 이유를 쉬운 말로 알려 주세요.`);
      }
      return;
    }
    if (input.tool_name !== 'Bash' || !input.tool_input || !input.tool_input.command) return;
    if (process.argv.includes('--allow-all')) { out('allow', ''); return; } // gamja 방: 모든 명령 허용
    const [appDir, dataDir] = process.argv.slice(2);
    const cwd = path.resolve(input.cwd || process.cwd());
    const inApp = appDir && (cwd === appDir || cwd.startsWith(appDir + path.sep));
    // 감자알을 고치는 개발 크루(감자알 폴더에서 일하는 크루)는 감자알 폴더 경로를 쓸 수 있다. 그 밖의 크루는 감자알 폴더와 data를 건드릴 수 없다
    const guard = inApp ? [] : [appDir, dataDir];
    let git = null; // 더보기 › GitHub에서 고른 저장소 (감자알이 써 둔다)
    try { git = JSON.parse(require('fs').readFileSync(path.join(dataDir, 'git-allow.json'), 'utf8')); } catch {}
    const r = tier(input.tool_input.command, guard, 0, { git, cwd });
    if (r.tier === 'safe') {
      out('allow', '');
    } else if (r.tier === 'danger') {
      record(input, input.tool_input.command, r.why);
      out('deny', `이 명령은 안전을 위해 쓸 수 없어요 (${r.why}). 같은 명령을 다시 시도하거나 우회하지 말고, 다른 방법으로 하거나 사용자에게 이유를 쉬운 말로 알려 주세요.`);
    }
  } catch { /* 결정하지 않음 */ }
});
// Codex 크루용 (--codex): Codex는 샌드박스 없이 돌기 때문에(proot에서 샌드박스가 안 된다) 이 훅이 감자의 3단계 안전장치를 맡는다.
//   명령: safe → 그대로 실행 / danger → 차단 (카드 없음) / caution → 차단하고 기록 → 감자알이 답변 뒤에 허용 카드로 물어본다
//   파일 고치기(apply_patch): 작업 폴더 안만 허용. 감자알 폴더·data는 감자알을 고치는 크루가 아니면 막는다
//   "허용"은 아무것도 출력하지 않는다 (Codex는 결정이 없으면 실행한다). 사용자가 허용 카드로 허용한 규칙은 GAMJA_PERM_RULES로 받는다
function codex(input) {
  if (process.argv.includes('--allow-all')) return; // gamja 방: 모든 명령 허용
  const [appDir, dataDir] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const cwd = real(path.resolve(input.cwd || process.cwd()));
  const inside = (p, dir) => !!dir && (p === dir || p.startsWith(dir + path.sep));
  const inApp = inside(cwd, appDir);
  const cmd = String((input.tool_input && input.tool_input.command) || '');
  if (!cmd) return;
  if (input.tool_name === 'apply_patch') {
    const files = [...cmd.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map((m) => real(path.resolve(cwd, m[1].trim())));
    const bad = files.find((f) => !(inside(f, cwd) || (inApp && inside(f, appDir))) || (!inApp && (inside(f, appDir) || inside(f, dataDir))));
    if (bad) {
      record(input, `파일 고치기: ${bad}`, '작업 폴더 밖');
      out('deny', '작업 폴더 밖의 파일은 이 방법으로 고칠 수 없어요. 사용자가 그 파일을 고쳐 달라고 직접 부탁한 경우에만 셸 명령으로 시도하세요 (그러면 허용 카드로 물어봐요). 아니면 지금 폴더 안에서 작업하세요.');
    }
    return;
  }
  const guard = inApp ? [] : [appDir, dataDir];
  let git = null;
  try { git = JSON.parse(require('fs').readFileSync(path.join(dataDir, 'git-allow.json'), 'utf8')); } catch {}
  const r = tier(cmd, guard, 0, { git, cwd });
  if (r.tier === 'safe') return;
  if (r.tier === 'danger') {
    record(input, cmd, r.why);
    out('deny', `이 명령은 안전을 위해 쓸 수 없어요 (${r.why}). 같은 명령을 다시 시도하거나 우회하지 말고, 다른 방법으로 하거나 사용자에게 이유를 쉬운 말로 알려 주세요.`);
    return;
  }
  // 사용자가 허용 카드로 허용한 명령이면 그대로 실행
  let rules = [];
  try { rules = JSON.parse(process.env.GAMJA_PERM_RULES || '[]'); } catch {}
  const t = cmd.trim();
  for (const rule of rules) {
    const m = /^Bash\(([\s\S]*)\)$/.exec(String(rule));
    if (!m) continue;
    if (m[1].endsWith(':*') ? (t === m[1].slice(0, -2) || t.startsWith(m[1].slice(0, -2) + ' ')) : t === m[1]) return;
  }
  record(input, cmd, '', 'denied');
  out('deny', '이 명령은 사용자의 허용이 필요해요. 화면에 허용 카드가 나가요. 다른 방법으로 우회하거나 같은 명령을 다시 시도하지 말고, 무엇을 하려던 건지 쉬운 말로 한 문장만 설명한 뒤 "아래 카드에서 허용해 주시면 이어서 할게요"라고 안내하고 답을 마치세요.');
}
function real(p) {
  // 아직 없는 파일은 있는 부모 폴더까지만 실제 경로로 바꾼다 (링크로 폴더 밖을 가리키는 경우를 막는다)
  const fs = require('fs');
  let cur = p, rest = '';
  for (let i = 0; i < 64; i++) {
    try { return path.join(fs.realpathSync(cur), rest); } catch {}
    const up = path.dirname(cur);
    if (up === cur) return p;
    rest = path.join(path.basename(cur), rest);
    cur = up;
  }
  return p;
}
// 감자알이 사용자 화면에 "막았어요" 알림(blocked)이나 허용 카드(denied, Codex 크루)를 보여 줄 수 있게 기록해 둔다 (세션 번호별 파일)
function record(input, cmd, why, kind = 'blocked') {
  try {
    const dataDir = process.argv.slice(2).filter((a) => !a.startsWith('--'))[1];
    const sid = String(input.session_id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
    if (sid && dataDir) {
      const dir = path.join(dataDir, kind);
      require('fs').mkdirSync(dir, { recursive: true });
      require('fs').appendFileSync(path.join(dir, `${sid}.jsonl`), JSON.stringify({ cmd: String(cmd).slice(0, kind === 'denied' ? 2001 : 300), why, ts: Date.now() }) + '\n');
    }
  } catch { /* 기록 실패는 무시 */ }
}
function out(decision, reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason } }));
}
