'use strict';
// 민감정보 가리개: 도구가 stdout/stderr로 내보내는 글에서 비밀번호·토큰·쿠키 값을 ***로 바꾼다.
// 출력 단계(process.stdout.write / stderr.write)에서 막으므로, 나중에 누가 디버그 출력을 넣어도 값이 그대로 나가지 않는다.
// 값 자체(원문, JSON 문자열, URL 인코딩, base64)와 흔한 모양(password":"…", Cookie: …, token=…)을 가린다.
const MIN_LEN = 4;
const PATTERNS = [
  [/("(?:password|pw|passwd|secret|token|apiKey|api_key|authorization|cookie)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi, '$1"***"'],
  [/((?:^|[\s;,&?])(?:password|passwd|APP_PASSWORD|token|secret)=)[^\s;,&"']+/gi, '$1***'],
  [/((?:set-)?cookie:\s*)[^\r\n]+/gi, '$1***'],
  [/(authorization:\s*)[^\r\n]+/gi, '$1***'],
  [/(\bgh[pousr]_)[A-Za-z0-9]{20,}/g, '$1***'],
  [/\b(sk-[A-Za-z0-9_-]{16,})/g, 'sk-***'],
];

function forms(v) {
  const s = String(v);
  const set = new Set([s, JSON.stringify(s).slice(1, -1), encodeURIComponent(s), Buffer.from(s).toString('base64'), Buffer.from(s).toString('base64').replace(/=+$/, '')]);
  return [...set].filter((x) => x.length >= MIN_LEN).sort((a, b) => b.length - a.length);
}

function createRedactor(initial = []) {
  const secrets = new Set();
  const add = (v) => { if (typeof v === 'string' && v.length >= MIN_LEN) for (const f of forms(v)) secrets.add(f); };
  initial.forEach(add);
  // 환경변수 중 이름이 비밀스러운 것들의 값도 가린다
  for (const [k, v] of Object.entries(process.env)) if (/PASS|SECRET|TOKEN|KEY|COOKIE/i.test(k) && typeof v === 'string' && v.length >= 8) add(v); // 짧은 값은 평범한 글을 망가뜨릴 수 있어 8자 이상만
  function redact(text) {
    let s = String(text);
    for (const x of [...secrets].sort((a, b) => b.length - a.length)) s = s.split(x).join('***');
    for (const [re, rep] of PATTERNS) s = s.replace(re, rep);
    return s;
  }
  // 이 프로세스의 출력을 가리개로 거른다 (한 번만 걸린다)
  function install() {
    for (const st of [process.stdout, process.stderr]) {
      if (st.__gamjaRedact) continue;
      const orig = st.write.bind(st);
      st.write = (chunk, enc, cb) => {
        if (typeof chunk === 'string') chunk = redact(chunk);
        else if (Buffer.isBuffer(chunk)) chunk = Buffer.from(redact(chunk.toString('utf8')));
        return orig(chunk, enc, cb);
      };
      st.__gamjaRedact = true;
    }
  }
  return { add, redact, install };
}

module.exports = { createRedactor, MIN_LEN };
