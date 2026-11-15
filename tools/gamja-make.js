#!/usr/bin/env node
// gamja-make: 크루(Claude)가 문서·그림·영상·소리 파일을 만들 때 쓰는 한 가지 명령.
// 안전 규칙: ① 이 크루 폴더(현재 폴더) 안의 파일만 읽고 쓴다 ② 정해 둔 프로그램을 정해 둔 방법으로만 부른다 (쉘을 쓰지 않는다) ③ 점(.)으로 시작하는 파일은 다루지 않는다.
// 의존성 없음 (Node 기본 기능만). 필요한 프로그램(pandoc, rsvg-convert, ffmpeg, python3)은 감자의 "도구 상자"에서 설치한다.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CWD = process.cwd();
function die(msg) { console.error(`오류: ${msg}`); process.exit(1); }

// 이 크루 폴더 안의 파일 경로만 받는다 (.., 바깥 경로, 숨김 파일은 막는다)
function inside(p, { mustExist = false } = {}) {
  if (!p) die('파일 이름이 빠졌어요.');
  const abs = path.resolve(CWD, p);
  if (abs !== CWD && !abs.startsWith(CWD + path.sep)) die(`이 크루 폴더 안의 파일만 쓸 수 있어요: ${p}`);
  if (abs.split(path.sep).some((s) => s.startsWith('.') && s !== '')) die(`점(.)으로 시작하는 파일·폴더는 쓸 수 없어요: ${p}`);
  if (mustExist && !fs.existsSync(abs)) die(`파일이 없어요: ${p}`);
  return abs;
}
const ext = (p) => path.extname(p).toLowerCase();
function need(cmd, kit) {
  const r = spawnSync('which', [cmd], { encoding: 'utf8' });
  if (r.status !== 0) die(`"${cmd}"이(가) 설치돼 있지 않아요. 사용자에게 "더보기 → 도구 상자 → ${kit}"를 설치해 달라고 알려 주세요.`);
}
function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 10 * 60 * 1000 });
  if (r.error) die(`${cmd} 실행에 실패했어요: ${r.error.message}`);
  if (r.status !== 0) die(`${cmd}가 실패했어요.\n${String(r.stderr || r.stdout).slice(-1200)}`);
}
const outOk = (out) => { if (!fs.existsSync(out) || fs.statSync(out).size === 0) die('결과 파일이 만들어지지 않았어요.'); console.log(`만들었어요: ${path.relative(CWD, out)}`); };

// 한글 글꼴을 쓰도록 PDF용 스타일을 임시 파일로 만든다
function pdfCss() {
  const f = path.join(os.tmpdir(), `gamja-pdf-${process.pid}.css`);
  fs.writeFileSync(f, "@page { size: A4; margin: 20mm; } body { font-family: 'Noto Sans CJK KR', 'Noto Sans CJK', sans-serif; line-height: 1.6; font-size: 11pt; } table { border-collapse: collapse; } td, th { border: 1px solid #999; padding: 4px 8px; }");
  return f;
}

const PY_SHEET = [
  'import sys, csv',
  'from openpyxl import Workbook',
  'wb = Workbook(); ws = wb.active',
  "with open(sys.argv[1], newline='', encoding='utf-8-sig') as f:",
  '    for row in csv.reader(f):',
  '        out = []',
  '        for c in row:',
  '            try: out.append(float(c) if "." in c else int(c))',
  '            except ValueError: out.append(c)',
  '        ws.append(out)',
  'wb.save(sys.argv[2])',
].join('\n');

const PY_AUDIO = [
  'import sys, json, math, wave, struct',
  "data = json.load(open(sys.argv[1], encoding='utf-8'))",
  "bpm = data.get('bpm', 120) if isinstance(data, dict) else 120",
  "seq = data.get('notes', []) if isinstance(data, dict) else data",
  'rate = 22050',
  "names = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}",
  'def freq(n):',
  "    if not n or str(n).lower() in ('r', 'rest'): return 0",
  '    n = str(n); base = names[n[0].upper()]; i = 1',
  "    if len(n) > 1 and n[1] in '#b':",
  "        base += 1 if n[1] == '#' else -1; i = 2",
  '    octv = int(n[i:] or 4)',
  '    return 440.0 * 2 ** ((12 * (octv + 1) + base - 69) / 12)',
  'frames = bytearray(); spb = 60.0 / bpm',
  'for item in seq[:500]:',
  "    note = item.get('note') if isinstance(item, dict) else item[0]",
  "    beats = float(item.get('beats', 1) if isinstance(item, dict) else item[1])",
  '    f = freq(note); n = int(rate * spb * min(beats, 16))',
  '    for k in range(n):',
  '        env = min(1.0, k / 200, (n - k) / 400)',
  '        v = 0 if f == 0 else int(12000 * env * math.sin(2 * math.pi * f * k / rate))',
  "        frames += struct.pack('<h', v)",
  "w = wave.open(sys.argv[2], 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(bytes(frames)); w.close()",
].join('\n');

