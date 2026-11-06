'use strict';
// 의존성 없는 Claude Code 웹 채팅 서버 (Node 18+ 내장 모듈만 사용)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

// 기본 포트: 개발 도구들이 흔히 쓰는 3000과 겹치지 않게 26514를 쓴다. 예전에 설치한 폰은 .env에 PORT=3000이 적혀 있어서 그대로 3000을 쓴다 (앱이 .env의 PORT를 읽는다)
const PORT = Number(process.env.PORT) || 26514;
const HOST = process.env.HOST || '0.0.0.0';
const PASSWORD = process.env.APP_PASSWORD;
const PROJECTS_DIR = path.resolve(process.env.PROJECTS_DIR || path.join(os.homedir(), 'projects'));
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
// 선택: acceptEdits 모드에서 추가로 허용할 도구 (예: "Bash(git status:*) Bash(npm test:*)")
const ALLOWED_TOOLS = (process.env.ALLOWED_TOOLS || '').trim();
const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 30;
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!PASSWORD) {
  console.error('APP_PASSWORD 환경변수가 필요합니다. 예) APP_PASSWORD=secret node server.js');
  process.exit(1);
}

// ---------- 인증: 비밀번호에서 파생한 키로 HMAC 서명된 쿠키 (재시작해도 유지, 비번 바꾸면 무효화) ----------
// 로그인 열쇠를 만드는 글자 (비밀번호와 섞어서 쓴다). 이 값을 바꾸면 모든 기기가 한 번 로그아웃된다
const SIGN_KEY = crypto.createHash('sha256').update('gamja-egg:' + PASSWORD).digest();
const COOKIE = 'cc_session';

function sign(payload) {
  return crypto.createHmac('sha256', SIGN_KEY).update(payload).digest('base64url');
}
function makeToken() {
  const exp = Date.now() + SESSION_DAYS * 86400e3;
  const payload = `${exp}.${crypto.randomBytes(12).toString('base64url')}`;
  return `${payload}.${sign(payload)}`;
}
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function verifyToken(token) {
  if (!token) return false;
  const i = token.lastIndexOf('.');
  if (i < 0) return false;
  const payload = token.slice(0, i);
  if (!safeEqual(sign(payload), token.slice(i + 1))) return false;
  return Number(payload.split('.')[0]) > Date.now();
}
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
// 이 폰 안에서 직접 온 요청인지 (감자 앱, 이 폰의 브라우저). 같은 와이파이나 터널을 거친 요청은 아니다
function isLocalReq(req) {
  const s = req.socket.remoteAddress || '';
  return (s === '127.0.0.1' || s === '::1' || s === '::ffff:127.0.0.1') && !req.headers['cf-connecting-ip'] && !req.headers['x-forwarded-for'];
}
function isAuthed(req) {
  const token = parseCookies(req)[COOKIE];
  if (!verifyToken(token)) return false;
  // 같은 와이파이 접속을 끈 시각 이전에 로그인한 다른 기기는 로그인이 풀린다 (이 폰 안의 화면은 그대로).
  // 로그인한 시각 = 만료 시각 - 로그인 유지 기간
  const revoked = settings.remoteRevokedAt || 0;
  if (revoked && !isLocalReq(req) && Number(token.split('.')[0]) - SESSION_DAYS * 86400e3 <= revoked) return false;
  return true;
}

const loginTickets = new Map(); // 앱이 브라우저를 열 때 쓰는 한 번용 로그인 표 → 만료 시각
// 로그인 무차별 대입 방지: IP당 15분에 10회 (로그인 실패와 비밀번호 바꾸기 실패는 따로 센다)
const attempts = new Map();   // 로그인 실패
const pwAttempts = new Map(); // 비밀번호 바꾸기에서 현재 비밀번호를 틀린 횟수
const ATTEMPT_WINDOW = 15 * 60e3;
function recentFails(map, ip) {
  const now = Date.now();
  const list = (map.get(ip) || []).filter((t) => now - t < ATTEMPT_WINDOW);
  map.set(ip, list);
  return list;
}
const tooManyAttempts = (ip, map = attempts) => recentFails(map, ip).length >= 10;
// 막힌 사람이 몇 분 뒤에 다시 시도할 수 있는지 (가장 오래된 실패가 15분을 채우면 풀린다)
function waitMinutes(map, ip) {
  const list = recentFails(map, ip);
  return list.length ? Math.max(1, Math.ceil((ATTEMPT_WINDOW - (Date.now() - list[0])) / 60e3)) : 1;
}

// ---------- 유틸 ----------
function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}
function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('파일이 너무 커요')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------- 이미지 첨부 ----------
// Claude가 Read 도구로 열어 볼 수 있도록 그 프로젝트 폴더 안의 숨김 폴더에 저장한다 (git에는 안 올라가게 .gitignore 생성)
const VOICE_HINT = '[음성 대화 모드: 사용자는 화면 대신 소리로 듣고 있어요. 2~3문장의 말하듯 짧은 한국어로 답해 주세요. ' +
  '코드·경로·긴 목록은 읽지 말고 "자세한 내용은 화면에 있어요"라고만 해 주세요. 작업 자체는 평소처럼 해도 돼요.]';
const UPLOAD_DIR = '.gamja-uploads';
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_IMAGES = 12;
function uploadDir(cwd) {
  const dir = path.join(cwd, UPLOAD_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.gitignore'), '*\n');
  }
  return dir;
}
const isUploadName = (n) => typeof n === 'string' && /^\d+-[a-z0-9]+\.(jpg|png|webp|gif)$/.test(n);

// 감자 톡톡(크루가 아닌 기본 대화)이 만든 결과물을 모아 두는 폴더. 크루 목록에는 나오지 않는다
const TALK_DIR_NAME = 'gamjaTT';
const TALK_DIR = path.join(PROJECTS_DIR, TALK_DIR_NAME);
function listProjects() {
  try {
    return fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== TALK_DIR_NAME)
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}
// ---------- 프로젝트 관리 (만들기·이름 바꾸기·삭제·프로젝트별 설정) ----------
const isProjectName = (n) => typeof n === 'string' && /^[\w가-힣-]{1,40}$/.test(n) && !n.startsWith('-');
const isReservedCrewName = (n) => String(n).toLowerCase() === 'gamjatt'; // 감자 톡톡 결과물 폴더 이름(gamjaTT)은 크루 폴더로 쓸 수 없다
// GAMJA 자신이 들어 있는 폴더는 이름 바꾸기·삭제 금지 (지금 돌고 있는 서버가 망가짐)
const holdsApp = (dir) => __dirname === dir || __dirname.startsWith(dir + path.sep);
function projectConfFile() { return path.join(DATA_DIR, 'projects.json'); }
let projectConf = {}; // 프로젝트별 설정 { 이름: { model } } — 서버가 뜰 때 loadProjectConf()로 읽는다
function loadProjectConf() {
  try { projectConf = JSON.parse(fs.readFileSync(projectConfFile(), 'utf8')); } catch {}
}
function saveProjectConf() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(projectConfFile(), JSON.stringify(projectConf, null, 2));
}

// 이름이 실제 ~/projects 하위 폴더일 때만 경로 반환 (경로 조작 방지)
// 채팅방 번호(rid): 첫 방은 크루 폴더 이름 그대로(예전 대화 기록이 그대로 이어진다), 같은 크루의 다른 방은 "크루@짧은번호".
// 대화·진행 중 작업은 방 번호로, 폴더와 설정은 크루(= @ 앞부분)로 찾는다
const ROOM_SUFFIX = /^[a-z0-9]{3,8}$/;
// 그룹 채팅(handleGroupChat·참여자 초대)은 다 만들어 뒀지만 고도화 전이라 막아 둔다. 열 때 true로 (화면 쪽 app.js의 GROUP_CHAT_ENABLED도 같이)
const GROUP_CHAT_ENABLED = false;
const MAX_ROOM_MEMBERS = 4; // 한 채팅방의 참여자 수 한도 (크루마다 Claude를 한 번씩 부르므로 사용량과 폰 부담 때문에 4명까지)
const crewOf = (rid) => String(rid || '').split('@')[0];
function resolveProject(name) {
  const s = String(name || '');
  const at = s.indexOf('@');
  if (at >= 0 && !ROOM_SUFFIX.test(s.slice(at + 1))) return null;
  const crew = at >= 0 ? s.slice(0, at) : s;
  if (!crew) return PROJECTS_DIR;
  if (!listProjects().includes(crew)) return null;
  return path.join(PROJECTS_DIR, crew);
}
// 크루 자체를 다루는 곳(설정·이름·삭제)은 채팅방 번호가 아니라 크루 이름만 받는다
const resolveCrew = (name) => (String(name || '').includes('@') ? null : resolveProject(name));
// 한 크루의 채팅방들: 첫 방과 "크루@번호" 방들의 대화 파일
function roomFilesOf(crew) {
  const out = [];
  if (fs.existsSync(convFile(crew))) out.push({ rid: crew, file: convFile(crew) });
  const prefix = `p_${encodeURIComponent(crew)}%40`;
  try {
    for (const f of fs.readdirSync(CONV_DIR)) {
      const code = f.startsWith(prefix) && f.endsWith('.json') ? f.slice(prefix.length, -5) : '';
      if (ROOM_SUFFIX.test(code)) out.push({ rid: `${crew}@${code}`, file: path.join(CONV_DIR, f) });
    }
  } catch { /* 대화 폴더가 아직 없으면 방도 없다 */ }
  return out;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};
function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// ---------- 도구 사용 → 진행 상태 문구 ----------
function shortPath(p) {
  if (!p) return '';
  const parts = String(p).split('/');
  return parts.slice(-2).join('/');
}
function toolStatus(name, input = {}) {
  const f = shortPath(input.file_path || input.notebook_path || input.path);
  switch (name) {
    case 'Edit': case 'MultiEdit': case 'NotebookEdit':
      return `✏️ 파일 수정 중... ${f}`;
    case 'Write':
      return `📝 파일 작성 중... ${f}`;
    case 'Read':
      return `📖 파일 읽는 중... ${f}`;
    case 'Bash':
      return `💻 명령 실행 중... ${String(input.description || input.command || '').slice(0, 60)}`;
    case 'Grep':
      return `🔍 코드 검색 중... ${String(input.pattern || '').slice(0, 40)}`;
    case 'Glob': case 'LS':
      return `📂 파일 찾는 중... ${String(input.pattern || f || '').slice(0, 40)}`;
    case 'WebFetch':
      return '🌐 웹 페이지 가져오는 중...';
    case 'WebSearch':
      return `🌐 웹 검색 중... ${String(input.query || '').slice(0, 40)}`;
    case 'TodoWrite':
      return '🗒️ 할 일 정리 중...';
    case 'Task': case 'Agent':
      return `🤖 서브 에이전트 작업 중... ${String(input.description || '').slice(0, 40)}`;
    default:
      return `🔧 ${name} 사용 중...`;
  }
}

// ---------- 대화 기록 (서버에 저장 → 어느 기기에서 들어와도 같은 기록) ----------
// 프로젝트마다 data/conversations/<프로젝트>.json 하나: { sessionId, messages: [{role, text, ts, tools?, meta?}] }
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const CONV_DIR = path.join(DATA_DIR, 'conversations');
const ARCHIVE_DIR = path.join(CONV_DIR, 'archive'); // 크루를 지워도 남겨 두는 대화 기록
const MAX_MESSAGES = 500;
const ROLES = new Set(['user', 'bot', 'error', 'notice']);
const convCache = new Map(); // project -> conv

function convFile(project) {
  return path.join(CONV_DIR, (project ? 'p_' + encodeURIComponent(project) : '_root') + '.json');
}
function loadConv(project) {
  if (convCache.has(project)) return convCache.get(project);
  let conv = { sessionId: null, messages: [] };
  try { conv = { ...conv, ...JSON.parse(fs.readFileSync(convFile(project), 'utf8')) }; } catch {}
  convCache.set(project, conv);
  return conv;
}
function saveConv(project) {
  const conv = loadConv(project);
  if (conv.messages.length > MAX_MESSAGES) conv.messages = conv.messages.slice(-MAX_MESSAGES);
  conv.updatedAt = Date.now();
  // 이 방이 어느 크루의 방인지 대화 파일에 적어 둔다 (기록용. 지금은 방 아이디에서 읽고, 나중에 방 아이디를 크루와 분리할 때 쓴다)
  const ownerCrew = crewOf(project);
  if (ownerCrew && !conv.crew) conv.crew = ownerCrew;
  try {
    fs.mkdirSync(CONV_DIR, { recursive: true });
    const file = convFile(project);
    fs.writeFileSync(file + '.tmp', JSON.stringify(conv));
    fs.renameSync(file + '.tmp', file); // 쓰다가 죽어도 기존 파일은 안전
  } catch (e) {
    console.error('대화 저장 실패:', e.message);
  }
}
// 브라우저에서 올라온 메시지(이전 버전의 localStorage 기록) 정리
function cleanMessage(m) {
  if (!m || !ROLES.has(m.role) || typeof m.text !== 'string') return null;
  const out = { role: m.role, text: m.text.slice(0, 200000), ts: Number(m.ts) || Date.now() };
  if (Array.isArray(m.tools)) out.tools = m.tools.filter((t) => typeof t === 'string').slice(0, 200).map((t) => t.slice(0, 300));
  if (typeof m.meta === 'string') out.meta = m.meta.slice(0, 200);
  return out;
}
const isUuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// ---------- 설정 (호칭·답변 스타일·모델) ----------
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const MODELS = ['', 'opus', 'sonnet']; // '' = Claude Code 기본값
const AUTOCOMPACT = ['', '100k', '150k', '200k', '400k']; // '' = Claude Code 기본(한계 가까이에서 자동 압축). 추천은 200k
// Claude 로그인이 풀렸을 때 Claude Code가 내는 오류 글. 이런 오류에는 화면이 "로그인하기" 안내를 붙인다
const AUTH_ERR = /not logged in|please run \/login|invalid api key|authentication[_ ]error|oauth token (has )?expired|login required/i;
const EFFORTS = ['', 'low', 'medium', 'high']; // 생각 깊이 (--effort). '' = Claude Code 기본값
// lanAccess: 같은 와이파이의 다른 기기(PC·아이폰 등)에서 접속하는 것을 허용할지. 기본은 꺼짐 (이 폰 안의 감자 앱·브라우저만)
let settings = { nickname: '', style: '', model: '', autocompact: '200k', effort: '', lanAccess: false }; // 자동 압축은 20만 토큰이 기본(추천)
try { settings = { ...settings, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch {}
// 기기 간에 같이 쓰는 화면 정보: 크루 이름·아이콘·묶음(crew), 템플릿(tpl), ★ 자주 쓰는 크루(favs), 채팅방 이름(roomTitle),
// 📌 고정(roomPin), 방 만든 시각(roomMade). 항목마다 { v, ts }로 두고 더 늦은 ts가 이긴다 (v가 null이면 지운 것)
const UI_FILE = path.join(DATA_DIR, 'ui-state.json');
const UI_MAPS = new Set(['crew', 'tpl', 'favs', 'roomTitle', 'roomPin', 'roomMade']);
let uiState = {};
try { uiState = JSON.parse(fs.readFileSync(UI_FILE, 'utf8')) || {}; } catch {}
function saveUi() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(UI_FILE, JSON.stringify(uiState));
}
// 읽음 기록: { 방 이름: 마지막으로 읽은 답변 시각 }. 모든 기기가 같이 쓴다 (한 기기에서 읽으면 다른 기기의 안 읽음 숫자도 줄어든다)
const SEEN_FILE = path.join(DATA_DIR, 'seen.json');
let seenMap = {};
try { seenMap = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')) || {}; } catch {}
function saveSeen() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SEEN_FILE, JSON.stringify(seenMap));
}
function saveSettings() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}
// Claude Code에 덧붙일 지시 (공식 --append-system-prompt). 대화를 시작할 때의 지시가 유지되므로 새 대화부터 적용된다
function settingsPrompt(lang = '') {
  const lines = [];
  // 화면 언어가 영어면 답변도 영어로 (한국어가 기본이라 따로 말하지 않는다). 사용자가 다른 언어로 말하면 그 언어를 따르게 둔다
  if (lang === 'en') lines.push('The user uses the app in English. Reply in English unless the user writes in another language, and explain things simply.');
  if (settings.nickname) lines.push(`사용자를 "${settings.nickname}"(이)라고 불러 주세요.`);
  if (settings.style) lines.push(`답변 스타일: ${settings.style}`);
  return lines.join('\n');
}

// ---------- 사용량 (토큰) — 대화별은 대화 기록에, 하루별은 data/usage.json에 ----------
const USAGE_FILE = path.join(DATA_DIR, 'usage.json');
let usage = { days: {} };
try { usage = { days: {}, ...JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')) }; } catch {}
const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD (서버 시간대)
function recordUsage(input, output, cost) {
  const d = (usage.days[today()] ||= { in: 0, out: 0, cost: 0 });
  d.in += input;
  d.out += output;
  d.cost = (d.cost || 0) + cost;
  const keep = Object.keys(usage.days).sort().slice(-90); // 최근 90일만
  usage.days = Object.fromEntries(keep.map((k) => [k, usage.days[k]]));
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(USAGE_FILE, JSON.stringify(usage)); } catch {}
}

// 설정 화면의 "정보"용: 마지막으로 쓴 모델, Claude Code 버전, 로그인 계정
let lastModel = null;
let claudeVersion = null;
function readClaudeInfo() {
  require('child_process').execFile(CLAUDE_BIN, ['--version'], { env: childEnv(), timeout: 15000 }, (err, out) => {
    if (!err) claudeVersion = String(out).trim().split(/\s+/)[0];
  });
}
function claudeAccount() {
  try {
    const email = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8')).oauthAccount?.emailAddress;
    if (!email) return null;
    const [user, domain] = email.split('@');
    return `${user.slice(0, 1)}***@${domain}`; // 화면에는 가려서
  } catch { return null; }
}

function addNotice(project, text, extra = {}) {
  loadConv(project).messages.push({ role: 'notice', text, ts: Date.now(), ...extra });
  saveConv(project);
}

// ---------- 채팅만으로 코드 수정 → 검사 → 재시작 (콘솔 접속 없이) ----------
// Claude가 data/restart-request 파일을 만들면, 응답이 끝난 뒤 서버가 새 코드를 검사하고
// 통과하면 스스로 종료 → start.sh의 루프가 새 코드로 다시 띄운다. 결과는 채팅에 알림으로 남긴다.
const BOOT_ID = Date.now(); // 감자알이 켜진 시각. 화면이 이 값이 바뀐 걸 보면 새로고침해서 새 화면 코드를 받는다
const SUPERVISED = process.env.GAMJA_SUPERVISED === '1'; // start.sh 루프 아래에서만 자가 재시작 허용
const RESTART_FLAG = path.join(DATA_DIR, 'restart-request');
const PENDING_FILE = path.join(DATA_DIR, 'restart-pending.json'); // 재시작 후 알릴 내용
const ROLLBACK_NOTE = path.join(DATA_DIR, 'rollback-note'); // start.sh가 자동 복구했을 때 남기는 표시
const VERSIONS_DIR = path.join(DATA_DIR, 'versions'); // 안정적으로 돌았던 코드 스냅샷
const MAX_VERSIONS = 10;
const SKIP_TOP = new Set(['data', '.env', 'node_modules', '.git']);

function codeHash() {
  const h = crypto.createHash('sha256');
  (function walk(dir, rel) {
    for (const name of fs.readdirSync(dir).sort()) {
      if (!rel && SKIP_TOP.has(name)) continue;
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full, rel + name + '/');
      else h.update(rel + name).update('\0').update(fs.readFileSync(full));
    }
  })(__dirname, '');
  return h.digest('hex').slice(0, 12);
}
const RUNNING_HASH = codeHash(); // 지금 실행 중인 코드

