'use strict';
// JSON.parse 전에 크기·중첩 깊이·항목 수를 먼저 훑어서, 메모리를 폭발시키는 파일을 파싱하지 않고 거절한다.
// (JSON.parse는 아주 깊게 중첩된 파일이나 아주 작은 항목이 많은 파일에서 파일 크기의 수십 배 메모리를 쓴다)
// 문자열 안의 괄호와 이스케이프는 따로 처리하므로 정상 대화(코드·괄호가 많은 글)는 그대로 통과한다.
class JsonLimitError extends Error {
  constructor(code, msg) { super(msg); this.code = code; }
}

function scanJson(buf, { maxBytes, maxDepth, maxNodes }) {
  if (buf.length > maxBytes) throw new JsonLimitError('too-big', 'JSON이 너무 커요.');
  let depth = 0;
  let nodes = 0;
  let inStr = false;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (inStr) {
      if (c === 0x5c) i++; // 역슬래시: 다음 글자는 건너뛴다
      else if (c === 0x22) inStr = false;
      continue;
    }
    if (c === 0x22) inStr = true;
    else if (c === 0x7b || c === 0x5b) {
      if (++depth > maxDepth) throw new JsonLimitError('too-deep', 'JSON이 너무 깊게 중첩돼 있어요.');
      if (++nodes > maxNodes) throw new JsonLimitError('too-many', 'JSON 항목이 너무 많아요.');
    } else if (c === 0x7d || c === 0x5d) { if (depth > 0) depth--; }
    else if (c === 0x2c) { if (++nodes > maxNodes) throw new JsonLimitError('too-many', 'JSON 항목이 너무 많아요.'); }
  }
}

// buf: Buffer. 한도를 넘으면 JsonLimitError, 모양이 틀리면 SyntaxError
function parseJsonSafe(buf, limits) {
  const lim = { maxBytes: 128 * 1024 * 1024, maxDepth: 32, maxNodes: 2000000, ...limits };
  scanJson(buf, lim);
  return JSON.parse(buf.toString('utf8'));
}

module.exports = { parseJsonSafe, scanJson, JsonLimitError };