const HELP = `gamja-make 사용법 (이 크루 폴더 안의 파일만 다룰 수 있어요)

  doc <글.md> <결과.docx|pdf|html|pptx>   마크다운 글을 워드·PDF·웹·파워포인트 문서로 (제목은 #, 소제목은 ##. pptx는 ## 마다 한 장)
  sheet <표.csv> <결과.xlsx>               CSV 표를 엑셀 파일로
  image <그림.svg> <결과.png> [가로픽셀]    SVG 그림을 PNG로 (기본 가로 1080)
  video <결과.mp4> <한장당초> <소리파일|-> <사진1> <사진2> ...   사진을 이어 붙인 슬라이드 영상 (소리가 필요 없으면 -)
  audio <악보.json> <결과.wav>             악보 JSON을 소리로. 예) {"bpm":120,"notes":[{"note":"C4","beats":1},{"note":"E4","beats":1},{"note":"rest","beats":0.5}]}
  saju <YYYY-MM-DD> <HH:MM|모름> [남|여]    사주(년·월·일·시 기둥, 오행, 십성, 대운)를 계산. 양력이 기본, 음력이면 --lunar (윤달은 --leap도). 예) saju 1990-05-15 14:30 남 / saju 1990-04-21 14:30 여 --lunar  (옵션: --lon 127 --tz 9 --zasi yaja|jo --no-correction)
  serve [옵션] -- <시작명령>               만든 웹 서버를 잠깐 켜서 확인하고 자동으로 끈다. 예) serve --path / --path /api/hello -- node server.js
                                           옵션: --path <주소> (여러 번 가능, 기본 /) --port <번호> (앱이 포트를 직접 정해 둘 때) --wait <초> (켜지길 기다리는 시간, 기본 20) --time <초> (전체 제한, 기본 60)
                                           시작명령은 node <파일> / npm start / npm run <이름> / python3 <파일> 만 돼요. 서버는 끝나면 반드시 꺼져요
  help                                     이 설명

재료 파일(.md .csv .svg .json)은 먼저 Write로 만든 뒤 위 명령을 실행하세요.`;


