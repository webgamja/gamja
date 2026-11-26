'use strict';
// 명령어 위험 수준 (감자알과 Claude 훅이 함께 쓴다)
//   safe    : 묻지 않고 실행 (읽기, 검색, 작업 폴더 안의 파일 만들기·고치기·지우기, 일반 실행)
//   caution : 허용 카드로 한 번 물음 (작업 폴더 밖 삭제·이동·쓰기, 밖으로 내보내기·설치)
//   danger  : 카드 없이 조용히 차단 (감자알 폴더·data, 비밀 파일, 시스템을 건드리는 명령)

const PERM_CRITICAL = new Set(['sudo', 'su', 'doas', 'dd', 'mkfs', 'fdisk', 'mount', 'umount', 'chown', 'chgrp', 'shutdown', 'reboot', 'halt', 'poweroff',
  'kill', 'pkill', 'killall', 'systemctl', 'service', 'crontab', 'passwd', 'useradd', 'userdel', 'iptables', 'nc', 'ncat', 'netcat', 'socat', 'telnet',
  'eval', 'exec', 'source', '.', 'ssh', 'scp', 'sftp', 'rsync', 'mkfifo', 'nohup', 'setsid', 'disown', 'screen', 'tmux', 'chroot', 'insmod', 'modprobe']);
const PERM_SECRET = /(^|[\s/=])\.env\b|\.ssh\b|id_rsa|id_ed25519|gamja_public_deploy|data\/ssh|permissions\.json|restart-request|start\.sh|\/proc\/|\/etc\/|\/sys\/|\/dev\/(?!null\b)/;
const PERM_NET = new Set(['apt', 'apt-get', 'dpkg', 'npm', 'npx', 'pnpm', 'yarn', 'pip', 'pip3', 'pipx', 'curl', 'wget']);