function listVersions() {
  try { return fs.readdirSync(VERSIONS_DIR).filter((n) => /^\d+-[0-9a-f]+$/.test(n)).sort(); } catch { return []; }
}
// 30초 동안 문제없이 돌면 "안정 버전"으로 저장 (시작하자마자 죽는 코드는 저장되지 않음)
function saveStableVersion() {
  const versions = listVersions();
  if (versions.length && versions[versions.length - 1].endsWith('-' + RUNNING_HASH)) return;
  try {
    const dest = path.join(VERSIONS_DIR, `${Date.now()}-${RUNNING_HASH}`);
    fs.cpSync(__dirname, dest, { recursive: true, filter: (src) => !SKIP_TOP.has(path.relative(__dirname, src).split(path.sep)[0]) });
    for (const old of listVersions().slice(0, -MAX_VERSIONS)) fs.rmSync(path.join(VERSIONS_DIR, old), { recursive: true, force: true });
  } catch (e) {
    console.error('버전 저장 실패:', e.message);
  }
}

// 새 코드 검사: 문법 검사 + 임시 포트에 실제로 띄워서 응답하는지 확인
// 문법 검사는 감자알을 멈추지 않게 따로 띄운 프로그램으로 (한 번에 3개씩). 예전에는 하나씩 기다리며 돌려서, 폰에서는 검사하는 내내
// 감자알이 아무 요청에도 답하지 못하고 화면이 멈춘 것처럼 보였다
async function checkSyntax(files) {
  const { execFile } = require('child_process');
  const checkOne = (f) => new Promise((ok) => {
    execFile(process.execPath, ['--check', f], { cwd: __dirname }, (err, stdout, stderr) => ok(err ? { f, error: String(stderr || err.message).trim().slice(0, 1500) } : null));
  });
  const queue = files.slice();
  let bad = null;
  const worker = async () => {
    while (queue.length && !bad) {
      const e = await checkOne(queue.shift());
      if (e && !bad) bad = e;
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return bad;
}
async function checkNewCode() {
  const jsFiles = ['server.js', ...fs.readdirSync(PUBLIC_DIR).filter((f) => f.endsWith('.js')).map((f) => 'public/' + f)];
  const bad = await checkSyntax(jsFiles);
  if (bad) return { ok: false, error: `${bad.f} 문법 오류:\n${bad.error}` };
  return new Promise((resolve) => {
    const port = 40000 + Math.floor(Math.random() * 20000);
    const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'gamja-check-'));
    const child = spawn(process.execPath, ['server.js'], {
      cwd: __dirname,
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: tmpData, GAMJA_SUPERVISED: '' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    let settled = false;
    child.stderr.on('data', (c) => { stderr += c; });
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      clearTimeout(timeout);
      child.kill('SIGKILL');
      fs.rmSync(tmpData, { recursive: true, force: true });
      resolve(result);
    };
    const get = (p) => new Promise((ok) => {
      http.get({ host: '127.0.0.1', port, path: p, timeout: 1000 }, (r) => { r.resume(); ok(r.statusCode); }).on('error', () => ok(0));
    });
    const timer = setInterval(async () => {
      if ((await get('/api/me')) === 200 && (await get('/')) === 200) done({ ok: true });
    }, 400);
    const timeout = setTimeout(() => done({ ok: false, error: `새 서버가 10초 안에 응답하지 않았어요.\n${stderr.trim().slice(-1500)}` }), 10000);
    child.on('exit', (code) => { if (code !== null) done({ ok: false, error: `새 서버가 시작하자마자 종료됐어요 (코드 ${code}).\n${stderr.trim().slice(-1500)}` }); });
  });
}

let restarting = false;
// followUp: 재시작 후 Claude에게 결과를 알려 사용자에게 직접 보고하게 할지. depth: 자동 후속 실행 단계
function exitForRestart(project, doneText, { followUp = false, depth = 0, extra = {} } = {}) {
  fs.writeFileSync(PENDING_FILE, JSON.stringify({ project, text: doneText, followUp, depth, ...extra }));
  restarting = true;
  setTimeout(() => process.exit(0), 300); // start.sh 루프가 3초 뒤 다시 띄움
}

// ---------- 자동 후속 실행: 재시작 결과를 Claude에게 전달 → Claude가 사용자에게 보고하거나 스스로 고친다 ----------
// 무한 반복을 막기 위해 사용자 메시지 없이 이어지는 자동 실행은 MAX_AUTO 단계까지만
const MAX_AUTO = 3;
const AUTO_PREFIX = '[감자 자동 메시지]';
const nullRes = () => ({ writeHead() {}, write() {}, end() {}, on() {}, headersSent: false });
function runAuto(project, message, depth, label) {
  if (depth > MAX_AUTO) {
    addNotice(project, '⚠️ 자동 수정·재시작이 여러 번 반복돼서 멈췄어요. 상황을 확인하고 다시 말씀해 주세요.');
    return;
  }
  if (projectRuns.has(project) || restarting) return; // 사용자가 이미 다른 요청을 보냄
  handleChat(null, nullRes(), { message: `${AUTO_PREFIX} ${message}`, project }, { label, depth });
}
const AUTO_MSG = {
  restarted: (hash) => `네가 요청한 재시작이 끝났고 서버가 새 코드(${hash})로 정상 실행 중이야. ` +
    '사용자에게 무엇이 반영됐는지, 어떻게 확인하면 되는지 짧게 알려 줘. 추가 수정이 필요 없으면 data/restart-request를 다시 만들지 마.',
  checkFailed: (error) => '재시작 전 검사에서 새 코드가 실패해서 재시작하지 않았어. 서버는 이전 코드로 돌고 있어. 오류:\n' +
    `${error}\n아직 코드를 고치지 말고, 사용자에게 원인과 수정안을 쉽게 설명한 뒤 반영해도 될지 승인을 기다려 줘.`,
  rolledBack: () => '새 코드로 띄운 서버가 시작 직후 계속 죽어서, start.sh가 마지막 안정 버전으로 코드를 되돌렸어 ' +
    '(네 마지막 수정은 디스크에서 사라졌어). 아직 코드를 고치지 말고, 사용자에게 추정 원인과 수정안을 설명한 뒤 승인을 기다려 줘.',
};

// 재시작 요청이 있으면 검사 후 재시작. 반환: { status: 'none' | 'failed' | 'restart', error? }
async function restartIfRequested(project, emit, depth = 0) {
  if (restarting || projectRuns.size || !fs.existsSync(RESTART_FLAG)) return { status: 'none' };
  let reason = '';
  try { reason = fs.readFileSync(RESTART_FLAG, 'utf8').trim().slice(0, 300); } catch {}
  fs.rmSync(RESTART_FLAG, { force: true });
  if (!SUPERVISED) {
    addNotice(project, '⚠️ 재시작 요청이 있었지만, 서버가 start.sh로 실행되지 않아서 스스로 재시작할 수 없어요.');
    return { status: 'none' };
  }
  emit('status', { text: '🔍 새 코드 검사 중...' });
  const r = await checkNewCode();
  if (!r.ok) {
    addNotice(project, `❌ 새 코드 검사에 실패해서 재시작하지 않았어요. 서버는 이전 코드로 계속 돌아갑니다.\n\n${r.error}`);
    return { status: 'failed', error: r.error };
  }
  addNotice(project, `🔄 검사 통과! 서버를 재시작합니다... (몇 초 걸려요)${reason ? `\n변경: ${reason}` : ''}`, { restartPending: true });
  exitForRestart(project, '✅ 재시작 완료! 새 코드가 적용됐어요.', { followUp: true, depth });
  return { status: 'restart' };
}

// 실행 중인 버전 바로 이전의 안정 버전으로 되돌리기
function rollback(project) {
  const target = listVersions().reverse().find((v) => !v.endsWith('-' + RUNNING_HASH));
  if (!target) return false;
  fs.cpSync(path.join(VERSIONS_DIR, target), __dirname, { recursive: true, force: true });
  addNotice(project, `⏪ 이전 버전(${new Date(Number(target.split('-')[0])).toLocaleString('ko-KR')})으로 되돌리고 재시작합니다...`, { restartPending: true });
  exitForRestart(project, '✅ 이전 버전으로 되돌렸어요.');
  return true;
}

// ---------- 🆕 감자알 자동 업데이트 ----------
// 감자 앱 안의 감자알은 gamja-release의 최신 코드 묶음을 켤 때와 3시간마다 확인해 스스로 업데이트한다.
// 코드 묶음에 BUILD 파일이 들어 있는 감자 앱 설치본에서만 켜진다 (개발용 폰에는 BUILD가 없어 꺼져 있다).
// 순서: 내려받기 → 체크섬 확인 → 지금 코드 백업 → 교체 → 새 코드 검사(checkNewCode) → 재시작.
// 검사에 실패하면 원래 코드로 되돌린다. 재시작 뒤 시작하자마자 죽으면 start.sh의 자동 복구가 이어받는다.
// start.sh(감시 루프)는 안전장치라서 자동으로 바꾸지 않는다.
const UPDATE_BASE = process.env.GAMJA_UPDATE_URL || 'https://github.com/webgamja/gamja-release/releases/latest/download';
const BUILD_FILE = path.join(__dirname, 'BUILD');
const readBuild = () => { try { return parseInt(fs.readFileSync(BUILD_FILE, 'utf8'), 10) || 0; } catch { return 0; } };
const RUNNING_BUILD = readBuild();
let checkingUpdate = false; // "지금 확인" 버튼이 겹쳐서 눌리는 것을 막는다
let stagedVersion = null; // 코드는 교체했지만 응답 중이라 아직 재시작하지 못한 버전

async function updateOnce() {
  if (restarting) return 'skip';
  if (projectRuns.size) return 'busy'; // 답변 중에는 재시작하지 않는다
  if (stagedVersion) return finishUpdate(stagedVersion);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gamja-update-'));
  try {
    const metaFile = path.join(tmp, 'latest.json');
    await download(`${UPDATE_BASE}/latest.json`, metaFile);
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    if (!(meta.build > RUNNING_BUILD)) return 'latest';
    const pack = path.join(tmp, 'gamja-egg.pack');
    await download(`${UPDATE_BASE}/gamja-egg.pack`, pack);
    const sha = crypto.createHash('sha256').update(fs.readFileSync(pack)).digest('hex');
    if (sha !== meta.packSha256) throw new Error('내려받은 파일이 손상됐어요 (체크섬이 달라요)');
    if (projectRuns.size) return 'busy';

    saveStableVersion(); // 복구용: 지금 돌고 있는 코드를 안정 버전으로 남긴다
    const backup = path.join(tmp, 'backup');
    fs.cpSync(__dirname, backup, { recursive: true, filter: (src) => !SKIP_TOP.has(path.relative(__dirname, src).split(path.sep)[0]) });
    require('child_process').execFileSync('tar', ['-xzf', pack, '-C', __dirname, '--exclude=./start.sh'], { stdio: 'pipe' });
    const r = await checkNewCode();
    if (!r.ok) {
      fs.cpSync(backup, __dirname, { recursive: true, force: true });
      throw new Error(`새 버전 검사에 실패해서 이전 코드로 되돌렸어요: ${r.error}`);
    }
    console.log(`자동 업데이트: ${RUNNING_BUILD} → ${meta.build} 적용`);
    if (projectRuns.size) { stagedVersion = meta.version; return 'busy'; }
    return finishUpdate(meta.version);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
function finishUpdate(version) {
  exitForRestart('', '', { extra: { update: version } });
  return 'restart';
}
// 업데이트 기록 (최근 20개). 대화에 쌓지 않고 여기에 남긴다
const UPDATES_FILE = path.join(DATA_DIR, 'updates.json');
function recentUpdates() {
  try { return JSON.parse(fs.readFileSync(UPDATES_FILE, 'utf8')); } catch { return []; }
}
function recordUpdate(version) {
  const list = [...recentUpdates(), { version, ts: Date.now() }].slice(-20);
  try { fs.writeFileSync(UPDATES_FILE, JSON.stringify(list)); } catch {}
}

function startAutoUpdate() {
  if (!SUPERVISED || !fs.existsSync(BUILD_FILE)) return;
  const tick = async () => {
    let wait = 3 * 3600 * 1000; // 켤 때 한 번(2분 뒤), 이후 3시간마다
    try { if (settings.autoUpdate !== false && (await updateOnce()) === 'busy') wait = 10 * 60 * 1000; }
    catch (e) { console.error('자동 업데이트 실패:', e.message); wait = 3600 * 1000; }
    setTimeout(tick, wait).unref();
  };
  setTimeout(tick, 2 * 60 * 1000).unref(); // 켜진 지 2분 뒤 첫 확인 (그 전에는 30초 안정 버전 저장 등이 먼저)
}

// ---------- 🌐 외부 접속 주소 (Cloudflare 무료 빠른 터널) ----------
// https://무작위.trycloudflare.com 주소를 만들어 아이폰 Safari 등에서도 https로 접속(마이크 사용 가능)하게 한다.
// 터널 프로그램은 서버와 따로 떠 있게 해서(detached) 서버가 재시작해도 주소가 바뀌지 않는다.
const TUNNEL_BIN = path.join(DATA_DIR, 'bin', 'cloudflared');
const TUNNEL_STATE = path.join(DATA_DIR, 'tunnel.json'); // { pid, url }
const TUNNEL_LOG = path.join(DATA_DIR, 'tunnel.log');
const tunnel = { status: 'off', url: null, pid: null, error: null };
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

function loadTunnelState() {
  try {
    const s = JSON.parse(fs.readFileSync(TUNNEL_STATE, 'utf8'));
    if (s.pid && pidAlive(s.pid)) Object.assign(tunnel, { status: 'on', url: s.url, pid: s.pid });
    else fs.rmSync(TUNNEL_STATE, { force: true });
  } catch {}
}
function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    require('https').get(url, { headers: { 'User-Agent': 'gamja' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), dest, redirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`내려받기 실패 (HTTP ${res.statusCode})`)); }
      const tmp = dest + '.part';
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => out.close(() => { fs.renameSync(tmp, dest); fs.chmodSync(dest, 0o755); resolve(); }));
      out.on('error', reject);
    }).on('error', reject);
  });
}
// 개발자·Pro 모드: 외부 접속 주소(인터넷 터널)는 Pro에서 우리 서버로 제공할 예정이라, 무료 감자에서는 막아 둔다.
// 개발 중인 폰에서만 data/pro-mode 파일을 두거나 .env에 GAMJA_PRO=1을 적으면 켜진다
const PRO_MODE = process.env.GAMJA_PRO === '1' || fs.existsSync(path.join(DATA_DIR, 'pro-mode'));
async function startTunnel() {
  if (!PRO_MODE) return; // 화면을 거치지 않고 부르더라도 막는다
  if (tunnel.status === 'on' || tunnel.status === 'starting') return;
  Object.assign(tunnel, { status: 'starting', url: null, error: null });
  try {
    if (!fs.existsSync(TUNNEL_BIN)) {
      const arch = { arm64: 'arm64', x64: 'amd64', arm: 'arm' }[os.arch()];
      if (!arch) throw new Error(`지원하지 않는 기기 종류예요 (${os.arch()})`);
      fs.mkdirSync(path.dirname(TUNNEL_BIN), { recursive: true });
      await download(`https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`, TUNNEL_BIN);
    }
    fs.writeFileSync(TUNNEL_LOG, '');
    const log = fs.openSync(TUNNEL_LOG, 'a');
    // 로그는 파일로 (서버가 재시작해도 터널이 끊기지 않도록 서버와 연결을 끊어 둔다)
    const child = spawn(TUNNEL_BIN, ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${PORT}`],
      { env: childEnv(), detached: true, stdio: ['ignore', log, log] });
    child.unref();
    fs.closeSync(log);
    tunnel.pid = child.pid;
    // 로그에서 주소가 나올 때까지 최대 40초 기다린다
    for (let i = 0; i < 80; i++) {
      await new Promise((ok) => setTimeout(ok, 500));
      if (!pidAlive(child.pid)) throw new Error('터널 프로그램이 바로 종료됐어요.\n' + fs.readFileSync(TUNNEL_LOG, 'utf8').slice(-800));
      const m = fs.readFileSync(TUNNEL_LOG, 'utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) {
        Object.assign(tunnel, { status: 'on', url: m[0] });
        fs.writeFileSync(TUNNEL_STATE, JSON.stringify({ pid: child.pid, url: m[0] }));
        return;
      }
    }
    throw new Error('40초 안에 주소를 받지 못했어요. 네트워크를 확인해 주세요.');
  } catch (e) {
    if (tunnel.pid && pidAlive(tunnel.pid)) { try { process.kill(tunnel.pid); } catch {} }
    Object.assign(tunnel, { status: 'error', url: null, pid: null, error: e.message });
  }
}
function stopTunnel() {
  if (tunnel.pid && pidAlive(tunnel.pid)) { try { process.kill(tunnel.pid); } catch {} }
  fs.rmSync(TUNNEL_STATE, { force: true });
  Object.assign(tunnel, { status: 'off', url: null, pid: null, error: null });
}

// ---------- 다른 폰에 설치: 로그인한 사용자가 만든 30분짜리 링크로만 동작 ----------
// 새 폰의 Termux에서 `curl .../install/<토큰> | bash` → 코드 묶음을 받아 scripts/install.sh 실행.
// 묶음에는 코드만 들어간다 (.env 비밀번호·대화 기록·버전 백업 제외).
const INSTALL_TTL = 30 * 60e3;
function makeInstallToken() {
  const exp = Date.now() + INSTALL_TTL;
  return `${exp}.${sign('install.' + exp)}`;
}
function verifyInstallToken(token) {
  const [exp, sig] = String(token).split('.');
  return Number(exp) > Date.now() && !!sig && safeEqual(sign('install.' + exp), sig);
}
function installScript(base, token) {
  // bash가 스크립트 전체를 읽은 뒤 실행하도록 main 함수로 감싼다 (curl | bash 로 실행되므로)
  return `#!/data/data/com.termux/files/usr/bin/bash
main() {
  set -euo pipefail
  echo "🥔 감자 내려받는 중..."
  local dir="$HOME/gamja-src"
  rm -rf "$dir" && mkdir -p "$dir"
  curl -fsSL "${base}/bundle/${token}" | tar -xzf - -C "$dir"
  bash "$dir/scripts/install.sh" </dev/tty
}
main
`;
}
function sendBundle(res) {
  res.writeHead(200, { 'Content-Type': 'application/gzip', 'Cache-Control': 'no-store' });
  const tar = spawn('tar', ['-czf', '-', '--exclude=./data', '--exclude=./.env', '--exclude=./.git', '--exclude=./node_modules', '-C', __dirname, '.'],
    { env: childEnv(), stdio: ['ignore', 'pipe', 'ignore'] });
  tar.stdout.pipe(res);
  tar.on('error', () => res.end());
}

// ---------- Claude 실행 & SSE 스트리밍 ----------
const running = new Map(); // runId -> child
const projectRuns = new Map(); // project -> { runId, live: { text, tools, status } } (프로젝트당 1개만 실행)

// Termux(tmux 등)에서 상속된 LD_PRELOAD(bionic용 .so)는 glibc 바이너리인 claude를 깨뜨린다
// ("error while loading shared libraries: libc.so") → 자식 프로세스 환경에서 제거
function childEnv() {
  const env = { ...process.env };
  if (env.LD_PRELOAD && /termux/.test(env.LD_PRELOAD)) delete env.LD_PRELOAD;
  return env;
}

// ---------- 👥 그룹 채팅: 한 방에 여러 크루가 함께 있고, 사용자가 말하면 크루들이 차례로 자기 분야 의견을 낸다 ----------
// 규칙: ① 크루끼리 알아서 대화하지 않는다 (사용자가 말할 때마다 각자 한 번씩) ② 의견만 낸다 (파일을 고치거나 명령을 실행하지 못한다)
// ③ 한 번에 한 크루씩 차례로 (폰이 버티도록) ④ 마지막에 감자 톡톡이 사회자로 정리한다 (둘 이상 답했을 때)
// 각 크루는 자기 폴더의 CLAUDE.md를 읽은 채 새로 시작하고, 방의 최근 대화를 글로 받아서 맥락을 안다. @이름으로 부른 크루만 답하게 할 수 있다
const GROUP_HISTORY = 14; // 크루에게 알려 주는 방의 최근 말 수
const GROUP_READONLY = ['--permission-mode', 'default', '--allowedTools', 'Read Grep Glob',
  '--disallowedTools', 'Edit Write MultiEdit NotebookEdit Bash WebFetch WebSearch'];
function askOnce({ cwd, prompt, system, model, effort, runId }) {
  return new Promise((resolve) => {
    const args = ['-p', '--output-format', 'json', ...GROUP_READONLY];
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);
    if (system) args.push('--append-system-prompt', system);
    let child;
    try { child = spawn(CLAUDE_BIN, args, { cwd, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { return resolve({ error: 'claude 실행 실패: ' + e.message }); }
    running.set(runId, child); // 중지 버튼이 지금 돌고 있는 크루를 끊는다
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 5 * 60 * 1000);
    child.stdout.on('data', (c) => { out += c.toString('utf8'); });
    child.stderr.on('data', (c) => { err = (err + c.toString('utf8')).slice(-3000); });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
    child.on('error', (e) => { clearTimeout(timer); resolve({ error: `claude 실행 실패 (${e.code || e.message})` }); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (child.stoppedByUser) return resolve({ stopped: true });
      let j = null;
      try { j = JSON.parse(out); } catch { /* 아래에서 오류로 처리 */ }
      if (j && !j.is_error && typeof j.result === 'string') {
        return resolve({ text: j.result.trim(), cost: j.total_cost_usd || 0, usage: j.usage || {}, ms: j.duration_ms || 0 });
      }
      resolve({ error: (j && j.result) || (signal ? `강제로 끝났어요 (${signal})` : `claude 종료 코드 ${code}\n${err.trim().slice(-500)}`) });
    });
  });
}
async function handleGroupChat(res, body, project, conv) {
  const text = String(body.message || '').trim();
  if (!text) return send(res, 400, { error: '메시지가 비어 있습니다' });
  if (projectRuns.has(project)) return send(res, 409, { error: '이 방에서 이미 응답이 진행 중이에요. 끝난 뒤에 보내 주세요.' });
  const names = body.names && typeof body.names === 'object' ? body.names : {};
  const label = (c) => String(names[c] || (c === '' ? '감자 톡톡' : c)).slice(0, 40);
  const members = (conv.participants || []).filter((c) => typeof c === 'string' && !c.includes('@') && resolveProject(c)).slice(0, MAX_ROOM_MEMBERS);
  if (!members.length) return send(res, 400, { error: '이 방에 남아 있는 크루가 없어요.' });
  const only = Array.isArray(body.only) ? body.only.map(String) : [];
  const speakers = only.length ? members.filter((c) => only.includes(c)) : members;
  const lines = conv.messages.filter((m) => (m.role === 'user' || m.role === 'bot') && m.text).slice(-GROUP_HISTORY)
    .map((m) => `${m.role === 'user' ? '사용자' : label(m.by ?? crewOf(project))}: ${String(m.text).slice(0, 1200)}`); // by가 없는 말은 방을 만들 때의 크루가 한 말
  conv.messages.push({ role: 'user', text, ts: Date.now() });
  lines.push(`사용자: ${text}`);
  saveConv(project);

  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  let clientGone = false;
  res.on('close', () => { clientGone = true; });
  const runId = crypto.randomUUID();
  const live = { text: '', tools: [], status: '🤔 크루들이 생각하는 중...' };
  projectRuns.set(project, { runId, live });
  const emit = (event, data) => { if (!clientGone) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  const heartbeat = setInterval(() => { if (!clientGone) res.write(': ping\n\n'); }, 15000);
  emit('start', { runId });
  const startedAt = Date.now();
  const lang = body.lang === 'en' ? 'en' : '';
  const base = settingsPrompt(lang);
  const header = `[그룹 채팅] 참여한 크루: ${members.map(label).join(', ')}\n\n지금까지의 대화:\n`;
  let stopped = false;
  let errorText = null;
  let lastBot = null;
  let answered = 0;
  const say = (bot, title) => {
    conv.messages.push(bot);
    saveConv(project);
    lastBot = bot;
    const chunk = `**${title}**\n${bot.text}\n\n`; // 진행 중에는 한 말풍선에 이어서 보이고, 끝나면 기록에서 크루별 말풍선으로 다시 그려진다
    live.text += chunk;
    emit('delta', { text: chunk });
  };
  const record = (r) => { if (r.usage) recordUsage((r.usage.input_tokens || 0) + (r.usage.cache_creation_input_tokens || 0) + (r.usage.cache_read_input_tokens || 0), r.usage.output_tokens || 0, r.cost || 0); };
  for (const crew of speakers) {
    live.status = `💬 ${label(crew)}이(가) 생각하는 중...`;
    emit('status', { text: live.status });
    const system = [`당신은 '${label(crew)}' 크루예요. 여러 크루가 한 방에서 사용자와 함께 의논하고 있어요. ` +
      '당신 분야의 관점에서만 의견을 말하고, 6문장 이내로 핵심부터 짧게 답해요. 앞서 다른 크루가 한 말은 되풀이하지 말고 보태거나 다른 점만 말해요. ' +
      '파일을 고치거나 명령을 실행하지 말고 읽기만 해요. 모르는 것은 지어내지 말고 모른다고 해요. 사용자가 일을 시키면 "제 방에서 맡을게요"라고 안내해요.', base].filter(Boolean).join('\n');
    const r = await askOnce({
      cwd: resolveProject(crew), prompt: header + lines.join('\n'), system,
      model: projectConf[crew]?.model || settings.model, effort: projectConf[crew]?.effort || settings.effort, runId,
    });
    if (r.stopped) { stopped = true; break; }
    if (r.error) { errorText = `${label(crew)}: ${r.error}`; conv.messages.push({ role: 'error', text: errorText, ts: Date.now() }); saveConv(project); emit('error', { message: errorText }); continue; }
    record(r);
    answered++;
    lines.push(`${label(crew)}: ${r.text}`);
    say({ role: 'bot', text: r.text, ts: Date.now(), by: crew, meta: `${(r.ms / 1000).toFixed(1)}초` }, label(crew));
  }
  if (!stopped && answered >= 2) { // 사회자: 의견을 정리만 한다 (새 의견은 만들지 않는다)
    live.status = '📝 의견을 정리하는 중...';
    emit('status', { text: live.status });
    const system = ['당신은 이 그룹 채팅의 사회자예요. 위 크루들의 의견을 정리만 하고 새 의견은 만들지 않아요. ' +
      '"공통 의견", "서로 다른 점", "추천하는 다음 행동" 세 부분으로 각 1~3줄 쓰고, 어느 크루에게 일을 맡기면 좋을지도 한 줄 덧붙여요. 파일을 고치거나 명령을 실행하지 않아요.', base].filter(Boolean).join('\n');
    const r = await askOnce({ cwd: PROJECTS_DIR, prompt: header + lines.join('\n') + '\n\n위 의견들을 정리해 주세요.', system, model: settings.model, effort: settings.effort, runId });
    if (r.stopped) stopped = true;
    else if (r.error) { errorText = `정리: ${r.error}`; conv.messages.push({ role: 'error', text: errorText, ts: Date.now() }); saveConv(project); }
    else { record(r); say({ role: 'bot', text: r.text, ts: Date.now(), by: '', summary: true, meta: `${(r.ms / 1000).toFixed(1)}초` }, '정리'); }
  }
  clearInterval(heartbeat);
  running.delete(runId);
  if (stopped) { errorText = '⏹ 중지했습니다.'; conv.messages.push({ role: 'error', text: errorText, ts: Date.now() }); emit('error', { message: errorText }); }
  saveConv(project);
  projectRuns.delete(project);
  recordDone(project, lastBot || { text: '' }, stopped || !answered ? errorText : null, Date.now() - startedAt, {});
  emit('result', { isError: false, meta: '' });
  if (!clientGone) res.end();
}

// opts (서버 내부 자동 실행 전용): label = 대화에 사용자 메시지 대신 보여 줄 알림, depth = 자동 실행 단계
function handleChat(req, res, body, opts = {}) {
  const depth = opts.depth || 0;
  const project = String(body.project || '');
  const cwd = resolveProject(project);
  if (!cwd) return send(res, 400, { error: '알 수 없는 프로젝트' });
  const gconv = loadConv(project);
  if (!opts.label && Array.isArray(gconv.participants) && gconv.participants.length > 1) {
    if (!GROUP_CHAT_ENABLED) return send(res, 403, { error: '그룹 채팅은 준비 중이에요.' });
    return handleGroupChat(res, body, project, gconv);
  }
  const images = (Array.isArray(body.images) ? body.images : []).slice(0, MAX_IMAGES)
    .filter((n) => isUploadName(n) && fs.existsSync(path.join(cwd, UPLOAD_DIR, n)));
  const text = String(body.message || '').trim();
  if (!text && !images.length) return send(res, 400, { error: '메시지가 비어 있습니다' });
  // Claude에게는 첨부 이미지 경로를 함께 알려 준다 (Read 도구로 열어 봄)
  let message = images.length
    ? `${text || '(이미지를 보냈어요)'}\n\n[첨부 이미지 ${images.length}장 — Read 도구로 열어서 확인해 주세요]\n` +
      images.map((n) => `- ${UPLOAD_DIR}/${n}`).join('\n')
    : text;
  // 🗣 음성 대화 모드: 답을 소리로 읽어 주므로 짧게 말하듯 답해 달라고 덧붙인다 (대화 기록에는 사용자가 한 말만 남음)
  if (body.voice === true && !opts.label) message += `\n\n${VOICE_HINT}`;
  // 같은 세션을 동시에 두 번 돌리면 기록이 갈라지므로 프로젝트당 하나만
  if (projectRuns.has(project)) return send(res, 409, { error: '이 프로젝트에서 이미 응답이 진행 중이에요. 끝난 뒤에 보내 주세요.' });

  const conv = loadConv(project);
  const sessionId = conv.sessionId;
  conv.messages.push(opts.label
    ? { role: 'notice', text: opts.label, ts: Date.now() }
    : { role: 'user', text, ts: Date.now(), ...(images.length ? { images } : {}) });
  saveConv(project);
  // 서버가 직접 답변을 모아 저장 → 클라이언트 연결이 끊겨도 기록이 남는다
  const bot = { role: 'bot', text: '', ts: Date.now(), tools: [] };
  let lastCtx = 0; // 이번 실행에서 마지막으로 잰 대화 길이(토큰)
  let lastWasTool = false;
  let errorText = null;

  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--permission-mode', 'acceptEdits'];
  if (sessionId) args.push('--resume', sessionId);
  const model = projectConf[crewOf(project)]?.model || settings.model; // 프로젝트 설정이 전체 설정보다 우선
  if (model) args.push('--model', model);
  // 생각 깊이: 음성 대화는 빨리 답해야 하므로 항상 low. 그 외에는 프로젝트 설정 → 전체 설정 순
  const effort = body.voice === true && !opts.label ? 'low' : (projectConf[crewOf(project)]?.effort || settings.effort);
  if (effort) args.push('--effort', effort);
  const extraPrompt = [settingsPrompt(body.lang === 'en' ? 'en' : ''), toolsPrompt(), PERM_PROMPT, crewOf(project) === '' ? TALK_PROMPT : ''].filter(Boolean).join('\n');
  if (extraPrompt) args.push('--append-system-prompt', extraPrompt);
  // 자동 압축 시점: 기본은 Claude Code가 한계 가까이에서 압축. 더 일찍 압축하면 빠르고 가볍다
  if (settings.autocompact) args.push('--autocompact', settings.autocompact);
  // 도구 상자에서 설치한 도구는 gamja-make 한 가지 명령으로만 허용한다 (.env의 ALLOWED_TOOLS가 있으면 함께)
  const allowed = [ALLOWED_TOOLS, `Bash(${MAKE_CMD}:*)`, ...permRulesFor(crewOf(project))].filter(Boolean).join(' ');
  if (allowed) args.push('--allowedTools', allowed);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  let clientGone = false;
  res.on('close', () => { clientGone = true; });
  const runId = crypto.randomUUID();
  const live = { text: '', tools: bot.tools, status: '🤔 생각 중...' };
  const emit = (event, data) => {
    // 다른 기기가 GET /api/history로 진행 상황을 볼 수 있도록 live에도 반영
    if (event === 'delta') {
      if (lastWasTool && bot.text && !bot.text.endsWith('\n\n')) bot.text += '\n\n';
      lastWasTool = false;
      bot.text += data.text;
      live.text = bot.text;
      live.status = '✍️ 답변 작성 중...';
    } else if (event === 'tool') {
      lastWasTool = true;
      bot.tools.push(data.text);
      live.status = data.text;
    } else if (event === 'status') {
      live.status = data.text;
    } else if (event === 'error') {
      errorText = data.message;
    }
    if (clientGone) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let child;
  try {
    child = spawn(CLAUDE_BIN, args, { cwd, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    emit('error', { message: 'claude 실행 실패: ' + e.message });
    conv.messages.push({ role: 'error', text: errorText, ts: Date.now() });
    saveConv(project);
    return res.end();
  }
  running.set(runId, child);
  projectRuns.set(project, { runId, live });
  const startedAt = Date.now();
  emit('start', { runId, cwd });
  // 프롬프트는 stdin으로 전달 ('-'로 시작하는 메시지도 안전)
  child.stdin.on('error', () => {});
  child.stdin.end(message);

  const heartbeat = setInterval(() => { if (!clientGone) res.write(': ping\n\n'); }, 15000);
  let buf = '';
  let stderr = '';
  let gotResult = false;
  let streamedText = false; // partial 메시지로 텍스트를 이미 보냈는지 (현재 블록)

  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      handleEvent(ev);
    }
  });
  child.stderr.on('data', (c) => { stderr += c.toString('utf8'); if (stderr.length > 8000) stderr = stderr.slice(-8000); });

  function handleEvent(ev) {
    switch (ev.type) {
      case 'system':
        if (ev.subtype === 'init') {
          if (ev.model) lastModel = ev.model;
          if (ev.session_id && conv.sessionId !== ev.session_id) { conv.sessionId = ev.session_id; saveConv(project); }
          emit('session', { sessionId: ev.session_id, model: ev.model });
        }
        break;
      case 'stream_event': {
        const e = ev.event || {};
        if (ev.parent_tool_use_id) break; // 서브에이전트 내부 텍스트는 생략
        if (e.type === 'message_start') streamedText = false;
        if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta') {
          streamedText = true;
          emit('delta', { text: e.delta.text });
        } else if (e.type === 'content_block_start' && e.content_block && e.content_block.type === 'tool_use') {
          emit('status', { text: toolStatus(e.content_block.name) });
        } else if (e.type === 'content_block_start' && e.content_block && e.content_block.type === 'thinking') {
          emit('status', { text: '🤔 생각 중...' });
        }
        break;
      }
      case 'assistant': {
        if (ev.parent_tool_use_id) break;
        // 마지막 모델 호출이 읽은 양 ≈ 지금 대화 길이 (압축이 필요한지 보여 주는 데 씀)
        const mu = ev.message && ev.message.usage;
        if (mu) lastCtx = (mu.input_tokens || 0) + (mu.cache_creation_input_tokens || 0) + (mu.cache_read_input_tokens || 0) + (mu.output_tokens || 0);
        for (const block of (ev.message && ev.message.content) || []) {
          if (block.type === 'tool_use') {
            emit('tool', { name: block.name, text: toolStatus(block.name, block.input) });
          } else if (block.type === 'text' && !streamedText && block.text) {
            // partial 메시지가 없는 환경 대비
            emit('delta', { text: block.text });
          }
        }
        break;
      }
      case 'user': {
        // 도구 결과 도착 → 다음 단계 생각 중
        if (!ev.parent_tool_use_id) emit('status', { text: '🤔 생각 중...' });
        break;
      }
      case 'result': {
        gotResult = true;
        // 막힌 Bash 명령은 허용 카드로 물어보고, 그 밖의 도구(웹 가져오기 등)는 예전처럼 글로만 알린다
        const cards = deniedCards(ev.permission_denials);
        if (cards.length) bot.denied = cards;
        const denials = (ev.permission_denials || []).filter((d) => d.tool_name !== 'Bash')
          .map((d) => d.tool_name + (d.tool_input && d.tool_input.command ? `: ${d.tool_input.command}` : ''));
        if (ev.session_id) conv.sessionId = ev.session_id;
        const parts = [];
        if (ev.duration_ms) parts.push(`${(ev.duration_ms / 1000).toFixed(1)}초`);
        // API 기준 환산 금액 (구독 사용자에게 추가로 청구되지 않음 — 설정 화면에 안내). 토큰 수는 기록만 한다
        const cost = typeof ev.total_cost_usd === 'number' ? ev.total_cost_usd : 0;
        if (cost) parts.push(cost < 0.01 ? '약 $0.01 미만' : `약 $${cost.toFixed(2)}`);
        bot.meta = parts.join(' · ');
        const u = ev.usage || {};
        const input = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
        // 사용량 누적: 이 대화 + 오늘 전체
        const cu = conv.usage || {};
        conv.usage = { in: (cu.in || 0) + input, out: (cu.out || 0) + (u.output_tokens || 0), cost: (cu.cost || 0) + cost };
        recordUsage(input, u.output_tokens || 0, cost);
        // 대화 길이: 압축했으면 0(다음 메시지 때 다시 잼), 아니면 마지막으로 잰 값
        if (opts.compact) conv.context = 0;
        else if (lastCtx) conv.context = lastCtx;
        // 크루가 "설치 안 된 도구가 필요해요"라고 표시했으면 글에서 표시를 빼고, 화면이 설치 버튼을 그릴 수 있게 남긴다
        const needKits = [...bot.text.matchAll(INSTALL_MARK)].map((m) => m[1]);
        if (needKits.length) {
          bot.text = bot.text.replace(INSTALL_MARK, '\n').trim();
          bot.install = [...new Set(needKits)].filter((id) => !kitInstalled(id)).map((id) => ({ id, name: TOOLKITS[id].name, size: TOOLKITS[id].size }));
          live.text = bot.text;
        }
        if (denials.length) {
          bot.text += `\n\n> ⚠️ 권한이 거부된 도구: ${[...new Set(denials)].map((x) => '`' + x + '`').join(', ')}`;
        }
        if (ev.is_error) errorText = ev.result || `오류 (${ev.subtype})`;
        emit('result', {
          sessionId: ev.session_id,
          isError: !!ev.is_error,
          subtype: ev.subtype,
          meta: bot.meta,
          durationMs: ev.duration_ms,
          numTurns: ev.num_turns,
          denials,
          denied: bot.denied,
          install: bot.install,
          errorText: ev.is_error ? ev.result : undefined,
        });
        break;
      }
    }
  }

  let finished = false;
  child.on('error', (e) => {
    emit('error', { message: `claude 실행 실패 (${e.code || e.message}). CLAUDE_BIN 경로를 확인하세요.` });
    if (!child.pid) finish(); // 실행 자체가 안 되면 close가 오지 않을 수 있음
  });
  child.on('close', (code, signal) => {
    if (!gotResult && !errorText) {
      if (child.stoppedByUser) emit('error', { message: '⏹ 중지했습니다.' });
      // 사용자가 멈춘 게 아닌데 신호로 끝났다면 폰이 강제로 끝낸 것이다 (메모리 부족 등). 중지한 것처럼 보이면 헷갈린다
      else if (signal) emit('error', { message: `⚠️ 폰이 작업을 강제로 끝냈어요 (${signal}). 폰의 메모리가 부족할 때 생겨요. 잠시 뒤 다시 보내 보고, 계속 그러면 ⋯ → 새 대화를 눌러 주세요.` });
      else if (code !== 0) emit('error', { message: `claude 종료 코드 ${code}\n${stderr.trim().slice(-1500)}` });
    }
    finish();
  });
  async function finish() {
    if (finished) return;
    finished = true;
    clearInterval(heartbeat);
    running.delete(runId);
    if (bot.text || bot.tools.length) { bot.ts = Date.now(); conv.messages.push(bot); } // 말풍선 시각 = 답변이 끝난 시각 (시작 시각이 아니라)
    if (errorText) conv.messages.push({ role: 'error', text: errorText, ts: Date.now(), ...(AUTH_ERR.test(errorText) ? { auth: true } : {}) });
    saveConv(project);
    projectRuns.delete(project);
    recordDone(project, bot, errorText, Date.now() - startedAt, opts);
    if (!opts.compact && !opts.label) githubSyncSoon(project, text); // GitHub에 연결했으면 이 크루의 바뀐 파일을 기록
    // Claude가 코드를 고치고 재시작을 요청했으면 여기서 검사 → 재시작 (결과는 알림으로 기록)
    let r = { status: 'none' };
    try { r = await restartIfRequested(project, emit, depth); } catch (e) { addNotice(project, `❌ 재시작 처리 중 오류: ${e.message}`); }
    emit('done', {});
    if (!clientGone) res.end();
    // 검사 실패 → Claude에게 오류를 넘겨 스스로 고치게 한다
    if (r.status === 'failed') setImmediate(() => runAuto(project, AUTO_MSG.checkFailed(r.error), depth + 1, '🤖 검사 오류를 Claude에게 전달했어요. 원인을 살피는 중...'));
  }
  // 주의: 클라이언트 연결이 끊겨도(폰 화면 잠금 등) 작업은 계속 진행되고, 답변은 서버 기록에 저장된다
}

// ---------- 🔔 완료 알림 ----------
// 답변이 끝날 때마다 기록해 두면 감자 앱(GamjaService)이 /api/events로 가져가 Android 알림을 띄운다.
// 재시작 직전에 끝난 답변도 놓치지 않도록 파일에 남긴다 (최근 20개)
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
let doneEvents = [];
try { doneEvents = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8')); } catch {}
function recordDone(project, bot, errorText, ms, opts) {
  if (opts.compact) return; // 압축은 알릴 필요 없음
  const plain = (bot.text || '').replace(/[`*#>_~\[\]]/g, '').replace(/\s+/g, ' ').trim();
  const ev = {
    ts: Math.max(Date.now(), (doneEvents.at(-1)?.ts || 0) + 1), // 알림 구분용 id (항상 증가)
    project,
    seconds: Math.round(ms / 1000),
    error: !!errorText,
    preview: (errorText ? `⚠️ ${errorText}` : plain || '(도구 작업만 했어요)').slice(0, 120),
  };
  doneEvents = [...doneEvents, ev].slice(-20);
  try { fs.writeFileSync(EVENTS_FILE, JSON.stringify(doneEvents)); } catch {}
}

// ---------- 🐙 GitHub 연결: 크루가 일한 결과를 내 GitHub의 비공개 저장소에 자동 기록 ----------
// - 사용자가 자기 GitHub 계정으로 한 번 승인한다 (Device Flow: 비밀번호를 감자에 입력하지 않는다)
// - 열쇠(토큰)는 이 폰의 data/github.json에만 저장하고 어디에도 보내지 않는다 (GitHub 주소로만 쓴다)
// - 저장소는 사용자 계정의 비공개 `gamja-workspace`. 공개 저장소면 연결을 거절하고, 기록 때마다 비공개인지 다시 확인한다
// - git 프로그램 없이 GitHub 웹 API만 쓴다. 대화 기록은 올리지 않고, 크루 폴더의 파일만 올린다
const GH_CLIENT_ID = 'Ov23li3FGMq4nDD2A6vl'; // 공개해도 되는 앱 번호. 비밀 값(secret)은 쓰지 않는다
const GH_REPO = 'gamja-workspace';
const GH_FILE = path.join(DATA_DIR, 'github.json');
let gh = null; // { token, login, repo, branch, connectedAt, lastSync, lastCount, lastError }
try { gh = JSON.parse(fs.readFileSync(GH_FILE, 'utf8')); } catch {}
function saveGh() {
  if (!gh) { fs.rmSync(GH_FILE, { force: true }); return; }
  fs.writeFileSync(GH_FILE, JSON.stringify(gh), { mode: 0o600 });
}
const ghSleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ghApi(method, p, body, token = gh && gh.token) {
  const r = await fetch(`https://api.github.com${p}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'gamja-egg', 'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
async function ghForm(url, body) {
  const r = await fetch(url, {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'gamja-egg' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  return r.json();
}

// 승인 받기 (Device Flow). 감자알이 직접 승인을 기다리므로 화면을 닫았다 열어도 이어진다
let ghDevice = null; // { device_code, user_code, verification_uri, expiresAt, interval, error }
async function ghStart() {
  if (ghDevice && !ghDevice.error && ghDevice.expiresAt > Date.now()) return ghDevice;
  const d = await ghForm('https://github.com/login/device/code', { client_id: GH_CLIENT_ID, scope: 'repo' });
  if (!d.device_code) throw new Error(d.error_description || 'GitHub에서 코드를 받지 못했어요');
  ghDevice = {
    device_code: d.device_code, user_code: d.user_code, verification_uri: d.verification_uri,
    expiresAt: Date.now() + d.expires_in * 1000, interval: (d.interval || 5) * 1000, error: null,
  };
  ghPoll(ghDevice);
  return ghDevice;
}
async function ghPoll(dev) {
  while (ghDevice === dev && Date.now() < dev.expiresAt) {
    await ghSleep(dev.interval);
    if (ghDevice !== dev) return;
    try {
      const d = await ghForm('https://github.com/login/oauth/access_token', {
        client_id: GH_CLIENT_ID, device_code: dev.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      });
      if (d.access_token) {
        try { await ghFinishConnect(d.access_token); if (ghDevice === dev) ghDevice = null; }
        catch (e) { dev.error = e.message; }
        return;
      }
      if (d.error === 'slow_down') dev.interval += 5000;
      else if (d.error && d.error !== 'authorization_pending') {
        dev.error = d.error === 'access_denied' ? '승인이 취소됐어요' : d.error === 'expired_token' ? '코드가 만료됐어요. 다시 시도해 주세요' : (d.error_description || d.error);
        return;
      }
    } catch { /* 일시적인 네트워크 문제는 다음 차례에 다시 */ }
  }
  if (ghDevice === dev && !dev.error) dev.error = '코드가 만료됐어요. 다시 시도해 주세요';
}
async function ghFinishConnect(token) {
  const u = await ghApi('GET', '/user', null, token);
  if (u.status !== 200) throw new Error('GitHub 계정 정보를 읽지 못했어요');
  const login = u.data.login;
  let repo = await ghApi('GET', `/repos/${login}/${GH_REPO}`, null, token);
  if (repo.status === 404) {
    repo = await ghApi('POST', '/user/repos', {
      name: GH_REPO, private: true, auto_init: true, description: 'GAMJA 크루가 일한 결과를 자동으로 기록해 두는 저장소',
    }, token);
    if (repo.status !== 201) throw new Error(`저장소를 만들지 못했어요 (${repo.status})`);
  } else if (repo.status !== 200) {
    throw new Error(`저장소를 확인하지 못했어요 (${repo.status})`);
  } else if (repo.data.private !== true) {
    throw new Error(`이미 있는 ${GH_REPO}가 공개 저장소예요. 공개 저장소에는 올리지 않아요. 비공개로 바꾸거나 이름을 바꾼 뒤 다시 연결해 주세요.`);
  }
  gh = { token, login, repo: GH_REPO, branch: repo.data.default_branch || 'main', connectedAt: Date.now(), lastSync: 0, lastCount: 0, lastError: '' };
  saveGh();
  githubSync(null, '감자 연결: 처음 기록');
}

// 올릴 파일 고르기: 점(.)으로 시작하는 것, node_modules, 큰 파일, 비밀처럼 보이는 파일은 올리지 않는다.
// 자기 git 기록이 이미 있는 폴더(.git)는 통째로 건너뛴다
const GH_SECRET = /(^|[._-])(id_rsa|id_ed25519|secrets?|credentials?|passwd|password|token|private[_-]?key)([._-]|$)|\.(pem|key|p12|pfx|keystore|jks)$|_deploy$/i;
function ghScan(dir, prefix, out, skipped) {
  if (fs.existsSync(path.join(dir, '.git'))) { skipped.push(prefix.replace(/\/$/, '')); return; }
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.isSymbolicLink()) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { ghScan(full, `${prefix}${e.name}/`, out, skipped); continue; }
    if (!e.isFile() || GH_SECRET.test(e.name)) continue;
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (st.size > 1024 * 1024) continue;
    out.set(`${prefix}${e.name}`, full);
    if (out.size > 3000) throw new Error('올릴 파일이 너무 많아요 (3000개 넘음)');
  }
}
const gitBlobSha = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

let ghQueue = Promise.resolve();
let ghSyncing = false;
function githubSync(projects, message) {
  ghQueue = ghQueue.then(() => ghSyncOnce(projects, message)).catch(() => {});
  return ghQueue;
}
async function ghSyncOnce(projects, message) {
  if (!gh) return;
  ghSyncing = true;
  try {
    const { login, repo, branch } = gh;
    const base = `/repos/${login}/${repo}`;
    const info = await ghApi('GET', base);
    if (info.status !== 200) throw new Error(`저장소를 열 수 없어요 (${info.status})`);
    if (info.data.private !== true) throw new Error('저장소가 공개로 바뀌어 있어서 기록을 멈췄어요. 비공개로 되돌린 뒤 다시 시도해 주세요');
    const ref = await ghApi('GET', `${base}/git/ref/heads/${branch}`);
    if (ref.status !== 200) throw new Error(`저장소의 ${branch} 가지를 찾지 못했어요`);
    const headSha = ref.data.object.sha;
    const head = await ghApi('GET', `${base}/git/commits/${headSha}`);
    const baseTree = head.data.tree.sha;
    const tree = await ghApi('GET', `${base}/git/trees/${baseTree}?recursive=1`);
    if (tree.status !== 200 || tree.data.truncated) throw new Error('저장소가 너무 커서 비교하지 못했어요');
    const remote = new Map(tree.data.tree.filter((t) => t.type === 'blob').map((t) => [t.path, t.sha]));

    const names = (projects || listProjects()).filter((n) => n && isProjectName(n));
    const local = new Map();
    const skipped = [];
    for (const n of names) {
      const dir = resolveProject(n);
      if (dir) ghScan(dir, `${n}/`, local, skipped);
    }
    const entries = [];
    for (const [p, full] of local) {
      const buf = fs.readFileSync(full);
      if (remote.get(p) === gitBlobSha(buf)) continue;
      const isText = !buf.includes(0) && Buffer.from(buf.toString('utf8'), 'utf8').equals(buf);
      if (isText) entries.push({ path: p, mode: '100644', type: 'blob', content: buf.toString('utf8') });
      else {
        const b = await ghApi('POST', `${base}/git/blobs`, { content: buf.toString('base64'), encoding: 'base64' });
        if (b.status !== 201) throw new Error(`파일을 올리지 못했어요: ${p}`);
        entries.push({ path: p, mode: '100644', type: 'blob', sha: b.data.sha });
      }
    }
    // 지운 파일: 기록하는 크루 폴더 안에서 없어진 것만 지운다 (다른 폴더나 README는 건드리지 않는다)
    for (const p of remote.keys()) {
      const top = p.split('/')[0];
      if (p.includes('/') && names.includes(top) && !skipped.includes(top) && !local.has(p)) entries.push({ path: p, mode: '100644', type: 'blob', sha: null });
    }
    if (!entries.length) { gh.lastSync = Date.now(); gh.lastCount = 0; gh.lastError = ''; saveGh(); return; }
    if (entries.length > 500) throw new Error('한 번에 바뀐 파일이 너무 많아요 (500개 넘음)');

    const nt = await ghApi('POST', `${base}/git/trees`, { base_tree: baseTree, tree: entries });
    if (nt.status !== 201) throw new Error(`기록을 만들지 못했어요 (${nt.status})`);
    const cm = await ghApi('POST', `${base}/git/commits`, { message: String(message || '크루 작업 기록').slice(0, 200), tree: nt.data.sha, parents: [headSha] });
    if (cm.status !== 201) throw new Error(`기록을 저장하지 못했어요 (${cm.status})`);
    const up = await ghApi('PATCH', `${base}/git/refs/heads/${branch}`, { sha: cm.data.sha });
    if (up.status !== 200) throw new Error(`기록을 올리지 못했어요 (${up.status})`);
    gh.lastSync = Date.now(); gh.lastCount = entries.length; gh.lastError = '';
    gh.skipped = skipped;
    saveGh();
  } catch (e) {
    if (gh) { gh.lastError = e.name === 'TimeoutError' ? 'GitHub 응답이 늦어요. 잠시 뒤 다시 시도해요' : e.message; saveGh(); }
  } finally {
    ghSyncing = false;
  }
}
// 크루가 답을 끝낼 때마다 호출: 잠깐 모았다가(연달아 끝나는 것을 묶으려고) 그 크루의 바뀐 파일만 기록한다
const ghWaiting = new Map();
let ghTimer = null;
function githubSyncSoon(project, hint) {
  if (!gh || !project) return; // 연결 전이거나 홈 대화면 하지 않는다
  ghWaiting.set(project, String(hint || '').replace(/\s+/g, ' ').trim().slice(0, 50));
  clearTimeout(ghTimer);
  ghTimer = setTimeout(() => {
    const items = [...ghWaiting.entries()];
    ghWaiting.clear();
    const msg = items.length === 1 ? `[${items[0][0]}] ${items[0][1] || '작업 기록'}` : `크루 ${items.length}곳 작업 기록`;
    githubSync(items.map(([p]) => p), msg);
  }, 4000);
}

// ---------- 👀 결과물: 크루가 만든 웹페이지 미리보기 ----------
// /preview/<열쇠>/<크루>/<파일> 로 그 크루 폴더의 웹 파일을 보여 준다.
// 열쇠는 로그인한 사용자에게만 발급되고 6시간 뒤 만료된다. 쿠키 대신 주소에 열쇠를 넣는 이유: 아래 "격리 모드"의 페이지는
// 쿠키를 보내지 못해서, 그 안에서 불러오는 css·js·이미지가 쿠키에 의존하면 깨진다.
// 만든 페이지는 감자와 같은 주소에서 열리므로 CSP sandbox(격리 모드)로 연다 → 감자의 로그인·대화·저장소에 접근할 수 없다.
const PREVIEW_TTL = 6 * 3600e3;
const PREVIEW_TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webmanifest': 'application/manifest+json',
  // 결과물: 문서·음악·영상. 글(.md·.csv)은 브라우저가 내려받지 않고 그대로 보여 주게 글자로 보낸다
  '.md': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
// 브라우저가 화면에 보여 줄 수 없는 파일(워드·엑셀·파워포인트)은 내려받게 한다
const PREVIEW_DOWNLOAD = new Set(['.docx', '.xlsx', '.pptx']);
// 결과물 종류 (확장자로 나눈다). 코드·설정 파일은 결과물이 아니라서 여기에 없다
const RESULT_KINDS = {
  web: ['.html', '.htm'],
  image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'],
  doc: ['.pdf', '.txt', '.md', '.csv', '.docx', '.xlsx', '.pptx'],
  audio: ['.mp3', '.wav', '.m4a', '.ogg', '.flac'],
  video: ['.mp4', '.webm', '.mov', '.m4v'],
};
const KIND_OF_EXT = Object.fromEntries(Object.entries(RESULT_KINDS).flatMap(([kind, exts]) => exts.map((e) => [e, kind])));
const NOT_RESULT_NAMES = new Set(['claude.md', 'readme.md', 'license.md', 'license.txt', 'requirements.txt']); // 크루의 지침·설명서는 결과물이 아니다
function makePreviewToken(project) {
  const exp = Date.now() + PREVIEW_TTL;
  return `${exp}.${sign(`preview.${project}.${exp}`)}`;
}
function verifyPreviewToken(token, project) {
  const [exp, sig] = String(token).split('.');
  return Number(exp) > Date.now() && !!sig && safeEqual(sign(`preview.${project}.${exp}`), sig);
}
function previewHeaders(type, fileName) {
  const h = {
    'Content-Type': type,
    'Cache-Control': 'no-cache',
    'Content-Security-Policy': 'sandbox allow-scripts allow-forms allow-popups allow-modals',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
  if (fileName && PREVIEW_DOWNLOAD.has(path.extname(fileName).toLowerCase())) {
    h['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(fileName))}`;
  }
  return h;
}
function servePreview(req, res, urlPath) {
  const segs = urlPath.split('/').slice(2); // ['<열쇠>', '<크루>', ...파일 경로]
  let project, rel;
  try {
    project = decodeURIComponent(segs[1] || '');
    rel = segs.slice(2).map(decodeURIComponent);
  } catch { return send(res, 400, 'bad request'); }
  const notFound = () => send(res, 404, '찾을 수 없어요');
  if (!project || !verifyPreviewToken(segs[0], project)) return send(res, 403, '주소가 만료됐어요. 감자에서 "👀 결과물"을 다시 열어 주세요.');
  const dir = project === TALK_DIR_NAME ? TALK_DIR : resolveProject(project);
  if (!dir) return notFound();
  // 점(.)으로 시작하는 파일·폴더(.git, .gamja-uploads 등)와 상위 폴더 이동은 막는다
  if (rel.some((s) => s === '..' || s.startsWith('.') || s.includes('\0'))) return notFound();
  let file = path.join(dir, ...rel.filter(Boolean));
  let real;
  try { real = fs.realpathSync(file); } catch { return notFound(); }
  const realDir = fs.realpathSync(dir);
  if (real !== realDir && !real.startsWith(realDir + path.sep)) return notFound(); // 바로가기(링크)로 폴더 밖을 가리키는 경우
  if (fs.statSync(real).isDirectory()) {
    if (!urlPath.endsWith('/')) { res.writeHead(301, { Location: urlPath + '/' }); return res.end(); } // 상대 경로가 맞도록
    file = path.join(real, 'index.html');
    try { real = fs.realpathSync(file); } catch { return notFound(); }
    if (!real.startsWith(realDir + path.sep)) return notFound();
  }
  const type = PREVIEW_TYPES[path.extname(real).toLowerCase()];
  if (!type) return notFound(); // 웹·이미지·글꼴·PDF 같은 정해 둔 종류만
  // 파일을 통째로 메모리에 올리지 않고 조금씩 보낸다. 영상·긴 음악은 Range 요청(건너뛰기·이어 받기)도 받는다
  fs.stat(real, (err, st) => {
    if (err || !st.isFile()) return notFound();
    const size = st.size;
    const headers = previewHeaders(type, real);
    headers['Accept-Ranges'] = 'bytes';
    let start = 0, end = size - 1, code = 200;
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (m && (m[1] || m[2]) && size > 0) {
      if (m[1]) { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
      else { start = Math.max(0, size - Number(m[2])); } // "맨 끝 n바이트"
      if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
      code = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
    headers['Content-Length'] = size ? end - start + 1 : 0;
    res.writeHead(code, headers);
    if (!size) return res.end();
    fs.createReadStream(real, { start, end }).on('error', () => res.destroy()).pipe(res);
  });
}
// 그 크루 폴더의 결과물 목록: 웹페이지·이미지·문서·음악·영상 (3단계 깊이까지, 최근 것 먼저)
function listResults(dir) {
  const out = [];
  (function walk(d, rel, depth) {
    let names = [];
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '__pycache__' || e.name === 'venv') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 3) walk(full, rel + e.name + '/', depth + 1); continue; }
      const kind = KIND_OF_EXT[path.extname(e.name).toLowerCase()];
      if (!kind || NOT_RESULT_NAMES.has(e.name.toLowerCase())) continue;
      try { const st = fs.statSync(full); out.push({ path: rel + e.name, kind, size: st.size, mtime: st.mtimeMs }); } catch {}
    }
  })(dir, '', 1);
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, 300);
}
// 같은 와이파이의 다른 기기가 접속할 주소 후보
function lanOrigins() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${PORT}`);
  }
  return out;
}

// ---------- 🛠 도구 상자: 크루가 문서·그림·영상·소리를 만들 때 쓰는 도구 ----------
// 크루(Claude)는 acceptEdits 모드라 파일은 쓸 수 있지만 프로그램은 실행하지 못한다. 그래서 설치한 도구는 정해 둔 한 가지 명령(tools/gamja-make.js)으로만
// 쓰게 허용한다. 이 명령은 이 크루 폴더 안의 파일만 다루고, 정해 둔 프로그램을 정해 둔 방법으로만 부른다 (아무 명령이나 실행하게 열어 두지 않는다).
const TOOLS_DIR = path.join(__dirname, 'tools');
const MAKE_CMD = `node ${path.join(TOOLS_DIR, 'gamja-make.js')}`;
const TOOLKITS = {
  docs: { name: '문서 도구', desc: 'PDF · 워드 · 파워포인트 · 엑셀 문서 만들기', size: '약 250MB', apt: ['pandoc', 'weasyprint', 'python3', 'python3-openpyxl', 'fonts-noto-cjk'], need: ['pandoc', 'python3'] },
  image: { name: '그림 도구', desc: '로고 · 도표 · 카드뉴스 같은 그림 파일(PNG) 만들기', size: '약 150MB', apt: ['librsvg2-bin', 'fonts-noto-cjk'], need: ['rsvg-convert'] },
  media: { name: '영상·소리 도구', desc: '사진으로 슬라이드 영상, 간단한 소리 만들기', size: '약 300MB', apt: ['ffmpeg', 'python3'], need: ['ffmpeg', 'python3'] },
};
function hasCmd(cmd) {
  for (const dir of String(process.env.PATH || '').split(':')) {
    if (!dir) continue;
    try { fs.accessSync(path.join(dir, cmd), fs.constants.X_OK); return true; } catch { /* 다음 폴더 */ }
  }
  return false;
}
const kitInstalled = (id) => TOOLKITS[id].need.every(hasCmd);
const anyKit = () => Object.keys(TOOLKITS).some(kitInstalled);
const toolInstall = { kit: null, startedAt: 0, log: [], error: '' };
function toolLog(line) { toolInstall.log.push(String(line).slice(0, 300)); toolInstall.log = toolInstall.log.slice(-40); }
function installKit(id, done) {
  const kit = TOOLKITS[id];
  const finishKit = () => { if (done) done(!toolInstall.error); };
  toolInstall.kit = id; toolInstall.startedAt = Date.now(); toolInstall.log = []; toolInstall.error = '';
  const env = { ...process.env, DEBIAN_FRONTEND: 'noninteractive' };
  const run = (args, next) => {
    toolLog(`$ apt-get ${args.join(' ')}`);
    const p = spawn('apt-get', args, { env });
    const feed = (b) => String(b).split('\n').filter(Boolean).forEach(toolLog);
    p.stdout.on('data', feed); p.stderr.on('data', feed);
    p.on('error', (e) => { toolInstall.error = `apt-get을 실행하지 못했어요 (${e.code || e.message})`; toolInstall.kit = null; finishKit(); });
    p.on('close', (code) => {
      if (code !== 0) { toolInstall.error = `설치가 끝까지 되지 않았어요 (종료 코드 ${code}). 인터넷 연결과 저장 공간을 확인한 뒤 다시 눌러 주세요.`; toolInstall.kit = null; finishKit(); return; }
      next();
    });
  };
  run(['update'], () => run(['install', '-y', '--no-install-recommends', ...kit.apt], () => { toolLog('✅ 설치가 끝났어요'); toolInstall.kit = null; finishKit(); }));
}
// 기본 도구 자동 준비: 그림·문서 도구가 없으면 답변이 없는 틈에 조용히 설치한다 (영상·소리 도구는 필요할 때 설치 버튼으로).
// 폰 안의 우분투(root)에서만 하고, 실패하면 하루 동안은 다시 시도하지 않는다. 끄려면 data/no-auto-tools 파일을 만든다
const AUTO_KITS = ['image', 'docs'];
const AUTO_TOOLS_FILE = path.join(DATA_DIR, 'tools-auto.json');
function autoToolsOff() {
  if (fs.existsSync(path.join(DATA_DIR, 'no-auto-tools'))) return true;
  if (!(process.getuid && process.getuid() === 0) || !hasCmd('apt-get')) return true;
  try { if (Date.now() - JSON.parse(fs.readFileSync(AUTO_TOOLS_FILE, 'utf8')).failedAt < 24 * 3600 * 1000) return true; } catch { /* 기록이 없으면 시도 */ }
  return false;
}
function prepareDefaultKits() {
  if (toolInstall.kit || projectRuns.size || autoToolsOff()) return;
  const id = AUTO_KITS.find((k) => !kitInstalled(k));
  if (!id) return;
  toolLog(`처음 준비: ${TOOLKITS[id].name}를 설치해요`);
  installKit(id, (ok) => {
    if (!ok) { try { fs.writeFileSync(AUTO_TOOLS_FILE, JSON.stringify({ failedAt: Date.now() })); } catch { /* 기록 실패는 무시 */ } return; }
    setTimeout(prepareDefaultKits, 2000); // 다음 도구
  });
}
// 크루에게 알려 줄 사용법 (도구를 하나라도 설치했을 때만 덧붙인다)
function toolsPrompt() {
  const lines = ['이 폰에서는 파일을 만드는 프로그램을 직접 실행할 수 없고, 아래 한 가지 명령만 쓸 수 있어요.',
    `먼저 재료 파일(마크다운·CSV·SVG·JSON)을 이 폴더에 쓴 뒤 "${MAKE_CMD} <종류> <인자…>"를 실행하세요. 자세한 사용법은 "${MAKE_CMD} help"로 볼 수 있어요.`];
  const missing = [];
  const kit = (id, usage) => { if (kitInstalled(id)) lines.push(usage); else missing.push(id); };
  kit('docs', '- 문서: doc 글.md 결과.docx|pdf|html|pptx / sheet 표.csv 결과.xlsx');
  kit('image', '- 그림: image 그림.svg 결과.png [가로픽셀]');
  kit('media', '- 영상: video 결과.mp4 한장당초 소리파일또는- 사진1 사진2 … / 소리: audio 악보.json 결과.wav');
  lines.push('- 사주 계산(도구 설치 없이 항상 가능): saju 1990-05-15 14:30 남  (시각을 모르면 14:30 대신 모름, 여자는 여. 음력이면 날짜 뒤에 --lunar, 윤달이면 --lunar --leap. 옵션 --zasi jo|yaja --no-correction)');
  lines.push('만든 파일은 이 크루의 "결과물"에 자동으로 보여요.');
  if (missing.length) {
    lines.push(`아직 설치되지 않은 도구: ${missing.map((id) => `${TOOLKITS[id].name}(${id})`).join(', ')}. 이 중 하나가 꼭 필요한 일이면 쓰려고 하지 말고, 답변 맨 끝에 정확히 [[gamja-install:도구id]] 한 줄만 쓰세요. 예: [[gamja-install:image]]. 그러면 화면에 "설치하고 이어서 하기" 버튼이 나와요. 사용자에게는 "이 일에는 OO 도구가 필요해요. 아래 버튼을 누르면 설치하고 이어서 할게요"라고 쉬운 말로 한 문장만 설명하세요.`);
  }
  return lines.join('\n');
}
const INSTALL_MARK = /\s*\[\[gamja-install:(docs|image|media)\]\]\s*/g;

// ---------- 🔐 막힌 명령 허용 ----------
// 크루가 허용 목록에 없는 Bash 명령을 쓰려다 막히면 화면에 카드를 보여 주고, 사용자가 이번만/항상/허용 안 함을 고른다.
// - 허용 목록은 크루 폴더가 아니라 data/permissions.json에 둔다 (크루가 자기 폴더의 설정을 고쳐 스스로 권한을 올리지 못하게)
// - 화면은 명령 글자를 보내지 않고 카드 번호(id)만 보낸다. 감자알이 기록해 둔 막힌 명령에서만 허용할 수 있다
// - 위험한 명령, 여러 명령이 이어진 명령, 비밀 파일을 건드리는 명령은 어디서든 허용할 수 없다
const PERM_FILE = path.join(DATA_DIR, 'permissions.json');
let perms = {}; // { 크루: [{ rule, cmd, ts }] }
try { perms = JSON.parse(fs.readFileSync(PERM_FILE, 'utf8')) || {}; } catch {}
function savePerms() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PERM_FILE, JSON.stringify(perms, null, 2));
}
const permOnce = new Map(); // 크루 -> { rules, until } 이번만 허용: 다음 한 번의 실행에만 쓰고 지운다
const PERM_MAX_RULES = 100;
const PERM_CRITICAL = new Set(['sudo', 'su', 'doas', 'dd', 'mkfs', 'fdisk', 'mount', 'umount', 'chown', 'chgrp', 'shutdown', 'reboot', 'halt', 'poweroff',
  'kill', 'pkill', 'killall', 'systemctl', 'service', 'crontab', 'passwd', 'useradd', 'userdel', 'iptables', 'nc', 'ncat', 'netcat', 'socat', 'telnet',
  'eval', 'exec', 'source', '.', 'ssh', 'scp', 'sftp', 'rsync', 'mkfifo', 'nohup', 'setsid', 'disown', 'screen', 'tmux', 'chroot', 'insmod', 'modprobe']);
const PERM_SECRET = /(^|[\s/=])\.env\b|\.ssh\b|id_rsa|id_ed25519|gamja_public_deploy|data\/ssh|permissions\.json|restart-request|start\.sh|\/proc\/|\/etc\/|\/sys\/|\/dev\/(?!null\b)/;
const PERM_NET = new Set(['apt', 'apt-get', 'dpkg', 'npm', 'npx', 'pnpm', 'yarn', 'pip', 'pip3', 'pipx', 'curl', 'wget']);
// 아무 코드나 돌릴 수 있는 프로그램: "항상 허용"도 그 명령 그대로만 (인자가 달라지면 다시 묻는다)
const PERM_EXACT = new Set(['node', 'nodejs', 'python', 'python3', 'bash', 'sh', 'zsh', 'perl', 'ruby', 'php', 'deno', 'bun', 'awk', 'gawk', 'find', 'xargs', 'env', 'time', 'timeout', 'watch', 'script', 'docker', 'make', 'sed', 'tar', 'unzip']);
const PERM_SUBCMD = new Set(['git', 'gh', 'cargo', 'go', 'systemctl']);
const PERM_READ = new Set(['ls', 'cat', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'wc', 'du', 'df', 'pwd', 'echo', 'printf', 'date', 'which', 'whereis', 'file', 'stat', 'tree', 'sort', 'uniq', 'diff', 'cmp', 'cut', 'tr', 'basename', 'dirname', 'realpath', 'readlink', 'id', 'whoami', 'uname', 'hostname', 'true', 'false', 'test']);
const PERM_WRITE = new Set(['mkdir', 'touch', 'cp', 'mv', 'chmod', 'rm', 'rmdir', 'tee', 'truncate', 'install', 'ln', 'zip', 'gzip', 'gunzip', 'bzip2', '7z', 'sed', 'tar', 'unzip']);
// 명령 하나를 살펴서 { risk, once, always, rule }을 돌려준다. risk: read | write | run | net | critical | complex
function classifyCommand(cmd) {
  const text = String(cmd || '').trim();
  const none = { risk: 'complex', once: false, always: false, rule: '', onceRule: '', prog: '' };
  if (!text || text.length > 400) return none;
  if (/[;&|`<>\n\r()*]|\$[({]/.test(text)) return none; // 이어진 명령·치환·글롭은 한 번에 허용할 수 없다 (규칙으로 정확히 표현할 수 없어서)
  const tok = text.split(/\s+/);
  const prog = tok[0].replace(/^.*\//, '');
  const base = { ...none, prog };
  if (PERM_SECRET.test(text) || PERM_CRITICAL.has(prog)) return { ...base, risk: 'critical' };
  if (prog === 'rm' && /(^|\s)(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive|--no-preserve-root)(\s|$)/.test(text)) return { ...base, risk: 'critical' };
  if (prog === 'chmod' && /(\s-[a-zA-Z]*R|777|a\+rwx)/.test(text)) return { ...base, risk: 'critical' };
  const exactOnly = PERM_EXACT.has(prog);
  const sub = PERM_SUBCMD.has(prog) && tok[1] && !tok[1].startsWith('-') ? ` ${tok[1]}` : '';
  const rule = exactOnly ? `Bash(${text})` : `Bash(${tok[0]}${sub}:*)`; // 항상 허용에 쓰는 규칙 (좁게)
  const onceRule = `Bash(${text})`; // 이번만 허용은 이 명령 그대로만
  const b2 = { ...base, rule, onceRule };
  if (PERM_NET.has(prog)) return { ...b2, risk: 'net', once: true };
  if (PERM_READ.has(prog)) return { ...b2, risk: 'read', once: true, always: !exactOnly };
  if (PERM_WRITE.has(prog)) return { ...b2, risk: 'write', once: true, always: !exactOnly && prog !== 'rm' && prog !== 'chmod' };
  return { ...b2, risk: 'run', once: true, always: true };
}
// 막힌 Bash 명령 → 화면에 보여 줄 카드 (최대 3개, 같은 명령은 한 번만)
function deniedCards(denials) {
  const out = [];
  for (const d of denials || []) {
    if (d.tool_name !== 'Bash' || !d.tool_input || !d.tool_input.command) continue;
    const cmd = String(d.tool_input.command).trim().slice(0, 401);
    if (out.some((x) => x.cmd === cmd)) continue;
    const c = classifyCommand(cmd);
    out.push({ id: crypto.randomBytes(6).toString('hex'), cmd, risk: c.risk, once: c.once, always: c.always });
    if (out.length >= 3) break;
  }
  return out;
}
// 이번 실행에 더할 허용 규칙: 이 크루가 "항상 허용"한 것 + (있으면) "이번만 허용"한 것 한 번
function permRulesFor(crew) {
  const once = permOnce.get(crew);
  permOnce.delete(crew);
  return [...(perms[crew] || []).map((x) => x.rule), ...(once && once.until > Date.now() ? once.rules : [])];
}
// 감자 톡톡은 ~/projects 전체가 작업 위치라서, 만든 파일이 여기저기 흩어지지 않게 한 폴더로 모은다
const TALK_PROMPT = `지금은 특정 크루가 아닌 감자 톡톡 대화예요. 사용자가 문서·그림·웹페이지·표 같은 파일을 만들어 달라고 하면 반드시 ${TALK_DIR_NAME} 폴더 안에만 저장하세요(폴더가 없으면 만드세요). 그 밖의 폴더(크루 폴더, gamja 등)의 파일은 고치거나 만들지 마세요. 만든 뒤에는 "화면 위쪽 👀 결과물에서 볼 수 있어요"라고 알려 주세요. 오래 걸리고 깊은 작업(홈페이지 개발, 사주 풀이 등)이면 그 일에 맞는 크루를 크루 탭에서 만들거나 골라 이어서 하라고 추천하세요.`;
const PERM_PROMPT = '이 폰에서는 허용 목록에 없는 명령은 실행되지 않고, 화면에 사용자가 고를 수 있는 "허용 카드"가 나와요. 명령이 막히면 다른 방법으로 우회하거나 같은 명령을 다시 시도하지 말고, 무엇을 하려던 건지 쉬운 말로 한 문장만 설명한 뒤 "아래 카드에서 허용해 주시면 이어서 할게요"라고 안내하세요.';

// 같은 와이파이 접속이 꺼져 있을 때 다른 기기의 브라우저가 보는 안내 화면 (한국어·영어)
const LAN_OFF_PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GAMJA</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f2f4f6;color:#191f28;font-family:system-ui,sans-serif;text-align:center}
main{padding:28px;max-width:360px}h1{font-size:22px;margin:0 0 10px}p{margin:0 0 18px;line-height:1.6;color:#6b7684}
button{border:0;border-radius:14px;padding:14px 26px;background:#fee500;color:#191919;font-size:16px;font-weight:800}</style></head>
<body><main><h1 id="t">접속이 꺼져 있어요</h1><p id="d">이 폰의 감자에서 같은 와이파이 접속을 껐거나 아직 켜지 않았어요. 폰에서 더보기 → 연결 → 외부 접속을 켠 뒤 다시 시도해 주세요.</p><button id="b" onclick="location.reload()">다시 시도</button></main>
<script>if(!/^ko/i.test(navigator.language)){t.textContent='Access is off';d.textContent='Same-Wi-Fi access is turned off on the phone. Turn it on in the GAMJA console (More > Connections > External access) and try again.';b.textContent='Try again'}</script></body></html>`;

// ---------- 라우팅 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  // 브라우저로 쓰게 되면서 다른 사이트가 감자 콘솔 화면을 액자(iframe)에 넣어 누르게 속이는 일을 막는다.
  // 크루가 만든 결과물(/preview/)은 아래 previewHeaders가 따로 보안 헤더(sandbox 등)를 붙인다
  if (!p.startsWith('/preview/')) {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
  }
  // 로그인 시도 제한용 IP. 터널을 거치면 모두 127.0.0.1로 보이므로, 이 폰 안에서 온 요청일 때만
  // 터널이 알려 주는 실제 접속자 주소(cf-connecting-ip)를 믿는다
  const sockIp = req.socket.remoteAddress || '';
  const fromLocal = sockIp === '127.0.0.1' || sockIp === '::1' || sockIp === '::ffff:127.0.0.1';
  const ip = (fromLocal && req.headers['cf-connecting-ip']) || sockIp;
  // 이 폰 안에서 직접 연 화면인지 (감자 앱, 이 폰의 브라우저). 외부 접속 주소(터널)를 거친 요청은 포함하지 않는다
  const isLocal = fromLocal && !req.headers['cf-connecting-ip'] && !req.headers['x-forwarded-for'];

  // 같은 와이파이 접속이 꺼져 있으면(기본) 이 폰 안의 요청과 개발자 모드의 터널만 받는다.
  // 새 폰 설치 주소(/install/…)는 30분짜리 토큰이 따로 지켜서 예외로 둔다
  if (!fromLocal && !settings.lanAccess && !p.startsWith('/install/')) {
    const msg = '같은 와이파이 접속이 꺼져 있어요. 이 폰의 감자 콘솔에서 더보기 → 연결 → 외부 접속에서 켜 주세요. (Same-Wi-Fi access is off. Turn it on in the GAMJA console: More > Connections > External access.)';
    // code: 열려 있는 화면이 "접속이 끊겼어요"를 보여 주는 데 쓴다
    if (p.startsWith('/api/')) return send(res, 403, { error: msg, code: 'lan-off' });
    return send(res, 403, LAN_OFF_PAGE, { 'Content-Type': 'text/html; charset=utf-8' });
  }

  try {
    if (p === '/api/login' && req.method === 'POST') {
      if (tooManyAttempts(ip)) return send(res, 429, { error: `비밀번호를 여러 번 틀렸어요. ${waitMinutes(attempts, ip)}분 뒤에 다시 시도해 주세요.` });
      const body = await readBody(req);
      if (!safeEqual(body.password || '', PASSWORD)) {
        attempts.get(ip).push(Date.now());
        return send(res, 401, { error: '비밀번호가 틀렸습니다' });
      }
      attempts.delete(ip);
      const cookie = `${COOKIE}=${makeToken()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${COOKIE_SECURE ? '; Secure' : ''}`;
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookie });
    }
    // 앱 → 브라우저 로그인: 감자 앱이 비밀번호로 한 번만 쓰는 표를 받아 브라우저로 열면, 브라우저가 로그인된 채로 감자 화면을 연다.
    // 이 폰 안(127.0.0.1)의 요청만 받고, 표는 60초 안에 한 번만 쓸 수 있다
    if (p === '/api/login-ticket' && req.method === 'POST') {
      if (!isLocalReq(req)) return send(res, 403, { error: '이 폰 안에서만 쓸 수 있어요' });
      if (tooManyAttempts(ip)) return send(res, 429, { error: '잠시 후 다시 시도해 주세요' });
      const body = await readBody(req);
      if (!safeEqual(body.password || '', PASSWORD)) {
        attempts.get(ip).push(Date.now());
        return send(res, 401, { error: '비밀번호가 틀렸습니다' });
      }
      const now = Date.now();
      for (const [t, exp] of loginTickets) if (exp < now) loginTickets.delete(t);
      if (loginTickets.size > 20) loginTickets.clear();
      const ticket = crypto.randomBytes(24).toString('base64url');
      loginTickets.set(ticket, now + 60e3);
      return send(res, 200, { ticket });
    }
    if (p === '/api/app-login' && req.method === 'GET') {
      const exp = loginTickets.get(url.searchParams.get('t') || '');
      loginTickets.delete(url.searchParams.get('t') || '');
      if (!isLocalReq(req) || !exp || exp < Date.now()) {
        return send(res, 403, '로그인 표가 없거나 만료됐어요. 감자 앱에서 "감자 열기"를 다시 눌러 주세요.', { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      const to = url.searchParams.get('to') || '/';
      const dest = /^\/(?!\/)[^\r\n\\]*$/.test(to) && !to.startsWith('/api/') ? to : '/'; // 이 감자알 안의 화면 주소만
      const cookie = `${COOKIE}=${makeToken()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${COOKIE_SECURE ? '; Secure' : ''}`;
      return send(res, 302, '', { Location: dest, 'Set-Cookie': cookie });
    }
    // 감자 앱의 "감자알 다시 시작": 이 폰 안에서, 비밀번호를 아는 요청만. start.sh 루프 아래에서 돌 때만 다시 켜진다
    if (p === '/api/self-restart' && req.method === 'POST') {
      if (!isLocalReq(req)) return send(res, 403, { error: '이 폰 안에서만 쓸 수 있어요' });
      if (tooManyAttempts(ip)) return send(res, 429, { error: '잠시 후 다시 시도해 주세요' });
      const body = await readBody(req);
      if (!safeEqual(body.password || '', PASSWORD)) {
        attempts.get(ip).push(Date.now());
        return send(res, 401, { error: '비밀번호가 틀렸습니다' });
      }
      if (!SUPERVISED) return send(res, 409, { error: '이 감자알은 스스로 다시 시작할 수 없어요' });
      send(res, 200, { ok: true });
      setTimeout(() => process.exit(0), 300);
      return;
    }
    if (p === '/api/logout' && req.method === 'POST') {
      return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` });
    }
    if (p === '/api/me') {
      const authed = isAuthed(req);
      return send(res, 200, { authed, boot: BOOT_ID, lastUpdate: authed ? recentUpdates().at(-1) || null : null });
    }

    const inst = p.match(/^\/(install|bundle)\/([\w.-]+)$/);
    if (inst && req.method === 'GET') {
      if (!verifyInstallToken(inst[2])) return send(res, 403, 'echo "설치 링크가 만료됐어요. 감자 메뉴에서 새로 만들어 주세요."\n');
      if (inst[1] === 'bundle') return sendBundle(res);
      const host = String(req.headers.host || '');
      if (!/^[\w.:[\]-]+$/.test(host)) return send(res, 400, 'bad host');
      const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      return send(res, 200, installScript(`${proto}://${host}`, inst[2]), { 'Content-Type': 'text/x-shellscript; charset=utf-8' });
    }

    if (p.startsWith('/preview/') && req.method === 'GET') return servePreview(req, res, p);

    if (p.startsWith('/api/')) {
      if (!isAuthed(req)) return send(res, 401, { error: '로그인이 필요합니다' });
      if (p === '/api/preview-files' && req.method === 'GET') {
        const project = url.searchParams.get('project') || '';
        const talk = crewOf(project) === ''; // 감자 톡톡: 결과물 전용 폴더(gamjaTT)
        if (talk) fs.mkdirSync(TALK_DIR, { recursive: true });
        const dir = talk ? TALK_DIR : resolveProject(project);
        const crew = talk ? TALK_DIR_NAME : crewOf(project); // 결과물은 채팅방이 아니라 크루 폴더에 있다
        if (!dir || !crew) return send(res, 400, { error: '크루 방에서 열어 주세요' });
        return send(res, 200, { project: crew, files: listResults(dir), token: makePreviewToken(crew), lan: lanOrigins() });
      }
      if (p === '/api/install-link' && req.method === 'POST') {
        const host = String(req.headers.host || '');
        if (!/^[\w.:[\]-]+$/.test(host)) return send(res, 400, { error: '접속 주소를 알 수 없어요' });
        const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
        return send(res, 200, { command: `pkg install -y curl && curl -fsSL ${proto}://${host}/install/${makeInstallToken()} | bash` });
      }
      if (p === '/api/projects' && req.method === 'GET') {
        return send(res, 200, { root: PROJECTS_DIR, projects: listProjects() });
      }
      if (p === '/api/chats' && req.method === 'GET') {
        // 💬 채팅 목록: 크루마다 마지막 말, 시간, 작업 중 여부, 최근 답변 시각(안 읽음 계산용)을 한 번에 알려 준다
        const rids = [];
        for (const crew of ['', ...listProjects()]) {
          rids.push(crew);
          for (const r of roomFilesOf(crew)) if (r.rid !== crew) rids.push(r.rid); // 같은 크루의 다른 채팅방들
        }
        const chats = rids.map((name) => {
          const conv = loadConv(name);
          const talk = conv.messages.filter((m) => m.role === 'user' || m.role === 'bot' || m.role === 'error');
          const last = talk[talk.length - 1];
          const run = projectRuns.get(name);
          return {
            name,
            extra: name.includes('@'), // 크루의 첫 방이 아닌 방 (만들어진 순간부터 목록에 보인다)
            members: Array.isArray(conv.participants) && conv.participants.length ? conv.participants : [crewOf(name)], // 참여자(크루) 목록
            ts: last ? last.ts : 0,
            last: last ? { role: last.role, text: String(last.text || '').slice(0, 160) } : null,
            running: !!run,
            status: run && run.live && run.live.status ? String(run.live.status).slice(0, 60) : '',
            botTs: conv.messages.filter((m) => m.role === 'bot' && m.ts).slice(-9).map((m) => m.ts),
          };
        });
        // 삭제한 크루는 채팅 목록에 방으로 남기지 않는다. 크루 탭의 "삭제한 크루 복구하기"(/api/trash)에서 복구하거나 완전히 지운다
        return send(res, 200, { chats, seen: seenMap, ui: uiState });
      }
      // 기기 간 공유 화면 정보 올리기: 항목마다 더 늦은 시각이 이긴다
      if (p === '/api/ui-state' && req.method === 'POST') {
        const b = await readBody(req);
        let changed = false;
        for (const c of (Array.isArray(b.changes) ? b.changes : []).slice(0, 300)) {
          if (!c || !UI_MAPS.has(c.map) || typeof c.key !== 'string' || c.key.length > 200 || typeof c.ts !== 'number' || !Number.isFinite(c.ts)) continue;
          if (c.v !== null && JSON.stringify(c.v === undefined ? null : c.v).length > 8000) continue; // 너무 큰 값은 받지 않는다
          const m = uiState[c.map] || (uiState[c.map] = {});
          if (c.ts > ((m[c.key] && m[c.key].ts) || 0)) { m[c.key] = { v: c.v === undefined ? null : c.v, ts: c.ts }; changed = true; }
        }
        if (changed) saveUi();
        return send(res, 200, { ui: uiState });
      }
      // 🔐 막힌 명령 허용 (카드의 버튼): 감자알이 기록해 둔 막힌 명령의 id로만 허용할 수 있다
      if (p === '/api/perm/answer' && req.method === 'POST') {
        const b = await readBody(req);
        const project = String(b.project || '');
        if (!resolveProject(project)) return send(res, 400, { error: '알 수 없는 프로젝트' });
        const mode = String(b.mode || '');
        if (!['once', 'always', 'no'].includes(mode)) return send(res, 400, { error: '알 수 없는 선택이에요.' });
        const conv = loadConv(project);
        let entry = null;
        for (const m of conv.messages.slice(-60).reverse()) {
          entry = (m.denied || []).find((d) => d.id === String(b.id || ''));
          if (entry) break;
        }
        if (!entry) return send(res, 404, { error: '그 요청을 찾을 수 없어요. (이미 처리했거나 오래된 요청이에요)' });
        if (mode !== 'no') {
          const c = classifyCommand(entry.cmd); // 허용하는 순간에 한 번 더 살핀다
          if (mode === 'once' ? !c.once : !c.always) return send(res, 403, { error: '이 명령은 이 방식으로 허용할 수 없어요.' });
          const crew = crewOf(project);
          if (mode === 'always') {
            const list = perms[crew] || (perms[crew] = []);
            if (!list.some((x) => x.rule === c.rule)) {
              if (list.length >= PERM_MAX_RULES) return send(res, 400, { error: '허용한 명령이 너무 많아요. 더보기 → 허용한 명령에서 안 쓰는 것을 지워 주세요.' });
              list.push({ rule: c.rule, cmd: entry.cmd, ts: Date.now() });
              savePerms();
            }
          } else permOnce.set(crew, { rules: [c.onceRule], until: Date.now() + 10 * 60e3 });
        }
        entry.answered = mode;
        saveConv(project);
        return send(res, 200, { ok: true });
      }
      if (p === '/api/perm' && req.method === 'GET') {
        return send(res, 200, { rules: Object.entries(perms).flatMap(([crew, list]) => list.map((x) => ({ crew, rule: x.rule, cmd: x.cmd, ts: x.ts }))) });
      }
      if (p === '/api/perm/remove' && req.method === 'POST') {
        const b = await readBody(req);
        const crew = String(b.crew ?? '');
        if (perms[crew]) {
          perms[crew] = perms[crew].filter((x) => x.rule !== String(b.rule || ''));
          if (!perms[crew].length) delete perms[crew];
          savePerms();
        }
        return send(res, 200, { ok: true });
      }
      // 읽음 기록 공유: 방마다 "마지막으로 읽은 답의 시각"을 모든 기기가 같이 쓴다 (더 늦은 시각만 남긴다)
      if (p === '/api/seen' && req.method === 'POST') {
        const b = await readBody(req);
        let changed = false;
        for (const [room, ts] of Object.entries(b.seen && typeof b.seen === 'object' ? b.seen : {}).slice(0, 200)) {
          if (typeof ts !== 'number' || !Number.isFinite(ts) || room.length > 200) continue;
          if (ts > (seenMap[room] || 0)) { seenMap[room] = ts; changed = true; }
        }
        if (changed) saveSeen();
        return send(res, 200, { seen: seenMap });
      }
      // 삭제한 크루 목록 (크루 탭의 "삭제한 크루 복구하기"): 같은 때 지워진 한 크루가 한 줄. 30일 안에 복구할 수 있다
      if (p === '/api/trash' && req.method === 'GET') {
        const found = new Map();
        let files = [];
        try { files = fs.readdirSync(ARCHIVE_DIR); } catch { files = []; }
        for (const f of files) {
          const m = /^(\d{4})-(\d\d)-(\d\d)-(\d\d)-(\d\d)-(\d\d)__(.+)\.json$/.exec(f);
          if (!m) continue;
          let rid;
          try { rid = decodeURIComponent(m[7]); } catch { continue; }
          const crew = crewOf(rid);
          if (!crew) continue; // 크루 없이 있던 방은 되살릴 크루가 없다
          const stamp = f.slice(0, 19);
          let conv = {};
          try { conv = JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, f), 'utf8')); } catch { /* 깨진 기록은 대화 0개로 */ }
          const key = `${stamp}|${crew}`;
          const e = found.get(key) || {
            id: '', crew, deletedAt: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime(), messages: 0,
            hasFolder: fs.existsSync(path.join(PROJECTS_DIR, '.trash', `${crew}_${stamp}`)),
          };
          e.messages += (conv.messages || []).filter((x) => x.role === 'user' || x.role === 'bot').length;
          if (!e.id || rid === crew) e.id = f.slice(0, -5);
          found.set(key, e);
        }
        const items = [...found.values()].filter((e) => e.hasFolder).sort((a, b) => b.deletedAt - a.deletedAt);
        return send(res, 200, { items });
      }
      // 삭제한 크루를 지금 완전히 지운다 (휴지통 폴더와 보관된 대화). 되돌릴 수 없다
      if (p === '/api/trash/purge' && req.method === 'POST') {
        const m = /^(\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d)__([\w.%-]+)$/.exec(String((await readBody(req)).id || ''));
        if (!m) return send(res, 400, { error: '알 수 없는 항목이에요.' });
        let rid;
        try { rid = decodeURIComponent(m[2]); } catch { return send(res, 400, { error: '알 수 없는 항목이에요.' }); }
        const crew = crewOf(rid);
        if (!isProjectName(crew)) return send(res, 400, { error: '알 수 없는 항목이에요.' });
        let files = [];
        try { files = fs.readdirSync(ARCHIVE_DIR); } catch { files = []; }
        for (const f of files) {
          const mm = /^(.+?)__(.+)\.(json|conf)$/.exec(f);
          if (!mm || mm[1] !== m[1]) continue;
          let r2;
          try { r2 = decodeURIComponent(mm[2]); } catch { continue; }
          if (crewOf(r2) === crew) fs.rmSync(path.join(ARCHIVE_DIR, f), { force: true });
        }
        const trashRoot = path.join(PROJECTS_DIR, '.trash');
        const dir = path.join(trashRoot, `${crew}_${m[1]}`);
        if (path.dirname(dir) === trashRoot && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
        return send(res, 200, { ok: true });
      }
      if ((p === '/api/archive/delete' || p === '/api/archive/restore') && req.method === 'POST') {
        const readBodyOnce = await readBody(req);
        const id = String(readBodyOnce.id || '');
        const file = path.join(ARCHIVE_DIR, `${id}.json`);
        if (!/^[\w.%-]+__[\w.%-]+$/.test(id) || path.dirname(file) !== ARCHIVE_DIR || !fs.existsSync(file)) return send(res, 404, { error: '그 대화를 찾을 수 없어요.' });
        if (p === '/api/archive/delete') { fs.rmSync(file, { force: true }); return send(res, 200, { ok: true }); }
        // 복구: 휴지통의 크루 폴더와, 그 크루가 지워질 때 함께 보관된 모든 채팅방 대화·모델 설정을 되돌린다.
        // 같은 이름의 크루가 이미 있으면 newName(새 이름)으로 복구한다
        const b = await readBodyOnce;
        let rid;
        try { rid = decodeURIComponent(id.slice(id.indexOf('__') + 2)); } catch { rid = ''; }
        const crew = crewOf(rid);
        const stamp = id.slice(0, id.indexOf('__'));
        if (!isProjectName(crew)) return send(res, 400, { error: '크루 이름을 알 수 없어요.' });
        const newName = b.newName === undefined || String(b.newName) === '' ? crew : String(b.newName);
        if (!isProjectName(newName)) return send(res, 400, { error: '이름은 영문·숫자·한글·-·_ 로 40자까지 쓸 수 있어요.' });
        if (isReservedCrewName(newName)) return send(res, 400, { error: '감자가 쓰는 이름이라 크루 이름으로 쓸 수 없어요.' });
        const trashDir = path.join(PROJECTS_DIR, '.trash', `${crew}_${stamp}`);
        const dest = path.join(PROJECTS_DIR, newName);
        if (fs.existsSync(dest)) return send(res, 409, { error: `같은 이름('${newName}')의 크루가 이미 있어요.` });
        if (!fs.existsSync(trashDir)) return send(res, 404, { error: '휴지통에서 크루 폴더를 찾지 못했어요. (30일이 지나면 완전히 지워져요)' });
        fs.renameSync(trashDir, dest);
        fs.mkdirSync(CONV_DIR, { recursive: true });
        const rooms = [];
        for (const f of fs.readdirSync(ARCHIVE_DIR)) {
          const m = /^(.+?)__(.+)\.json$/.exec(f);
          if (!m || m[1] !== stamp) continue;
          let r;
          try { r = decodeURIComponent(m[2]); } catch { continue; }
          if (crewOf(r) !== crew) continue;
          const to = newName + r.slice(crew.length);
          fs.rmSync(convFile(to), { force: true });
          fs.renameSync(path.join(ARCHIVE_DIR, f), convFile(to));
          convCache.delete(to);
          rooms.push({ id: f.slice(0, -5), from: r, to });
        }
        const confFile = path.join(ARCHIVE_DIR, `${stamp}__${encodeURIComponent(crew)}.conf`);
        try { projectConf[newName] = JSON.parse(fs.readFileSync(confFile, 'utf8')); saveProjectConf(); } catch { /* 보관한 설정이 없으면 기본값 */ }
        fs.rmSync(confFile, { force: true });
        return send(res, 200, { project: newName, rooms });
      }
      // 같은 크루의 새 채팅방 만들기 / 크루의 첫 방이 아닌 방 지우기
      if (p === '/api/rooms' && req.method === 'POST') {
        // 채팅방은 참여자(크루) 목록을 가진다. 둘 이상이면 그룹 채팅 (handleGroupChat)
        const body = await readBody(req);
        const crews = Array.isArray(body.crews) ? body.crews.map(String) : [String(body.crew ?? '')];
        if (!crews.length) return send(res, 400, { error: '참여할 크루를 골라 주세요.' });
        if (crews.length > 1 && !GROUP_CHAT_ENABLED) return send(res, 400, { error: '그룹 채팅은 준비 중이에요.' });
        if (crews.length > MAX_ROOM_MEMBERS) return send(res, 400, { error: `한 방에는 크루를 ${MAX_ROOM_MEMBERS}명까지 넣을 수 있어요.` });
        if (new Set(crews).size !== crews.length || crews.some((c) => c.includes('@') || !resolveProject(c))) return send(res, 400, { error: '알 수 없는 크루' });
        // 한 명이면 그 크루의 방, 여러 명이면 어느 크루에도 속하지 않는 그룹 방이다 (참여한 크루 하나를 지워도 방은 그대로 남는다)
        const crew = crews.length === 1 ? crews[0] : '';
        const rid = `${crew}@${Math.random().toString(36).slice(2, 7).padEnd(5, '0')}`;
        const conv = loadConv(rid);
        conv.participants = crews;
        saveConv(rid); // 빈 대화 파일이 곧 방이다
        return send(res, 200, { room: rid, members: crews });
      }
      // 채팅방 참여자 초대·내보내기 (첫 방이 아닌 방에서만). 둘 이상이면 그룹 채팅이 된다. 그룹 방은 크루가 두 명 이상 남아 있어야 한다
      if (p === '/api/rooms/members' && req.method === 'POST') {
        if (!GROUP_CHAT_ENABLED) return send(res, 400, { error: '그룹 채팅은 준비 중이에요.' });
        const b = await readBody(req);
        const room = String(b.room || '');
        if (!room.includes('@') || !resolveProject(room)) return send(res, 400, { error: '첫 방에는 참여자를 초대할 수 없어요. 새 채팅방을 만들어 주세요.' });
        if (projectRuns.has(room)) return send(res, 409, { error: '응답이 진행 중이에요. 끝난 뒤에 해 주세요.' });
        const names = b.names && typeof b.names === 'object' ? b.names : {};
        const label = (c) => String(names[c] || (c === '' ? '감자 톡톡' : c)).slice(0, 40);
        const conv = loadConv(room);
        let members = Array.isArray(conv.participants) && conv.participants.length ? conv.participants.slice() : [crewOf(room)];
        const notes = [];
        for (const c of Array.isArray(b.add) ? b.add.map(String) : []) {
          if (c.includes('@') || !resolveProject(c)) return send(res, 400, { error: '알 수 없는 크루' });
          if (!members.includes(c)) { members.push(c); notes.push(`${label(c)} 님이 참여했어요`); }
        }
        if (members.length > MAX_ROOM_MEMBERS) return send(res, 400, { error: `한 방에는 크루를 ${MAX_ROOM_MEMBERS}명까지 넣을 수 있어요.` });
        if (b.remove !== undefined) {
          const c = String(b.remove);
          if (!members.includes(c)) return send(res, 404, { error: '이 방의 참여자가 아니에요.' });
          if (members.length < 3) return send(res, 400, { error: '그룹 방에는 크루가 두 명 이상 있어야 해요.' });
          members = members.filter((x) => x !== c);
          notes.push(`${label(c)} 님이 나갔어요`);
        }
        conv.participants = members;
        for (const t of notes) conv.messages.push({ role: 'notice', text: t, ts: Date.now() });
        saveConv(room);
        return send(res, 200, { members });
      }
      if (p === '/api/rooms/delete' && req.method === 'POST') {
        const room = String((await readBody(req)).room || '');
        if (!room.includes('@') || !resolveProject(room)) return send(res, 400, { error: '지울 수 없는 방이에요.' });
        if (projectRuns.has(room)) return send(res, 409, { error: '응답이 진행 중이에요. 끝난 뒤에 지워 주세요.' });
        fs.rmSync(convFile(room), { force: true });
        convCache.delete(room);
        return send(res, 200, { ok: true });
      }
      if (p === '/api/history' && req.method === 'GET' && url.searchParams.get('archive')) {
        // 삭제된 크루의 남은 대화 (읽기 전용 채팅방)
        const id = url.searchParams.get('archive');
        const file = path.join(ARCHIVE_DIR, `${id}.json`);
        if (!/^[\w.%-]+__[\w.%-]+$/.test(id) || path.dirname(file) !== ARCHIVE_DIR || !fs.existsSync(file)) return send(res, 404, { error: '그 대화를 찾을 수 없어요.' });
        let conv = { messages: [] };
        try { conv = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* 깨진 기록은 빈 대화로 */ }
        return send(res, 200, { sessionId: null, messages: conv.messages || [], running: false, runId: null, live: null, archived: true });
      }
      if (p === '/api/history' && req.method === 'GET') {
        const project = url.searchParams.get('project') || '';
        if (!resolveProject(project)) return send(res, 400, { error: '알 수 없는 프로젝트' });
        const conv = loadConv(project);
        const run = projectRuns.get(project);
        // tail=N: 긴 방은 최근 N개만 보낸다 (처음 열 때 수백 KB를 받지 않도록). 화면의 "이전 대화 불러오기"가 tail 없이 다시 받아 간다
        const tail = Math.max(0, Math.min(2000, Number(url.searchParams.get('tail')) || 0));
        const partial = tail > 0 && conv.messages.length > tail;
        // 기록이 화면이 이미 가진 것과 같으면(rev가 같으면) 대화 전체를 다시 보내지 않는다. 긴 방에서 답을 기다리는 동안 1.5초마다 수백 KB를 주고받아 느려지던 것을 막는다
        const rev = `${conv.updatedAt || 0}:${conv.messages.length}:${Object.keys(TOOLKITS).filter((k) => kitInstalled(k)).join(',')}:${partial ? 't' + tail : 'all'}`;
        const same = url.searchParams.get('rev') === rev;
        // 이미 설치된 도구의 "설치" 버튼은 보여 주지 않는다
        const messages = same ? undefined : (partial ? conv.messages.slice(-tail) : conv.messages)
          .map((m) => (m.install ? { ...m, install: m.install.filter((k) => TOOLKITS[k.id] && !kitInstalled(k.id)) } : m));
        return send(res, 200, {
          sessionId: conv.sessionId,
          rev,
          same,
          partial,
          hiddenCount: partial ? conv.messages.length - tail : 0,
          messages,
          running: !!run,
          runId: run ? run.runId : null,
          live: run ? run.live : null,
        });
      }
      if (p === '/api/upload' && req.method === 'POST') {
        const cwd = resolveProject(url.searchParams.get('project') || '');
        if (!cwd) return send(res, 400, { error: '알 수 없는 프로젝트' });
        const ext = IMAGE_TYPES[String(req.headers['content-type'] || '').split(';')[0].trim()];
        if (!ext) return send(res, 400, { error: '이미지 파일만 첨부할 수 있어요' });
        const data = await readRaw(req, 10e6);
        if (!data.length) return send(res, 400, { error: '빈 파일이에요' });
        const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
        fs.writeFileSync(path.join(uploadDir(cwd), name), data);
        return send(res, 200, { name });
      }
      if (p === '/api/uploads' && req.method === 'GET') {
        const cwd = resolveProject(url.searchParams.get('project') || '');
        const name = url.searchParams.get('name');
        if (!cwd || !isUploadName(name)) return send(res, 400, { error: '잘못된 요청' });
        const file = path.join(cwd, UPLOAD_DIR, name);
        return fs.readFile(file, (err, data) => {
          if (err) return send(res, 404, { error: '이미지가 없어요' });
          const type = Object.keys(IMAGE_TYPES).find((t) => IMAGE_TYPES[t] === path.extname(name).slice(1));
          res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=31536000, immutable' });
          res.end(data);
        });
      }
      if (p === '/api/projects' && req.method === 'POST') {
        // 새 프로젝트 만들기
        const { name } = await readBody(req);
        if (!isProjectName(name)) return send(res, 400, { error: '이름은 영문·숫자·한글·-·_ 로 40자까지 쓸 수 있어요.' });
        if (isReservedCrewName(name)) return send(res, 400, { error: '감자가 쓰는 이름이라 크루 이름으로 쓸 수 없어요.' });
        const dir = path.join(PROJECTS_DIR, name);
        if (fs.existsSync(dir)) return send(res, 409, { error: '같은 이름의 프로젝트가 이미 있어요.' });
        fs.mkdirSync(dir, { recursive: true });
        return send(res, 200, { project: name });
      }
      if (p === '/api/project-settings' && req.method === 'GET') {
        const project = url.searchParams.get('project') || '';
        const dir = resolveCrew(project);
        if (!dir) return send(res, 400, { error: '알 수 없는 프로젝트' });
        let instructions = '';
        try { instructions = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'); } catch {}
        return send(res, 200, {
          project, instructions, model: projectConf[project]?.model || '', models: MODELS,
          effort: projectConf[project]?.effort || '',
          locked: !project || holdsApp(dir), // 루트·GAMJA 폴더는 이름 바꾸기·삭제 불가
        });
      }
      if (p === '/api/project-settings' && req.method === 'POST') {
        const b = await readBody(req);
        const project = String(b.project || '');
        const dir = resolveCrew(project);
        if (!dir) return send(res, 400, { error: '알 수 없는 프로젝트' });
        const model = String(b.model || '');
        if (!MODELS.includes(model)) return send(res, 400, { error: '알 수 없는 모델' });
        const effort = String(b.effort || '');
        if (!EFFORTS.includes(effort)) return send(res, 400, { error: '알 수 없는 생각 깊이' });
        // 프로젝트 지침 = 그 폴더의 CLAUDE.md (Claude Code가 자동으로 읽음). 비우면 파일을 지운다
        const md = path.join(dir, 'CLAUDE.md');
        const text = String(b.instructions || '').slice(0, 50000);
        if (text.trim()) fs.writeFileSync(md, text.endsWith('\n') ? text : text + '\n');
        else fs.rmSync(md, { force: true });
        if (model) projectConf[project] = { ...projectConf[project], model };
        else if (projectConf[project]) delete projectConf[project].model;
        if (effort) projectConf[project] = { ...projectConf[project], effort };
        else if (projectConf[project]) delete projectConf[project].effort;
        saveProjectConf();
        return send(res, 200, { ok: true });
      }
      if ((p === '/api/projects/rename' || p === '/api/projects/delete') && req.method === 'POST') {
        const b = await readBody(req);
        const project = String(b.project || '');
        const dir = resolveCrew(project);
        if (!project || !dir) return send(res, 400, { error: '이 프로젝트는 바꿀 수 없어요.' });
        if (holdsApp(dir)) return send(res, 400, { error: 'GAMJA 앱이 들어 있는 폴더라 이름을 바꾸거나 지울 수 없어요.' });
        if ([...projectRuns.keys()].some((k) => crewOf(k) === project)) return send(res, 409, { error: '응답이 진행 중이에요. 끝난 뒤에 해 주세요.' });
        const rooms = roomFilesOf(project); // 이 크루의 모든 채팅방 (첫 방 + 다른 방들)
        if (p === '/api/projects/rename') {
          const newName = String(b.newName || '');
          if (!isProjectName(newName)) return send(res, 400, { error: '이름은 영문·숫자·한글·-·_ 로 40자까지 쓸 수 있어요.' });
          if (isReservedCrewName(newName)) return send(res, 400, { error: '감자가 쓰는 이름이라 크루 이름으로 쓸 수 없어요.' });
          const newDir = path.join(PROJECTS_DIR, newName);
          if (fs.existsSync(newDir)) return send(res, 409, { error: '같은 이름의 프로젝트가 이미 있어요.' });
          fs.renameSync(dir, newDir);
          for (const r of rooms) { // 대화 기록도 함께
            fs.renameSync(r.file, convFile(newName + r.rid.slice(project.length)));
            convCache.delete(r.rid);
          }
          if (projectConf[project]) { projectConf[newName] = projectConf[project]; delete projectConf[project]; saveProjectConf(); }
          return send(res, 200, { project: newName });
        }
        // 삭제: 바로 지우지 않고 휴지통(~/projects/.trash)으로 옮긴다
        const trash = path.join(PROJECTS_DIR, '.trash');
        const stamp = new Date().toLocaleString('sv-SE').replace(/[: ]/g, '-');
        fs.mkdirSync(trash, { recursive: true });
        fs.renameSync(dir, path.join(trash, `${project}_${stamp}`));
        // 대화는 크루와 따로 간다: 크루를 지워도 대화 기록은 남겨 두고, 채팅 목록에서 읽기만 되는 "삭제된 크루" 방으로 보여 준다
        // 첫 방과 다른 방들이 모두 남는다 (30일 안에 복구할 수 있다)
        if (rooms.length) {
          fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
          for (const r of rooms) {
            fs.renameSync(r.file, path.join(ARCHIVE_DIR, `${stamp}__${encodeURIComponent(r.rid)}.json`));
            convCache.delete(r.rid);
          }
          // 크루별 모델·생각 깊이 설정도 같이 보관해 둔다 (복구할 때 되살린다)
          if (projectConf[project]) fs.writeFileSync(path.join(ARCHIVE_DIR, `${stamp}__${encodeURIComponent(project)}.conf`), JSON.stringify(projectConf[project]));
        }
        if (!rooms.length) {
          // 대화가 한 번도 없던 크루도 "삭제한 크루 복구하기"에 나오도록 빈 보관 파일을 남긴다 (복구하는 길잡이)
          fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
          fs.writeFileSync(path.join(ARCHIVE_DIR, `${stamp}__${encodeURIComponent(project)}.json`), JSON.stringify({ messages: [] }));
          if (projectConf[project]) fs.writeFileSync(path.join(ARCHIVE_DIR, `${stamp}__${encodeURIComponent(project)}.conf`), JSON.stringify(projectConf[project]));
        }
        delete projectConf[project];
        saveProjectConf();
        return send(res, 200, { ok: true });
      }
      if (p === '/api/compact' && req.method === 'POST') {
        // 🗜 대화 압축: Claude Code의 /compact 명령으로 오래된 대화를 요약본으로 바꾼다 (화면의 기록은 그대로)
        const { project = '' } = await readBody(req);
        if (!resolveProject(project)) return send(res, 400, { error: '알 수 없는 프로젝트' });
        if (projectRuns.has(project)) return send(res, 409, { error: '응답이 진행 중이에요. 끝난 뒤에 해 주세요.' });
        if (!loadConv(project).sessionId) return send(res, 400, { error: '아직 압축할 대화가 없어요.' });
        handleChat(null, nullRes(), { message: '/compact', project }, { label: '🗜 대화를 압축하는 중... (오래된 대화를 요약본으로 바꿔요)', compact: true });
        return send(res, 200, { ok: true });
      }
      if (p === '/api/tunnel' && req.method === 'GET') {
        if (tunnel.status === 'on' && !pidAlive(tunnel.pid)) stopTunnel(); // 터널이 혼자 꺼졌으면 정리
        return send(res, 200, { ...tunnel, weakPassword: PASSWORD.length < 12, pro: PRO_MODE });
      }
      if (p === '/api/tunnel' && req.method === 'POST') {
        const { on } = await readBody(req);
        if (on && !PRO_MODE) return send(res, 403, { error: '외부 접속 주소는 Pro에서 제공할 예정이에요. (준비 중)' });
        if (on) startTunnel(); else stopTunnel(); // 켜기는 오래 걸리므로 기다리지 않고, 화면이 상태를 따라감
        return send(res, 200, { ...tunnel });
      }
      // 같은 와이파이 접속: 켜면 같은 와이파이의 PC·아이폰·다른 폰이 이 폰의 주소로 접속할 수 있다 (기본 꺼짐)
      if (p === '/api/lan' && req.method === 'GET') {
        return send(res, 200, { enabled: !!settings.lanAccess, addresses: lanOrigins(), pro: PRO_MODE });
      }
      if (p === '/api/lan' && req.method === 'POST') {
        if (!isLocal && !settings.lanAccess) return send(res, 403, { error: '이 폰에서만 바꿀 수 있어요.' });
        const turnOn = !!(await readBody(req)).on;
        settings = { ...settings, lanAccess: turnOn };
        if (!turnOn) settings.remoteRevokedAt = Date.now(); // 끄는 순간 다른 기기의 로그인은 모두 풀린다 (다시 켜면 비밀번호를 새로 입력)
        saveSettings();
        return send(res, 200, { enabled: settings.lanAccess, addresses: lanOrigins() });
      }
      if (p === '/api/settings' && req.method === 'GET') {
        const project = url.searchParams.get('project') || '';
        const conv = resolveProject(project) ? loadConv(project) : null;
        return send(res, 200, {
          settings,
          models: MODELS,
          usage: { conversation: conv?.usage || { in: 0, out: 0 }, today: usage.days[today()] || { in: 0, out: 0 } },
          context: conv?.context ?? null, // 지금 대화 길이(토큰), 0 = 방금 압축함, null = 아직 모름
          info: {
            gamjaVersion: JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version,
            pro: PRO_MODE, // 개발자·Pro 모드인지 (감자알 로그, 외부 접속 주소 같은 개발자용 화면을 보여 준다)
            build: RUNNING_BUILD, // 감자 앱 설치본의 빌드 번호 (개발용은 0)
            updates: recentUpdates().slice(-8).reverse(), // 최근 자동 업데이트 기록 (최신이 먼저)
            local: isLocal, // 이 폰 안에서 연 화면인지 (비밀번호 바꿀 때 현재 비밀번호를 묻지 않음)
            claudeVersion,
            model: lastModel,
            account: claudeAccount(),
          },
        });
      }
      if (p === '/api/github/status' && req.method === 'GET') {
        return send(res, 200, {
          connected: !!gh, login: gh ? gh.login : '', repo: gh ? gh.repo : GH_REPO, lastSync: gh ? gh.lastSync : 0,
          lastCount: gh ? gh.lastCount : 0, lastError: gh ? gh.lastError : '', skipped: gh ? gh.skipped || [] : [], syncing: ghSyncing,
          pending: ghDevice ? { user_code: ghDevice.user_code, verification_uri: ghDevice.verification_uri, expiresAt: ghDevice.expiresAt, error: ghDevice.error } : null,
        });
      }
      if (p === '/api/github/start' && req.method === 'POST') {
        if (gh) return send(res, 409, { error: '이미 연결돼 있어요' });
        try { await ghStart(); } catch (e) { return send(res, 502, { error: e.message }); }
        return send(res, 200, { ok: true });
      }
      if (p === '/api/github/sync' && req.method === 'POST') {
        if (!gh) return send(res, 400, { error: 'GitHub에 연결돼 있지 않아요' });
        githubSync(null, '지금 기록하기');
        return send(res, 200, { ok: true });
      }
      if (p === '/api/github/disconnect' && req.method === 'POST') {
        gh = null; ghDevice = null; saveGh(); // 폰에 저장한 열쇠를 지운다. GitHub 쪽 승인 취소는 github.com/settings/applications 에서
        return send(res, 200, { ok: true });
      }
      if (p === '/api/auto-update' && req.method === 'POST') {
        // 자동 업데이트 켜기·끄기 (끄면 3시간마다 하는 확인만 멈추고, 🔄로 직접 확인하는 것은 그대로 된다)
        const b = await readBody(req);
        settings = { ...settings, autoUpdate: !!b.on };
        saveSettings();
        return send(res, 200, { ok: true, autoUpdate: settings.autoUpdate });
      }
      if (p === '/api/update-check' && req.method === 'POST') {
        // 🔄 감자알 업데이트 지금 확인: 3시간을 기다리지 않고 바로 확인하고, 새 버전이 있으면 받아서 재시작한다
        if (!SUPERVISED || !fs.existsSync(BUILD_FILE)) return send(res, 200, { status: 'off' }); // 개발용 감자알은 자동 업데이트가 꺼져 있다
        if (checkingUpdate) return send(res, 200, { status: 'checking' });
        checkingUpdate = true;
        try { return send(res, 200, { status: await updateOnce() }); }
        catch (e) { return send(res, 200, { status: 'error', error: e.message }); }
        finally { checkingUpdate = false; }
      }
      if (p === '/api/tools' && req.method === 'GET') {
        return send(res, 200, {
          kits: Object.entries(TOOLKITS).map(([id, k]) => ({ id, name: k.name, desc: k.desc, size: k.size, installed: kitInstalled(id) })),
          installing: toolInstall.kit, error: toolInstall.error, log: toolInstall.log.slice(-5),
        });
      }
      if (p === '/api/tools/install' && req.method === 'POST') {
        const { kit } = await readBody(req);
        if (!TOOLKITS[kit]) return send(res, 400, { error: '알 수 없는 도구예요' });
        if (kitInstalled(kit)) return send(res, 200, { ok: true, already: 'installed' });
        if (toolInstall.kit === kit) return send(res, 200, { ok: true, already: 'installing' });
        if (toolInstall.kit) return send(res, 409, { error: '다른 도구를 설치하는 중이에요. 끝난 뒤에 눌러 주세요.' });
        if (projectRuns.size) return send(res, 409, { error: '답변이 진행 중이에요. 끝난 뒤에 설치해 주세요.' });
        installKit(kit);
        return send(res, 200, { ok: true });
      }
      if (p === '/api/password' && req.method === 'POST') {
        // 🔒 로그인 비밀번호 바꾸기: 현재 비밀번호를 확인하고 .env의 APP_PASSWORD 줄만 바꾼 뒤 다시 켠다 (모든 기기가 로그아웃됨)
        const b = await readBody(req);
        // 이 폰 안에서 직접 연 화면(감자 앱 등)은 이미 로그인돼 있고 ⋮ → 다른 기기에서 접속에서 비밀번호를 볼 수 있어서 현재 비밀번호를 묻지 않는다.
        // 그래서 현재 비밀번호를 추측할 일이 없는 이 폰 안의 화면에는 시도 횟수 제한을 걸지 않는다 (다른 곳에서 로그인에 실패한 기록 때문에 막히지 않게)
        if (!isLocal) {
          if (tooManyAttempts(ip, pwAttempts)) return send(res, 429, { error: `현재 비밀번호를 여러 번 틀렸어요. ${waitMinutes(pwAttempts, ip)}분 뒤에 다시 시도해 주세요.` });
          if (!safeEqual(String(b.current || ''), PASSWORD)) {
            recentFails(pwAttempts, ip).push(Date.now());
            return send(res, 403, { error: '현재 비밀번호가 맞지 않아요.' }); // 401은 화면이 로그아웃으로 처리하므로 403
          }
        }
        const next = String(b.next || '');
        // .env는 시작 스크립트가 그대로 읽는 파일이라, 쉘이 특별하게 다루는 글자($ ` ; 따옴표 공백 등)는 받지 않는다
        if (!/^[A-Za-z0-9._@#%+=:,\/^!-]{8,64}$/.test(next)) {
          return send(res, 400, { error: '새 비밀번호는 8~64자이고, 영문·숫자와 . _ - @ # % + = : , / ^ ! 만 쓸 수 있어요.' });
        }
        if (next === PASSWORD) return send(res, 400, { error: '지금 비밀번호와 같아요.' });
        if (projectRuns.size) return send(res, 409, { error: '답변이 진행 중이에요. 끝난 뒤에 바꿔 주세요.' });
        const envFile = path.join(__dirname, '.env');
        if (!fs.existsSync(envFile)) return send(res, 400, { error: '.env 파일 없이 실행 중이라 여기서 바꿀 수 없어요.' });
        const line = `APP_PASSWORD=${next}`;
        const lines = fs.readFileSync(envFile, 'utf8').split('\n');
        let found = false;
        const out = lines.map((l) => (/^APP_PASSWORD=/.test(l) ? ((found = true), line) : l));
        if (!found) { if (out.at(-1) === '') out.splice(out.length - 1, 0, line); else out.push(line); }
        const tmpEnv = envFile + '.tmp';
        fs.writeFileSync(tmpEnv, out.join('\n'), { mode: 0o600 });
        fs.renameSync(tmpEnv, envFile);
        send(res, 200, { ok: true, restarting: SUPERVISED });
        if (SUPERVISED) exitForRestart('', '🔒 비밀번호를 바꿨어요. 모든 기기에서 새 비밀번호로 다시 로그인해 주세요.');
        return;
      }
      if (p === '/api/settings' && req.method === 'POST') {
        const b = await readBody(req);
        const model = String(b.model || '');
        if (!MODELS.includes(model)) return send(res, 400, { error: '알 수 없는 모델' });
        const autocompact = String(b.autocompact || '');
        if (!AUTOCOMPACT.includes(autocompact)) return send(res, 400, { error: '알 수 없는 압축 설정' });
        const effort = String(b.effort || '');
        if (!EFFORTS.includes(effort)) return send(res, 400, { error: '알 수 없는 생각 깊이' });
        settings = {
          ...settings, // 같은 와이파이 접속 같은 다른 설정은 그대로 둔다
          nickname: String(b.nickname || '').trim().slice(0, 30),
          style: String(b.style || '').trim().slice(0, 200),
          model,
          autocompact,
          effort,
        };
        saveSettings();
        return send(res, 200, { ok: true, settings });
      }
      if (p === '/api/events' && req.method === 'GET') {
        // 🔔 감자 앱이 몇 초마다 묻는다: since 이후에 끝난 답변들
        const since = Number(url.searchParams.get('since')) || 0;
        return send(res, 200, { now: Date.now(), events: doneEvents.filter((e) => e.ts > since) });
      }
      if (p === '/api/status' && req.method === 'GET') {
        // 화면이 4초마다 확인하는 가벼운 상태 (새 메시지·진행 중 작업이 생겼는지)
        const project = url.searchParams.get('project') || '';
        if (!resolveProject(project)) return send(res, 400, { error: '알 수 없는 프로젝트' });
        return send(res, 200, { count: loadConv(project).messages.length, running: projectRuns.has(project), boot: BOOT_ID });
      }
      if (p.startsWith('/api/history/') && req.method === 'POST') {
        const body = await readBody(req, 20e6);
        const project = String(body.project || '');
        if (!resolveProject(project)) return send(res, 400, { error: '알 수 없는 프로젝트' });
        if (projectRuns.has(project)) return send(res, 409, { error: '응답이 진행 중이에요. 끝난 뒤에 다시 해 주세요.' });
        const conv = loadConv(project);
        if (p === '/api/history/reset') {
          // 새 대화
          conv.sessionId = null;
          conv.messages = [];
        } else if (p === '/api/history/resume') {
          // 터미널 등에서 시작한 기존 세션 이어가기
          if (!isUuid(body.sessionId)) return send(res, 400, { error: '세션 ID 형식이 아니에요.' });
          conv.sessionId = body.sessionId;
          conv.messages = [{ role: 'notice', text: `🔗 기존 세션을 이어갑니다: ${body.sessionId}\n(이전 메시지는 화면에 없지만 Claude는 맥락을 기억합니다)`, ts: Date.now() }];
        } else if (p === '/api/history/import') {
          // 이전 버전(브라우저 저장) 기록 옮기기: 서버 기록이 비어 있을 때만
          if (!conv.messages.length && !conv.sessionId) {
            conv.messages = (Array.isArray(body.messages) ? body.messages : []).map(cleanMessage).filter(Boolean);
            if (isUuid(body.sessionId)) conv.sessionId = body.sessionId;
          }
        } else {
          return send(res, 404, { error: 'not found' });
        }
        saveConv(project);
        return send(res, 200, { sessionId: conv.sessionId, messages: conv.messages, running: false });
      }
      if (p === '/api/admin/restart' && req.method === 'POST') {
        // 수동 재시작 (검사 후)
        const { project = 'gamja' } = await readBody(req);
        if (!resolveProject(project)) return send(res, 400, { error: '알 수 없는 프로젝트' });
        if (projectRuns.size) return send(res, 409, { error: '응답이 진행 중이에요. 끝난 뒤에 다시 해 주세요.' });
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(RESTART_FLAG, '수동 재시작');
        const r = await restartIfRequested(project, () => {});
        return send(res, 200, { ok: r.status === 'restart' });
      }
      if (p === '/api/admin/rollback' && req.method === 'POST') {
        const { project = 'gamja', force = false } = await readBody(req);
        if (!resolveProject(project)) return send(res, 400, { error: '알 수 없는 프로젝트' });
        if (!SUPERVISED) return send(res, 400, { error: 'start.sh로 실행된 서버에서만 되돌릴 수 있어요.' });
        if (projectRuns.size) {
          // 평소에는 답변이 끝난 뒤에만 되돌린다 (되돌리면 감자알이 다시 켜져서 답변이 끊기므로). 비상일 때는 사용자가 고르면 진행 중인 답변을 모두 멈추고 되돌린다
          if (!force) return send(res, 409, { error: '응답이 진행 중이에요. 끝난 뒤에 다시 해 주세요.' });
          for (const child of running.values()) { child.stoppedByUser = true; try { child.kill('SIGINT'); } catch {} }
          for (let i = 0; i < 40 && projectRuns.size; i++) await new Promise((r) => setTimeout(r, 100)); // 멈추고 지금까지의 글이 기록에 저장되길 잠깐 기다린다
          for (const child of running.values()) { try { child.kill('SIGKILL'); } catch {} }
          for (let i = 0; i < 20 && projectRuns.size; i++) await new Promise((r) => setTimeout(r, 100));
        }
        if (!rollback(project)) return send(res, 400, { error: '되돌릴 이전 버전이 아직 없어요.' });
        return send(res, 200, { ok: true });
      }
      if (p === '/api/chat' && req.method === 'POST') {
        if (restarting) return send(res, 503, { error: '서버가 재시작 중이에요. 잠시 후 다시 보내 주세요.' });
        return handleChat(req, res, await readBody(req));
      }
      if (p === '/api/stop' && req.method === 'POST') {
        const { runId } = await readBody(req);
        const child = running.get(runId);
        if (child) {
          child.stoppedByUser = true;
          child.kill('SIGINT');
          setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 3000);
        }
        return send(res, 200, { ok: !!child });
      }
      return send(res, 404, { error: 'not found' });
    }

    if (req.method === 'GET') return serveStatic(req, res, p);
    send(res, 405, 'method not allowed');
  } catch (e) {
    if (!res.headersSent) send(res, 400, { error: e.message });
    else res.end();
  }
});