// 서버 시험: 이 크루 폴더에서 시작명령을 켜고, 응답을 확인하고, 반드시 끈다 (뒤에 남는 프로그램을 만들지 않는다)
function freePort() {
  return new Promise((ok, fail) => { const srv = require('net').createServer(); srv.once('error', fail); srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => ok(port)); }); });
}
function httpGet(port, urlPath) {
  return new Promise((ok) => {
    const req = require('http').get({ host: '127.0.0.1', port, path: urlPath, timeout: 8000, headers: { 'User-Agent': 'gamja-serve' } }, (res) => {
      const chunks = []; let n = 0;
      res.on('data', (c) => { n += c.length; if (n <= 4000) chunks.push(c); });
      res.on('end', () => ok({ status: res.statusCode, type: String(res.headers['content-type'] || ''), bytes: n, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => { req.destroy(); ok({ error: '8초 안에 답이 없어요' }); });
    req.on('error', (e) => ok({ error: e.code || e.message }));
  });
}
async function serveTest(args) {
  const sep = args.indexOf('--');
  if (sep < 0 || sep === args.length - 1) die('시작명령이 빠졌어요. 예) serve --path / -- node server.js');
  const opts = args.slice(0, sep);
  const cmdv = args.slice(sep + 1);
  const paths = []; let fixedPort = 0; let waitS = 20; let timeS = 60;
  for (let i = 0; i < opts.length; i++) {
    const o = opts[i], v = opts[i + 1];
    if (o === '--path') { if (!v || !v.startsWith('/')) die('--path 다음에는 /로 시작하는 주소가 와야 해요.'); paths.push(v); i++; }
    else if (o === '--port') { fixedPort = Number(v); if (!Number.isInteger(fixedPort) || fixedPort < 1024 || fixedPort > 65535) die('--port는 1024~65535 사이 숫자여야 해요.'); i++; }
    else if (o === '--wait') { waitS = Math.min(60, Math.max(3, Number(v) || 20)); i++; }
    else if (o === '--time') { timeS = Math.min(120, Math.max(10, Number(v) || 60)); i++; }
    else die(`알 수 없는 옵션이에요: ${o}`);
  }
  if (!paths.length) paths.push('/');
  // 시작명령: 정해 둔 프로그램만, 쉘 없이, 이 폴더 안의 파일만
  const [prog, ...rest] = cmdv;
  if (cmdv.some((t) => /[;&|`$<>()\n]/.test(t))) die('시작명령에는 ; & | ` $ < > ( ) 같은 문자를 쓸 수 없어요.');
  if (prog === 'node' || prog === 'python3') {
    const file = rest.find((t) => !t.startsWith('-'));
    if (prog === 'python3' && rest[0] === '-m' && rest[1] === 'http.server') { /* 간단한 정적 서버는 허용 */ }
    else { if (!file) die(`${prog} 다음에 실행할 파일 이름이 와야 해요.`); inside(file, { mustExist: true }); }
    if (rest.some((t) => t === '-e' || t === '-p' || t === '--eval' || t === '--print' || t === '-c')) die('코드를 바로 적어 실행하는 옵션은 쓸 수 없어요. 파일로 만들어 주세요.');
  } else if (prog === 'npm') {
    if (!((rest[0] === 'start' && rest.length === 1) || (rest[0] === 'run' && /^[\w:-]+$/.test(rest[1] || '') && rest.length === 2))) die('npm은 "npm start" 또는 "npm run <이름>"만 쓸 수 있어요.');
  } else die('시작명령은 node <파일> / npm start / npm run <이름> / python3 <파일> 만 쓸 수 있어요.');
  need(prog, '개발 도구');
  const port = fixedPort || await freePort();
  if (fixedPort && await httpGet(port, '/').then((r) => !r.error)) die(`${port}번 포트는 이미 쓰고 있어요. 다른 번호를 쓰거나 --port 없이 실행해 주세요.`);
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG || 'C.UTF-8', TMPDIR: process.env.TMPDIR, NODE_ENV: 'development', PORT: String(port), HOST: '127.0.0.1' };
  const child = require('child_process').spawn(prog, rest, { cwd: CWD, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = ''; let exited = null;
  const grab = (c) => { log = (log + c).slice(-3000); };
  child.stdout.on('data', grab); child.stderr.on('data', grab);
  child.on('exit', (code, sig) => { exited = { code, sig }; });
  child.on('error', (e) => { exited = { code: -1, sig: e.message }; });
  const killAll = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* 이미 끝남 */ } setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* 이미 끝남 */ } }, 1500).unref(); };
  const hard = setTimeout(() => { console.error('오류: 전체 제한 시간이 지나서 서버를 끄고 멈췄어요.'); killAll(); setTimeout(() => process.exit(1), 1700); }, timeS * 1000);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { killAll(); setTimeout(() => process.exit(1), 1700); });
  process.on('exit', () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* 이미 끝남 */ } });
  console.log(`서버를 켜는 중: ${cmdv.join(' ')}  (포트 ${port}${fixedPort ? '' : ', PORT 환경변수로 전달'})`);
  // 켜질 때까지 기다린다 (어떤 응답이든 오면 켜진 것)
  let up = false;
  const t0 = Date.now();
  while (!exited && Date.now() - t0 < waitS * 1000) {
    const r = await httpGet(port, '/');
    if (!r.error) { up = true; break; }
    await new Promise((ok) => setTimeout(ok, 400));
  }
  let bad = 0;
  if (!up) {
    bad = 1;
    console.log(exited ? `서버가 바로 꺼졌어요 (종료 코드 ${exited.code}${exited.sig ? ', ' + exited.sig : ''}).` : `${waitS}초 안에 ${port}번 포트에서 응답이 오지 않았어요. 앱이 PORT 환경변수를 안 쓰면 --port 옵션으로 앱의 포트를 알려 주세요.`);
  } else {
    console.log(`켜졌어요 (${((Date.now() - t0) / 1000).toFixed(1)}초)`);
    for (const pth of paths) {
      const r = await httpGet(port, pth);
      if (r.error) { bad = 1; console.log(`GET ${pth} → 실패: ${r.error}`); continue; }
      if (r.status >= 500) bad = 1;
      const text = !r.type || /text|json|xml|javascript/.test(r.type) ? r.body.replace(/\s+/g, ' ').slice(0, 300) : `(${r.type || '알 수 없는 형식'})`;
      console.log(`GET ${pth} → ${r.status} ${r.type.split(';')[0]} ${r.bytes}바이트\n    ${text}`);
    }
  }
  if (log.trim()) console.log(`--- 서버가 남긴 글 (마지막 부분) ---\n${log.trim().slice(-1200)}\n---`);
  clearTimeout(hard);
  killAll();
  await new Promise((ok) => { const w = setInterval(() => { if (exited) { clearInterval(w); ok(); } }, 100); setTimeout(() => { clearInterval(w); ok(); }, 2500); });
  console.log('서버를 껐어요.');
  process.exit(bad);
}