// 명령 자리에 있는 프로그램 이름 중 위험한 것이 있는지
function hasCriticalProg(text) {
  const re = /(^|[;&|`(\n]|\$\()\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*([^\s;&|`()<>]+)/g;
  let m;
  while ((m = re.exec(text))) {
    const prog = m[2].replace(/^.*\//, '');
    if (prog !== '.' && PERM_CRITICAL.has(prog)) return true;
  }
  return false;
}

// 이어진 명령(&&, ;, |, 여러 줄 등)을 살핀다: 위험한 프로그램·비밀 파일이 하나라도 있으면 허용할 수 없다
function screenComplex(text) {
  if (text.length > 2000 || PERM_SECRET.test(text)) return false;
  if (hasCriticalProg(text)) return false;
  if (/(^|[\s;&|(])rm\s+(?:\S+\s+)*?(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive|--no-preserve-root)(\s|$)/.test(text)) return false;
  if (/(^|[\s;&|(])chmod\s+(?:\S+\s+)*?(-[a-zA-Z]*R|777|a\+rwx)/.test(text)) return false;
  return true;
}

const PATH_WRITERS = new Set(['rm', 'rmdir', 'mv', 'cp', 'ln', 'chmod', 'truncate', 'tee', 'install', 'mkdir', 'touch', 'shred']);
const DELETERS = new Set(['rm', 'rmdir', 'mv', 'truncate', 'shred']);
// 읽기만 하는 프로그램 (find -exec, xargs 뒤에 와도 안전)
const READONLY = new Set(['grep', 'egrep', 'fgrep', 'rg', 'cat', 'ls', 'wc', 'head', 'tail', 'file', 'stat', 'du', 'md5sum', 'sha1sum', 'sha256sum',
  'echo', 'basename', 'dirname', 'readlink', 'realpath', 'sort', 'uniq', 'cut', 'nl', 'diff', 'cmp', 'strings']);
// curl·wget에서 무언가를 보내거나 설정 파일을 읽는 옵션
function netSends(rest) {
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (/^(-d|-F|-T|-K|--data.*|--form.*|--upload-file|--config|--json|--post.*|--method|--body.*|--netrc.*)$/.test(a)) return true;
    if (/^-[a-zA-Z]*[dFTK][a-zA-Z]*$/.test(a)) return true;
    if (a === '-X' || a === '--request') { if (!/^['"]?(GET|HEAD)['"]?$/i.test(rest[i + 1] || '')) return true; }
    else if (/^-X/.test(a) && !/^-X['"]?(GET|HEAD)['"]?$/i.test(a)) return true;
  }
  return false;
}
// find -exec / xargs 뒤의 명령이 읽기 전용인지 (아니면 알려 줄 문구)
function execCheck(prog, rest) {
  const bad = { tier: 'caution', why: '여러 파일에 한꺼번에 명령을 실행해요' };
  const ro = (c) => READONLY.has(unquote(c || '').replace(/^.*\//, ''));
  if (prog === 'find') {
    if (rest.some((a) => /^-(delete|fprint.*|fls)$/.test(a))) return bad;
    for (let i = 0; i < rest.length; i++) if (/^-(exec|execdir|ok|okdir)$/.test(rest[i]) && !ro(rest[i + 1])) return bad;
    return null;
  }
  for (let i = 0; i < rest.length; i++) {
    if (/^-[InPLdEsa]$/.test(rest[i])) { i++; continue; }
    if (rest[i].startsWith('-')) continue;
    return ro(rest[i]) ? null : bad;
  }
  return bad;
}
const NET_ALWAYS = new Set(['apt', 'apt-get', 'dpkg', 'npx', 'pip', 'pip3', 'pipx', 'gh']);
const PKG_SAFE_SUB = new Set(['run', 'test', 'start', 'ls', 'list', 'view', 'build', 'lint', '-v', '--version']);
const GIT_NET_SUB = new Set(['clone', 'remote', 'submodule']);
const GIT_SYNC_SUB = new Set(['push', 'pull', 'fetch']);
const GIT_ODD = /:\/\/|[\w.-]+@[\w.-]+:|--(upload|receive)-pack|--exec|sshCommand|--config/;
// git [-C 폴더] [-c 설정] 서브명령 에서 서브명령을 찾는다
function gitSub(rest) {
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '-C' || rest[i] === '-c') { i++; continue; }
    if (!rest[i].startsWith('-')) return rest[i];
  }
  return '';
}
// 공개 저장소 올리기: 배포용 열쇠로 webgamja/gamja에만 올리는 정확히 이 모양의 명령은 안전
const PUBLIC_PUSH = /^git -C (?:\/root\/projects\/gamja\/)?data\/public-export -c core\.sshCommand="ssh -i \/root\/projects\/gamja\/data\/ssh\/gamja_public_deploy -o IdentitiesOnly=yes" push git@github\.com:webgamja\/gamja\.git public-main:main(?: 2>&1(?: \| tail -\d+)?)?$/;

const unquote = (a) => a.replace(/^['"]+|['"]+$/g, '');
// 작업 폴더 밖을 가리킬 수 있는 글자인지 (절대 경로, ~, .., 변수)
const outsideArg = (a) => /^(\/|~|\$)/.test(a) || /(^|\/)\.\.(\/|$)/.test(a);
// 써도 시스템에 영향이 없는 곳: /dev/null(버리는 곳), /tmp 안(임시 폴더). ..이 들어가면 밖으로 나갈 수 있어서 제외
const harmlessOut = (a) => a === '/dev/null' || (/^\/tmp\/[^$~]+$/.test(a) && !/(^|\/)\.\.(\/|$)/.test(a));
const outsideWrite = (a) => outsideArg(a) && !harmlessOut(a);

// 글을 다른 프로그램으로 실행할 수 있는 말: 이런 말이 있으면 따옴표 안의 >도 진짜 리다이렉트일 수 있어서 예전처럼 그대로 검사한다
const RUNS_TEXT = /(^|[\s;&|(`'"=])(eval|exec|source|\.|sh|bash|zsh|dash|ksh|csh|fish|xargs|sudo|su|env|nohup|watch|timeout|time|script|ssh|awk|gawk|mawk|sed|perl|ruby|php|lua|tclsh|deno|bun|node|nodejs|python[\d.]*|sqlite3)(?=$|[\s;&|)`'"])/;
// /dev/null(버리는 곳)과 /tmp 안(임시 폴더, ..이 없을 때)으로 쓰는 건 작업 폴더 밖으로 치지 않는다
const OLD_REDIRECT = />>?\s*(?!\/dev\/null\b)(?!\/tmp\/(?![^\s;&|]*\.\.)[^\s;&|'"<>]+)(\/|~|\$|\.\.\/)/;
const OUT_TARGET = /^\s*['"]?(?!\/dev\/null\b)(?!\/tmp\/(?![^\s;&|]*\.\.)[^\s;&|'"<>]+)(\/|~|\$|\.\.\/)/;
// 작업 폴더 밖으로 가는 리다이렉트(> 또는 >>)가 있는지. 따옴표 안의 글자(문장·커밋 메시지 등)는 리다이렉트가 아니므로 건너뛴다
function redirectsOutside(text) {
  if (RUNS_TEXT.test(text)) return OLD_REDIRECT.test(text);
  let q = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (q === '"' && c === '\\') { i++; continue; }
      if (c === q) q = '';
      continue;
    }
    if (c === '\\') { i++; continue; } // \> 는 글자 그대로
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '>') {
      let j = i + 1;
      if (text[j] === '>') j++;
      if (OUT_TARGET.test(text.slice(j))) return true;
    }
  }
  if (q) return OLD_REDIRECT.test(text); // 따옴표가 안 닫힘: 보수적으로 예전 검사
  return false;
}

// 크루에게 안내한 도구 명령 "node <감자알 폴더>/tools/gamja-make.js …"인지.
// 도구는 감자알 폴더 안에 있어서 감자알 폴더 차단에 걸리므로, 정확히 이 모양일 때만 앞부분을 예외로 둔다.
// 뒷부분은 다른 명령을 붙이는 기호, 감자알 폴더, 작업 폴더 밖 경로가 없어야 한다 (serve의 --path 주소는 경로가 아니라 웹 주소라 허용)
function isMakeCmd(text, guardDirs) {
  const appDir = guardDirs[0];
  if (!appDir) return false;
  const prefix = `node ${appDir}/tools/gamja-make.js`;
  if (!text.startsWith(prefix)) return false;
  const rest = text.slice(prefix.length);
  if (rest && !/^\s/.test(rest)) return false;
  if (/[;&|`<>\n\r$\\(){}*?!]/.test(rest)) return false;
  if (guardDirs.some((d) => d && rest.includes(d))) return false;
  const toks = rest.trim().split(/\s+/).filter(Boolean).map(unquote);
  for (let i = 0; i < toks.length; i++) {
    if (toks[i - 1] === '--path' && /^\/[\w\-./%=&]*$/.test(toks[i]) && !/(^|\/)\.\.(\/|$)/.test(toks[i])) continue;
    if (outsideArg(toks[i])) return false;
  }
  return true;
}

// guardDirs: 작업 폴더가 아닌 곳에서 일하는 크루가 건드리면 안 되는 폴더들(감자알 폴더, data)
// 더보기 › GitHub에서 고른 저장소: https://github.com/소유자/저장소 주소면 묻지 않는다 (열쇠도 감자알이 같은 목록으로만 준다)
// git = { login, all, repos: ['owner/repo', …] } (data/git-allow.json)
const GH_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;
function gitAllowed(url, git) {
  const m = unquote(url).match(GH_URL);
  if (!m || !git) return false;
  const full = `${m[1]}/${m[2]}`.toLowerCase();
  // 모든 저장소: 조직 저장소도 들어간다. 열쇠로는 내가 권한이 있는 저장소에만 올릴 수 있고, 남의 공개 저장소는 받기만 된다
  if (git.all) return true;
  return (git.repos || []).some((r) => String(r).toLowerCase() === full);
}
// 묻지 않아도 되는 git 명령인지:
// - 받기(clone·pull·fetch): https://github.com/소유자/저장소 주소면 어느 저장소든 (공개 저장소 받기는 내려받기와 같고, 비공개는 감자알이 고른 저장소에만 열쇠를 준다)
// - 올리기(push)와 연결(remote add/set-url): 더보기 › GitHub에서 고른 저장소만
// 설정(-c)을 끼우거나, 주소 말고 낯선 설정이 있거나, 작업 폴더 밖으로 받으면 묻는다
function gitSafeAllowed(gsub, rest, seg, git, cwd) {
  if (rest.includes('-c')) return false;
  const urls = rest.filter((a) => /:\/\/|@/.test(a));
  if (!urls.length || !urls.every((a) => GH_URL.test(unquote(a)))) return false;
  if (GIT_ODD.test(urls.reduce((t, u) => t.split(u).join(' '), seg))) return false;
  const read = gsub === 'clone' || gsub === 'pull' || gsub === 'fetch';
  if (!read && !urls.every((a) => gitAllowed(a, git))) return false;
  if (gsub === 'remote') { const i = rest.indexOf('remote'); return ['add', 'set-url'].includes(rest[i + 1]); }
  if (gsub === 'clone') {
    // 받을 폴더: 작업 폴더 안(상대 경로)이거나, 절대 경로라도 지금 작업 폴더 안이면 된다
    const inCwd = (a) => cwd && cwd.length > 1 && (a === cwd || a.startsWith(cwd.replace(/\/+$/, '') + '/')) && !/(^|\/)\.\.(\/|$)/.test(a);
    return !rest.filter((a) => !a.startsWith('-')).map(unquote).some((a) => (/^(\/|~|\$)/.test(a) && !inCwd(a)) || /(^|\/)\.\.(\/|$)/.test(a));
  }
  return read || gsub === 'push';
}
function tier(cmd, guardDirs = [], depth = 0, opts = {}) {
  const text = String(cmd || '').trim();
  if (!text) return { tier: 'caution', why: '' };
  if (text.length > 4000) return { tier: 'caution', why: '명령이 너무 길어요' };
  if (PUBLIC_PUSH.test(text)) return { tier: 'safe', why: '' };
  if (PERM_SECRET.test(text)) return { tier: 'danger', why: '비밀번호·시스템 파일을 건드려요' };
  if (isMakeCmd(text, guardDirs)) return { tier: 'safe', why: '' };
  for (const d of guardDirs) if (d && text.includes(d)) return { tier: 'danger', why: '감자알이 쓰는 폴더를 건드려요' };
  if (hasCriticalProg(text)) return { tier: 'danger', why: '시스템에 영향을 주는 명령이에요' };
  if (/[`]|\$\(/.test(text) && /\$\([^)]*\b(rm|mv)\b/.test(text)) return { tier: 'caution', why: '안쪽 명령이 파일을 지워요' };
  // (위의 한 줄은 $( ) 안에 rm·mv가 숨은 경우)
  if (redirectsOutside(text)) return { tier: 'danger', why: '작업 폴더 밖의 파일에 덮어쓰려고 했어요' };
  // 내려받은 것을 바로 실행하는 모양 (curl … | sh, bash <(curl …))
  if (/\b(curl|wget)\b/.test(text) && (/\|\s*(sudo\s+)?(env\s+)?(ba|z|da|k)?sh\b|\|\s*(python3?|node|perl|ruby|php|source|eval)\b/.test(text) || /<\(\s*(curl|wget)\b/.test(text))) {
    return { tier: 'caution', why: '내려받은 것을 바로 실행해요' };
  }
  // bash -c "문장" 한 줄 전체이면 안쪽 문장을 같은 규칙으로 다시 본다
  const bc = text.match(/^(?:[A-Za-z_]\w*=\S*\s+)*(?:\S*\/)?(?:ba|z|da)?sh\s+(?:-[a-zA-Z]+\s+)*?-[a-zA-Z]*c\s+(['"])([\s\S]*)\1\s*$/);
  if (bc && depth < 3) return tier(bc[2], guardDirs, depth + 1, opts);
  const segs = text.split(/&&|\|\||[;|&\n`]|\$\(|\)/).map((s) => s.trim()).filter(Boolean);
  for (const seg of segs) {
    const tok = seg.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*/, '').split(/\s+/);
    const prog = (tok[0] || '').replace(/^.*\//, '');
    const rest = tok.slice(1);
    const args = rest.filter((a) => !a.startsWith('-')).map(unquote);
    const sub = rest.find((a) => !a.startsWith('-')) || '';
    if (prog === 'curl' || prog === 'wget') {
      // 보내기(POST 등)는 같은 폰(127.0.0.1·localhost)으로 가도 묻는다: 감자알의 관리 기능(되돌리기 등)을 부를 수 있어서
      if (netSends(rest)) return { tier: 'caution', why: '인터넷으로 보내거나 설정 파일을 읽어요' };
      if (args.some(outsideWrite)) return { tier: 'caution', why: '작업 폴더 밖에 저장해요' };
      continue; // 읽기, 또는 작업 폴더 안에 저장 → 안전
    }
    if (NET_ALWAYS.has(prog)) return { tier: 'caution', why: '밖에서 내려받거나 설치해요' };
    if (['npm', 'pnpm', 'yarn'].includes(prog) && sub && !PKG_SAFE_SUB.has(sub)) {
      // 따로 작업 폴더가 있는 크루가 그 폴더 안에 설치하는 건 안전. 전역 설치·밖 경로·감자알 폴더는 주의
      const local = guardDirs.length > 0 && !rest.some((a) => /^(-g|--global|--location=global)$/.test(a)) && !args.some(outsideArg);
      if (!local) return { tier: 'caution', why: '프로그램을 설치하거나 올려요' };
      if (/^(publish|login|logout|adduser|owner|access|token|deprecate|unpublish)$/.test(sub)) return { tier: 'caution', why: '프로그램을 올리거나 계정을 다뤄요' };
      continue;
    }
    if (prog === 'git') {
      const gsub = gitSub(rest);
      if (gitSafeAllowed(gsub, rest, seg, opts.git, opts.cwd)) continue;
      if (GIT_NET_SUB.has(gsub)) return { tier: 'caution', why: '인터넷의 저장소와 주고받아요' };
      // push·pull·fetch는 이미 연결된 저장소로만 가면 안전. 주소를 직접 쓰거나 설정으로 명령을 끼우면 주의
      if ((GIT_SYNC_SUB.has(gsub) || rest.some((a) => GIT_SYNC_SUB.has(a))) && (rest.includes('-c') || GIT_ODD.test(seg))) return { tier: 'caution', why: '낯선 주소나 설정을 쓰는 git 전송이에요' };
    }
    if (['bash', 'sh', 'zsh'].includes(prog) && rest.some((a) => a === '-c')) return { tier: 'caution', why: '문장 속에 숨은 명령을 실행해요' };
    if (prog === 'xargs' || prog === 'find') { const r = execCheck(prog, rest); if (r) return r; }
    if (PATH_WRITERS.has(prog)) {
      if (DELETERS.has(prog) && args.some(outsideArg)) return { tier: 'danger', why: '작업 폴더 밖의 파일을 지우거나 옮기려고 했어요' };
      // 지우기·옮기기는 위에서 /tmp도 막는다 (다른 방의 임시 파일일 수 있다). 만들기·복사는 /tmp 안이면 안전
      if (args.some(outsideWrite)) return { tier: 'caution', why: '작업 폴더 밖의 파일을 바꿔요' };
      if (prog === 'rm' && args.some((a) => /^(\.|\.\/|\*|\.\/\*|\*\.\*)$/.test(a))) return { tier: 'danger', why: '작업 폴더 전체를 지우려고 했어요' };
    }
  }
  return { tier: 'safe', why: '' };
}

// 웹 도구도 같은 3단계로 본다: 검색과 인터넷 페이지 읽기는 curl로 읽기와 같아서 안전.
// 폰 안(localhost)이나 집 와이파이 안의 주소는 감자알·집 안 기기를 건드릴 수 있어 위험
function isPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan') || h.endsWith('.home.arpa')) return true;
  if (!h.includes('.') && !h.includes(':')) return true; // 점 없는 이름 (공유기·기기 이름)
  if (h.includes(':')) return h === '::' || h === '::1' || /^(fc|fd|fe8|fe9|fea|feb)/.test(h) || h.startsWith('::ffff:');
  if (/^\d+$/.test(h) || /^0x/i.test(h)) return true; // 숫자 하나로 쓴 IP (2130706433 같은)
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}
function webTier(toolName, input = {}) {
  if (toolName === 'WebSearch') return { tier: 'safe', why: '' };
  if (toolName !== 'WebFetch') return { tier: 'caution', why: '' };
  let u;
  try { u = new URL(String(input.url || '')); } catch { return { tier: 'danger', why: '주소를 알아볼 수 없어요' }; }
  if (!/^https?:$/.test(u.protocol)) return { tier: 'danger', why: '웹 주소(http·https)만 열 수 있어요' };
  if (isPrivateHost(u.hostname)) return { tier: 'danger', why: '이 폰이나 집 와이파이 안의 주소예요' };
  return { tier: 'safe', why: '' };
}

module.exports = { redirectsOutside, PERM_CRITICAL, PERM_SECRET, PERM_NET, screenComplex, hasCriticalProg, tier, webTier, isPrivateHost };
