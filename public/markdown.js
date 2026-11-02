// 경량 마크다운 렌더러 (외부 라이브러리 없음). 모든 입력은 먼저 HTML 이스케이프한다.
(function () {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const KEYWORDS = new Set(('const let var function return if else for while do switch case break continue new class extends ' +
    'import from export default async await try catch finally throw typeof instanceof in of this null undefined true false ' +
    'def elif lambda pass None True False self with as yield raise except is not and or fn pub mut impl struct enum match use ' +
    'func package type interface go defer chan map range public private static void int string bool echo then fi done esac local').split(' '));

  // 아주 단순한 하이라이터: 주석/문자열/숫자/키워드
  function highlight(code) {
    const re = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)/g;
    let out = '', last = 0, m;
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index));
      if (m[1]) out += `<span class="tk-c">${esc(m[1])}</span>`;
      else if (m[2]) out += `<span class="tk-s">${esc(m[2])}</span>`;
      else if (m[3]) out += `<span class="tk-n">${m[3]}</span>`;
      else out += KEYWORDS.has(m[4]) ? `<span class="tk-k">${m[4]}</span>` : m[4];
      last = re.lastIndex;
    }
    return out + esc(code.slice(last));
  }

  function inline(s) {
    // 코드 스팬을 먼저 빼 두고 나머지를 처리
    const codes = [];
    s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    s = esc(s);
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
  }

  function codeBlock(lang, code) {
    return `<div class="codeblock"><div class="code-head"><span>${esc(lang || 'code')}</span>` +
      `<button class="copy" type="button">복사</button></div><pre><code>${highlight(code)}</code></pre></div>`;
  }

  function splitRow(line) {
    return line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  }

  function render(src) {
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // 코드 펜스 (스트리밍 중 닫히지 않은 경우도 처리)
      const fence = line.match(/^\s*(```|~~~)\s*([\w+#.-]*)/);
      if (fence) {
        const buf = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence[1])) buf.push(lines[i++]);
        i++;
        out.push(codeBlock(fence[2], buf.join('\n')));
        continue;
      }
      if (!line.trim()) { i++; continue; }

      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { const n = Math.min(h[1].length, 4); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }

      if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) { out.push('<hr>'); i++; continue; }

      // 표
      if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        const head = splitRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
        out.push('<div class="table-wrap"><table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') +
          '</tr></thead><tbody>' + rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
          '</tbody></table></div>');
        continue;
      }

      if (/^\s*>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
        out.push(`<blockquote>${render(buf.join('\n'))}</blockquote>`);
        continue;
      }

      // 목록 (들여쓰기 기반 1단계 중첩 지원)
      const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (li) {
        const ordered = /\d/.test(li[2]);
        const tag = ordered ? 'ol' : 'ul';
        const items = [];
        while (i < lines.length) {
          const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
          if (m && (m[1].length < 2 || !items.length)) { items.push({ text: m[3], sub: [] }); i++; continue; }
          if (m && items.length) { items[items.length - 1].sub.push(lines[i].slice(2)); i++; continue; }
          if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) { items[items.length - 1].text += ' ' + lines[i].trim(); i++; continue; }
          break;
        }
        const start = ordered ? parseInt(li[2], 10) : 1;
        out.push(`<${tag}${ordered && start !== 1 ? ` start="${start}"` : ''}>` +
          items.map((it) => `<li>${inline(it.text)}${it.sub.length ? render(it.sub.join('\n')) : ''}</li>`).join('') + `</${tag}>`);
        continue;
      }

      // 문단
      const buf = [];
      while (i < lines.length && lines[i].trim() &&
        !/^\s*(```|~~~|#{1,6}\s|>|([-*+]|\d+[.)])\s)/.test(lines[i])) buf.push(lines[i++]);
      if (!buf.length) buf.push(lines[i++]);
      out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
    }
    return out.join('');
  }

  window.renderMarkdown = render;
})();
