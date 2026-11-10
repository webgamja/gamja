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
const NET_ALWAYS = new Set(['curl', 'wget', 'apt', 'apt-get', 'dpkg', 'npx', 'pip', 'pip3', 'pipx', 'gh']);
const PKG_SAFE_SUB = new Set(['run', 'test', 'start', 'ls', 'list', 'view', 'build', 'lint', '-v', '--version']);
const GIT_NET_SUB = new Set(['push', 'clone', 'pull', 'fetch', 'remote', 'submodule']);

const unquote = (a) => a.replace(/^['"]+|['"]+$/g, '');
// 작업 폴더 밖을 가리킬 수 있는 글자인지 (절대 경로, ~, .., 변수)
const outsideArg = (a) => /^(\/|~|\$)/.test(a) || /(^|\/)\.\.(\/|$)/.test(a);

// guardDirs: 작업 폴더가 아닌 곳에서 일하는 크루가 건드리면 안 되는 폴더들(감자알 폴더, data)
function tier(cmd, guardDirs = []) {
  const text = String(cmd || '').trim();
  if (!text) return { tier: 'caution', why: '' };
  if (text.length > 4000) return { tier: 'caution', why: '명령이 너무 길어요' };
  if (PERM_SECRET.test(text)) return { tier: 'danger', why: '비밀번호·시스템 파일을 건드려요' };
  for (const d of guardDirs) if (d && text.includes(d)) return { tier: 'danger', why: '감자알이 쓰는 폴더를 건드려요' };
  if (hasCriticalProg(text)) return { tier: 'danger', why: '시스템에 영향을 주는 명령이에요' };
  if (/[`]|\$\(/.test(text) && /\$\([^)]*\b(rm|mv)\b/.test(text)) return { tier: 'caution', why: '안쪽 명령이 파일을 지워요' };
  // (위의 한 줄은 $( ) 안에 rm·mv가 숨은 경우)
  if (/>>?\s*(?!\/dev\/null\b)(\/|~|\$|\.\.\/)/.test(text)) return { tier: 'danger', why: '작업 폴더 밖의 파일에 덮어쓰려고 했어요' };
  const segs = text.split(/&&|\|\||[;|&\n`]|\$\(|\)/).map((s) => s.trim()).filter(Boolean);
  for (const seg of segs) {
    const tok = seg.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*/, '').split(/\s+/);
    const prog = (tok[0] || '').replace(/^.*\//, '');
    const rest = tok.slice(1);
    const args = rest.filter((a) => !a.startsWith('-')).map(unquote);
    const sub = rest.find((a) => !a.startsWith('-')) || '';
    if (NET_ALWAYS.has(prog)) return { tier: 'caution', why: '밖에서 내려받거나 설치해요' };
    if (['npm', 'pnpm', 'yarn'].includes(prog) && sub && !PKG_SAFE_SUB.has(sub)) return { tier: 'caution', why: '프로그램을 설치하거나 올려요' };
    if (prog === 'git' && GIT_NET_SUB.has(sub)) return { tier: 'caution', why: '인터넷의 저장소와 주고받아요' };
    if (['bash', 'sh', 'zsh'].includes(prog) && rest.some((a) => a === '-c')) return { tier: 'caution', why: '문장 속에 숨은 명령을 실행해요' };
    if (prog === 'xargs' || (prog === 'find' && rest.some((a) => /^-(delete|exec|execdir)$/.test(a)))) return { tier: 'caution', why: '여러 파일에 한꺼번에 명령을 실행해요' };
    if (PATH_WRITERS.has(prog)) {
      if (DELETERS.has(prog) && args.some(outsideArg)) return { tier: 'danger', why: '작업 폴더 밖의 파일을 지우거나 옮기려고 했어요' };
      if (args.some(outsideArg)) return { tier: 'caution', why: '작업 폴더 밖의 파일을 바꿔요' };
      if (prog === 'rm' && args.some((a) => /^(\.|\.\/|\*|\.\/\*|\*\.\*)$/.test(a))) return { tier: 'danger', why: '작업 폴더 전체를 지우려고 했어요' };
    }
  }
  return { tier: 'safe', why: '' };
}

module.exports = { PERM_CRITICAL, PERM_SECRET, PERM_NET, screenComplex, hasCriticalProg, tier };
