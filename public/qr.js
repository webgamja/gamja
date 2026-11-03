// QR 코드 만들기 (의존성 없음). 짧은 주소용: 바이트 모드, 오류 정정 M, 버전 1~6(최대 106바이트), 마스크 0.
// 쓰는 곳: window.GAMJA_QR.svg('http://...') → <svg> 글자 (너무 길면 '')
(function () {
  // 버전별 [데이터 코드워드 수, 블록당 오류 정정 코드워드 수, 블록 수] (오류 정정 M)
  const EC = { 1: [16, 10, 1], 2: [28, 16, 1], 3: [44, 26, 1], 4: [64, 18, 2], 5: [86, 24, 2], 6: [108, 16, 4] };
  const ALIGN = { 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };
  const FORMAT_BITS = 0x5412; // 오류 정정 M + 마스크 0

  // 갈루아 체 GF(256)
  const EXP = new Array(512);
  const LOG = new Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

  function generator(n) { // (x-α⁰)(x-α¹)…, 높은 차수 계수가 앞
    let g = [1];
    for (let i = 0; i < n; i++) {
      const ng = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= mul(g[j], EXP[i]); }
      g = ng;
    }
    return g;
  }
  function remainder(data, n) {
    const g = generator(n);
    const r = new Array(n).fill(0);
    for (const b of data) {
      const f = b ^ r.shift();
      r.push(0);
      for (let i = 0; i < n; i++) r[i] ^= mul(g[i + 1], f);
    }
    return r;
  }

  function build(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    let ver = 0;
    for (let v = 1; v <= 6; v++) if (bytes.length <= EC[v][0] - 2) { ver = v; break; }
    if (!ver) return null;
    const [dataCw, ecLen, nb] = EC[ver];

    // 데이터 비트: 모드(0100) + 글자 수(8비트) + 내용 + 끝 표시 + 채우기
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, 8); bytes.forEach((b) => put(b, 8));
    const cap = dataCw * 8;
    put(0, Math.min(4, cap - bits.length));
    while (bits.length % 8) bits.push(0);
    for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));

    // 블록으로 나눠 오류 정정 코드를 붙이고 번갈아 섞는다
    const bl = dataCw / nb;
    const blocks = [];
    const ecs = [];
    for (let i = 0; i < nb; i++) { const d = data.slice(i * bl, (i + 1) * bl); blocks.push(d); ecs.push(remainder(d, ecLen)); }
    const out = [];
    for (let i = 0; i < bl; i++) for (const b of blocks) out.push(b[i]);
    for (let i = 0; i < ecLen; i++) for (const e of ecs) out.push(e[i]);

    // 모양 그리기
    const n = ver * 4 + 17;
    const m = Array.from({ length: n }, () => new Array(n).fill(false));
    const fn = Array.from({ length: n }, () => new Array(n).fill(false)); // 데이터가 들어갈 수 없는 칸
    const set = (cx, cy, v) => { m[cy][cx] = v; fn[cy][cx] = true; };
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const px = cx + dx, py = cy + dy;
        if (px < 0 || py < 0 || px >= n || py >= n) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(px, py, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(n - 4, 3); finder(3, n - 4);
    for (let i = 0; i < n; i++) {
      if (!fn[6][i]) set(i, 6, i % 2 === 0);
      if (!fn[i][6]) set(6, i, i % 2 === 0);
    }
    const al = ALIGN[ver];
    if (al) {
      for (const ay of al) for (const ax of al) {
        if ((ax === al[0] && ay === al[0]) || (ax === al[0] && ay === al[1]) || (ax === al[1] && ay === al[0])) continue; // 찾기 무늬와 겹침
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
    // 형식 정보(오류 정정 수준과 마스크)
    const bit = (b, i) => ((b >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(FORMAT_BITS, i));
    set(8, 7, bit(FORMAT_BITS, 6)); set(8, 8, bit(FORMAT_BITS, 7)); set(7, 8, bit(FORMAT_BITS, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(FORMAT_BITS, i));
    for (let i = 0; i < 8; i++) set(n - 1 - i, 8, bit(FORMAT_BITS, i));
    for (let i = 8; i < 15; i++) set(8, n - 15 + i, bit(FORMAT_BITS, i));
    set(8, n - 8, true); // 항상 검은 칸

    // 데이터 놓기(지그재그) + 마스크 0
    const total = out.length * 8;
    let bi = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < n; vert++) {
        for (let j = 0; j < 2; j++) {
          const px = right - j;
          const upward = ((right + 1) & 2) === 0;
          const py = upward ? n - 1 - vert : vert;
          if (!fn[py][px] && bi < total) {
            m[py][px] = ((out[bi >>> 3] >>> (7 - (bi & 7))) & 1) !== 0;
            bi++;
          }
        }
      }
    }
    for (let py = 0; py < n; py++) for (let px = 0; px < n; px++) if (!fn[py][px] && (px + py) % 2 === 0) m[py][px] = !m[py][px];
    return { n, m };
  }

  // SVG 글자로 돌려준다 (둘레 흰 여백 4칸 포함)
  function svg(text) {
    const q = build(String(text || ''));
    if (!q) return '';
    const pad = 4;
    let d = '';
    for (let y = 0; y < q.n; y++) for (let xx = 0; xx < q.n; xx++) if (q.m[y][xx]) d += `M${xx + pad} ${y + pad}h1v1h-1z`;
    const size = q.n + pad * 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }

  window.GAMJA_QR = { svg };
})();
