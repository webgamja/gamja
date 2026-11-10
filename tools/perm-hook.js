#!/usr/bin/env node
'use strict';
// Claude Code의 PreToolUse 훅: Bash 명령을 실행하기 전에 위험 수준을 보고 결정한다.
//   safe → 허용 (묻지 않음) / danger → 차단 (카드 없음) / caution → 아무 말 없이 넘김 (감자알의 허용 카드로 이어진다)
// 어떤 오류가 나도 결정을 내리지 않는다 (기존 방식대로 카드로 물어본다).
// 사용: node perm-hook.js <감자알 폴더> <data 폴더>
const path = require('path');
const { tier } = require('./perm-policy');

let raw = '';
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    if (input.tool_name !== 'Bash' || !input.tool_input || !input.tool_input.command) return;
    const [appDir, dataDir] = process.argv.slice(2);
    const cwd = path.resolve(input.cwd || process.cwd());
    const inApp = appDir && (cwd === appDir || cwd.startsWith(appDir + path.sep));
    // 감자알을 고치는 개발 크루(감자알 폴더에서 일하는 크루)는 감자알 폴더 경로를 쓸 수 있다. 그 밖의 크루는 감자알 폴더와 data를 건드릴 수 없다
    const guard = inApp ? [] : [appDir, dataDir];
    const r = tier(input.tool_input.command, guard);
    if (r.tier === 'safe') {
      out('allow', '');
    } else if (r.tier === 'danger') {
      // 감자알이 사용자 화면에 "막았어요" 알림을 보여 줄 수 있게 기록해 둔다 (세션 번호별 파일)
      try {
        const sid = String(input.session_id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
        if (sid && dataDir) {
          const dir = path.join(dataDir, 'blocked');
          require('fs').mkdirSync(dir, { recursive: true });
          require('fs').appendFileSync(path.join(dir, `${sid}.jsonl`), JSON.stringify({ cmd: String(input.tool_input.command).slice(0, 300), why: r.why, ts: Date.now() }) + '\n');
        }
      } catch { /* 기록 실패는 무시 */ }
      out('deny', `이 명령은 안전을 위해 쓸 수 없어요 (${r.why}). 같은 명령을 다시 시도하거나 우회하지 말고, 다른 방법으로 하거나 사용자에게 이유를 쉬운 말로 알려 주세요.`);
    }
  } catch { /* 결정하지 않음 */ }
});
function out(decision, reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason } }));
}