// 지운 크루의 폴더(휴지통 ~/projects/.trash)와 남겨 둔 대화(보관함)는 30일이 지나면 완전히 지운다.
// 지운 때는 이름 끝의 "YYYY-MM-DD-HH-MM-SS"로 안다. 이 모양이 아닌 파일은 건드리지 않는다
const TRASH_DAYS = 30;
function purgeTrash() {
  const limit = Date.now() - TRASH_DAYS * 86400000;
  const stampTime = (s) => {
    const m = /(\d{4})-(\d\d)-(\d\d)-(\d\d)-(\d\d)-(\d\d)/.exec(s);
    return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : 0;
  };
  const sweep = (dir, pick) => {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names) {
      const t = pick(n);
      if (t && t < limit) { try { fs.rmSync(path.join(dir, n), { recursive: true, force: true }); } catch { /* 못 지우면 다음에 다시 */ } }
    }
  };
  sweep(path.join(PROJECTS_DIR, '.trash'), (n) => {
    const m = /_(\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d)(\.conversation\.json)?$/.exec(n);
    return m ? stampTime(m[1]) : 0;
  });
  sweep(ARCHIVE_DIR, (n) => (/^\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d__/.test(n) ? stampTime(n) : 0));
}

// 예전에 설치한 폰(.env에 PORT=3000)은 26514로 옮긴다: .env의 PORT 줄만 바꾸고 끝내면, start.sh 루프가 3초 뒤 새 포트로 다시 띄운다 (앱도 .env를 읽어서 같은 포트로 붙는다)
if (PORT === 3000 && SUPERVISED) {
  try {
    const envPath = path.join(__dirname, '.env');
    const before = fs.readFileSync(envPath, 'utf8');
    const after = before.replace(/^PORT=3000[ \t\r]*$/m, 'PORT=26514');
    if (after !== before) {
      fs.writeFileSync(envPath + '.tmp', after, { mode: 0o600 });
      fs.renameSync(envPath + '.tmp', envPath);
      console.log('포트를 3000에서 26514로 옮겨요. 곧 다시 시작해요.');
      process.exit(0);
    }
  } catch (e) { console.error(`포트 옮기기에 실패했어요(3000 그대로 쓰고 26514도 함께 열어요): ${e.message}`); }
}
// 옮기지 못한 경우를 위해: 3000으로 떠 있으면 26514도 같이 연다
if (PORT === 3000) {
  const alt = http.createServer(server.listeners('request')[0]);
  alt.on('error', (e) => console.error(`보조 포트 26514를 열지 못했어요: ${e.message}`));
  alt.listen(26514, HOST);
}