const [cmd, ...a] = process.argv.slice(2);
if (cmd === 'serve') { serveTest(a).catch((e) => die(e.message)); } else
switch (cmd) {
  case 'saju': { // 사주 계산은 외부 프로그램이 필요 없어서 도구 상자 설치 없이 쓸 수 있다
    try { console.log(require('./saju.js').run(a)); } catch (e) { die(e.message); }
    break;
  }
  case 'doc': {
    const [src, dest] = a;
    const input = inside(src, { mustExist: true });
    const out = inside(dest);
    const e = ext(dest);
    if (!['.docx', '.pdf', '.html', '.pptx'].includes(e)) die('결과 파일은 .docx .pdf .html .pptx 중 하나여야 해요.');
    need('pandoc', '문서 도구');
    if (e === '.pdf') {
      need('weasyprint', '문서 도구');
      run('pandoc', [input, '-o', out, '--pdf-engine=weasyprint', '--css', pdfCss(), '-s', '--metadata', `title=${path.basename(src, path.extname(src))}`]);
    } else if (e === '.html') {
      run('pandoc', [input, '-o', out, '-s', '--metadata', `title=${path.basename(src, path.extname(src))}`]);
    } else {
      run('pandoc', [input, '-o', out]);
    }
    outOk(out);
    break;
  }
  case 'sheet': {
    const [src, dest] = a;
    const input = inside(src, { mustExist: true });
    const out = inside(dest);
    if (ext(dest) !== '.xlsx') die('결과 파일은 .xlsx여야 해요.');
    need('python3', '문서 도구');
    run('python3', ['-c', PY_SHEET, input, out]);
    outOk(out);
    break;
  }
  case 'image': {
    const [src, dest, width] = a;
    const input = inside(src, { mustExist: true });
    const out = inside(dest);
    if (ext(src) !== '.svg' || ext(dest) !== '.png') die('image는 .svg를 .png로 바꿔요.');
    const w = Math.min(4000, Math.max(16, parseInt(width || '1080', 10) || 1080));
    need('rsvg-convert', '그림 도구');
    run('rsvg-convert', ['-w', String(w), input, '-o', out]);
    outOk(out);
    break;
  }
  case 'video': {
    const [dest, secs, audio, ...pics] = a;
    const out = inside(dest);
    if (ext(dest) !== '.mp4') die('결과 파일은 .mp4여야 해요.');
    if (!pics.length) die('사진을 한 장 이상 적어 주세요.');
    if (pics.length > 60) die('사진은 60장까지만 쓸 수 있어요.');
    const per = Math.min(30, Math.max(0.5, parseFloat(secs) || 3));
    need('ffmpeg', '영상·소리 도구');
    const files = pics.map((p) => inside(p, { mustExist: true }));
    const list = path.join(os.tmpdir(), `gamja-video-${process.pid}.txt`);
    // 마지막 사진은 한 번 더 적어 줘야 끝까지 보인다 (ffmpeg concat 규칙)
    const lines = files.flatMap((f) => [`file '${f.replace(/'/g, "'\\''")}'`, `duration ${per}`]);
    lines.push(`file '${files[files.length - 1].replace(/'/g, "'\\''")}'`);
    fs.writeFileSync(list, lines.join('\n'));
    const args = ['-y', '-f', 'concat', '-safe', '0', '-i', list];
    if (audio && audio !== '-') args.push('-i', inside(audio, { mustExist: true }));
    args.push('-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p', '-r', '25');
    if (audio && audio !== '-') args.push('-shortest');
    args.push(out);
    run('ffmpeg', args);
    outOk(out);
    break;
  }
  case 'audio': {
    const [src, dest] = a;
    const input = inside(src, { mustExist: true });
    const out = inside(dest);
    if (ext(dest) !== '.wav') die('결과 파일은 .wav여야 해요.');
    need('python3', '영상·소리 도구');
    run('python3', ['-c', PY_AUDIO, input, out]);
    outOk(out);
    break;
  }
  default:
    console.log(HELP);
    if (cmd && cmd !== 'help') process.exit(1);
}
