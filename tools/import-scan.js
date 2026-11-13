'use strict';
// 채팅 zip 가져오기 검사용 순수 함수 모음 (서버 상태를 쓰지 않는다. 2단계)
// 이름 정규화, 풀지 않을 파일 판정, 스크립트·실행 표시, 숨은 글자 제거, 지침 경고

// 눈에 안 보이는 글자 (숨은 지시에 쓰일 수 있음). public/app.js의 HIDDEN_CHARS와 같은 범위
const HIDDEN_CHARS = /[​-‏‪-‮⁠-⁤﻿]/g;

const MAX_NAME_LEN = 255; // 경로 전체
const MAX_COMPONENT_LEN = 120; // 폴더·파일 이름 하나
const MAX_DEPTH = 16; // 폴더 깊이

// 경로 한 칸을 비교용으로 정규화: 호환 문자 통일(NFKC), 숨은 글자 제거, 끝의 점과 공백 제거, 소문자
function normComponent(c) {
  return String(c).normalize('NFKC').replace(HIDDEN_CHARS, '').replace(/[. ]+$/, '').toLowerCase();
}

// 풀지 않는 이름 (어느 깊이든, 대소문자 구분 없이). 걸리면 코드, 아니면 null
const RISKY_NAMES = new Map([
  ['claude.md', 'claude-md'], ['claude.local.md', 'claude-md'],
  ['.mcp.json', 'mcp'], ['.claude.json', 'claude-config'],
  ['.gitmodules', 'git'], ['.envrc', 'env'], ['.gamja-uploads', 'gamja'],
]);
function riskyReason(rel, secretRe) {
  const parts = String(rel).split('/');
  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i];
    const n = normComponent(raw);
    if (n === '.claude') return 'claude-dir';
    if (n === '.git') return 'git';
    if (RISKY_NAMES.has(n)) return RISKY_NAMES.get(n);
    if (/^\.env($|\.)/.test(n)) return 'env';
    // 비밀 이름 패턴은 폴더 이름과 파일 이름 모두에 적용한다
    if (secretRe && (secretRe.test(raw) || secretRe.test(n))) return 'secret';
  }
  return null;
}

const SCRIPT_EXT = new Set(['.sh', '.bash', '.zsh', '.fish', '.py', '.js', '.mjs', '.cjs', '.ts', '.bat', '.cmd', '.ps1', '.command', '.rb', '.pl', '.php', '.vbs', '.lua']);
const SCRIPT_NAMES = new Set(['package.json', 'makefile', 'dockerfile', 'justfile', 'rakefile']);
function scriptFlag(rel) {
  const base = String(rel).split('/').pop().toLowerCase();
  if (SCRIPT_NAMES.has(base)) return true;
  const dot = base.lastIndexOf('.');
  return dot > 0 && SCRIPT_EXT.has(base.slice(dot));
}

// 이름이 안전한지: 길이, 깊이, 제어 문자. 문제가 있으면 코드, 아니면 null
function nameProblem(rel) {
  if (rel.length > MAX_NAME_LEN) return 'name-too-long';
  const parts = rel.split('/');
  if (parts.length > MAX_DEPTH + 1) return 'too-deep'; // 파일 이름 칸은 깊이에 세지 않는다
  for (const p of parts) {
    if (p.length > MAX_COMPONENT_LEN) return 'name-too-long';
    if (/[\u0000-\u001f\u007f-\u009f]/.test(p)) return 'control-char';
    if (p.replace(HIDDEN_CHARS, '') !== p) return 'control-char';
  }
  return null;
}

// 비교용 키 (대소문자만 다른 중복, 같아 보이는 글자 중복을 잡는다)
const dupKey = (rel) => String(rel).split('/').map(normComponent).join('/');

// zip 목차의 만든 곳(상위 바이트)과 외부 속성에서 유닉스 모드를 읽는다
function unixMode(madeBy, externalAttr) {
  if ((madeBy >> 8) !== 3) return null; // 유닉스가 아니면 모드 정보 없음
  return (externalAttr >>> 16) & 0xffff;
}
const isSymlinkMode = (mode) => mode !== null && (mode & 0o170000) === 0o120000;
const isExecMode = (mode) => mode !== null && (mode & 0o111) !== 0 && (mode & 0o170000) !== 0o040000;

const WATCH_TERMS = ['비밀번호', '패스워드', 'password', 'api key', 'api_key', 'apikey', '토큰', 'token', 'secret', '시크릿', '.env',
  'ssh', 'curl', 'wget', 'sudo', 'rm -', 'base64', 'http://', 'https://', '업로드', '전송'];
const KEY_LIKE = /(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/g;
const URL_RE = /https?:\/\/[^\s)\]"'<]+/gi;

// 지침 글에서 숨은 글자를 지우고 경고를 모은다
function reviewInstructions(raw) {
  const text = String(raw || '').slice(0, 50000);
  const clean = text.replace(HIDDEN_CHARS, '');
  const low = clean.toLowerCase();
  const urls = [...new Set(clean.match(URL_RE) || [])].slice(0, 10).map((u) => u.slice(0, 200));
  const keys = [...new Set(clean.match(KEY_LIKE) || [])].slice(0, 5).map((k) => k.slice(0, 6) + '...'); // 값 전체는 보여 주지 않는다
  return { text: clean, hiddenRemoved: text.length - clean.length, terms: WATCH_TERMS.filter((t) => low.includes(t)), urls, keyLike: keys };
}

// 화면에 보일 이름, 아이콘 등: 문자열만, 길이 제한, 숨은 글자와 제어 문자 제거
function cleanMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const limits = { name: 40, icon: 8, blurb: 200, author: 30 };
  const out = {};
  const clean = (v, n) => String(v).replace(HIDDEN_CHARS, '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, n).trim();
  for (const [k, n] of Object.entries(limits)) if (typeof meta[k] === 'string') { const v = clean(meta[k], n); if (v) out[k] = v; }
  if (Array.isArray(meta.examples)) out.examples = meta.examples.filter((x) => typeof x === 'string').slice(0, 5).map((x) => clean(x, 120)).filter(Boolean);
  return Object.keys(out).length ? out : null;
}

module.exports = { HIDDEN_CHARS, MAX_NAME_LEN, MAX_COMPONENT_LEN, MAX_DEPTH, normComponent, riskyReason, scriptFlag, nameProblem, dupKey, unixMode, isSymlinkMode, isExecMode, reviewInstructions, cleanMeta, WATCH_TERMS };