server.listen(PORT, HOST, () => {
  console.log(`Claude Chat: http://${HOST}:${PORT}  (projects: ${PROJECTS_DIR}, code ${RUNNING_HASH})`);
  purgeTrash();
  setInterval(purgeTrash, 6 * 3600 * 1000).unref();
  // 재시작/복구 결과를 채팅에 알림
  let pending = null;
  try { pending = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8')); } catch {}
  fs.rmSync(PENDING_FILE, { force: true });
  const project = pending && resolveProject(pending.project) ? pending.project : 'gamja';
  const depth = pending ? (pending.depth || 0) + 1 : 1;
  if (fs.existsSync(ROLLBACK_NOTE)) {
    fs.rmSync(ROLLBACK_NOTE, { force: true });
    if (resolveProject(project)) {
      addNotice(project, '⚠️ 새 코드로 띄운 서버가 계속 죽어서, 마지막으로 잘 돌던 버전으로 자동 복구했어요.');
      // 알림과 같은 순간에 실행을 등록해야, 화면이 언제 기록을 읽어도 "진행 중"으로 보인다
      runAuto(project, AUTO_MSG.rolledBack(), depth, '🤖 복구 사실을 Claude에게 전달했어요. 원인을 살피는 중...');
    }
  } else if (pending && pending.update) {
    recordUpdate(pending.update); // 자동 업데이트는 대화에 안내를 남기지 않고, 화면의 짧은 알림과 설정의 업데이트 기록으로 알린다
  } else if (pending && resolveProject(project)) {
    addNotice(project, `${pending.text} (코드 ${RUNNING_HASH})`);
    // Claude가 직접 "반영 완료"를 보고하도록 결과를 전달
    if (pending.followUp) runAuto(project, AUTO_MSG.restarted(RUNNING_HASH), depth, '🤖 Claude가 반영 결과를 확인하는 중...');
  }
  setTimeout(saveStableVersion, 30000).unref();
  startAutoUpdate();
  setTimeout(prepareDefaultKits, 90 * 1000).unref(); // 시작하고 1분 반쯤 뒤, 그리고 답변이 없을 때마다 조용히 확인
  setInterval(prepareDefaultKits, 15 * 60 * 1000).unref();
  readClaudeInfo();
  loadProjectConf();
  loadTunnelState(); // 재시작 전에 켜 둔 터널이 아직 살아 있으면 그 주소를 그대로 쓴다
});

function shutdown() {
  for (const c of running.values()) c.kill('SIGINT');
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
