'use strict';
// 의존성 없는 zip 도구 (Node 기본 기능만): 채팅 내보내기·가져오기에 쓴다.
// 쓰기는 조각 단위로 흘려 보내서 큰 파일도 메모리에 다 올리지 않는다. 읽기는 파일 끝의 목차를 읽고 항목마다 따로 푼다.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline, Transform } = require('stream');
const { pipeline: pipelineP } = require('stream/promises');

const MAX_ENTRIES = 20000;
// 목차(central directory) 크기 상한: 항목 2만 개가 이름을 넉넉히 가져도 이 안에 들어간다. 이 값을 넘는 목차는 메모리에 올리지 않고 거절한다 (폰에서 감자알이 꺼지는 것을 막는다)
const MAX_CD_BYTES = 32 * 1024 * 1024;
// 목차를 읽기 전에 EOCD(끝 표시)의 숫자들이 말이 되는지 확인한다. 메모리는 이 검사를 통과한 뒤에만 잡는다
function checkCentral(total, cdSize, cdOff, eocdPos) {
  if (total === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) throw new Error('지원하지 않는 zip이에요.');
  if (total > MAX_ENTRIES) throw new Error('zip 안의 파일이 너무 많아요.');
  if (cdSize > MAX_CD_BYTES) throw new Error('zip 목차가 비정상적으로 커요.');
  if (cdSize < total * 46) throw new Error('깨진 zip 파일이에요.'); // 항목 하나의 머리만 해도 46바이트
  if (cdOff + cdSize > eocdPos) throw new Error('깨진 zip 파일이에요.'); // 목차는 끝 표시 앞에 있어야 한다
}
function readCentral(fd, cdSize, cdOff) {
  const cd = Buffer.alloc(cdSize);
  const got = cdSize ? fs.readSync(fd, cd, 0, cdSize, cdOff) : 0;
  if (got !== cdSize) throw new Error('깨진 zip 파일이에요.');
  return cd;
}

function dosStamp(d = new Date()) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

// out(쓰기 스트림)에 zip을 쓴다. entries: [{ name, data: Buffer } | { name, file: 경로 }]
// 이 항목들로 만든 zip 크기의 안전한 상한: 압축이 하나도 안 되는 데이터를 가정한다. items: [{ nameBytes, size }]
// 내보내기가 "가져올 수 있는 크기"를 넘는 zip을 만들지 않도록, 쓰기 전에 이 값으로 확인한다
const deflateWorst = (n) => n + Math.ceil(n / 1000) + 64;
function zipSizeUpperBound(items) {
  let total = 22; // 끝 표시
  for (const it of items) total += 30 + it.nameBytes + deflateWorst(it.size) + 16 + 46 + it.nameBytes;
  return total;
}

// opts.maxBytes: 쓰는 도중 이 크기를 넘으면 멈춘다 (확인한 뒤에 파일이 커진 경우의 안전장치)
// opts.verify = { ratio, fileMax, totalMax }: 만드는 도중 다시 확인한다 (사전 확인 뒤에 파일이 바뀌어도 가져올 수 없는 zip을 끝까지 만들지 않는다)
//  - entries[].size/mtimeMs가 있으면 그 파일이 처음 본 그대로인지(크기·수정 시각) 읽기 전·후에 확인하고, 읽은 바이트 수도 맞는지 센다
//  - 항목별 압축률, 전체 압축률, 파일·합계 크기를 확인한다. 중앙 디렉터리(zip의 끝)는 모두 통과한 뒤에만 쓴다 → 실패하면 열 수 있는 zip이 만들어지지 않는다
class ZipVerifyError extends Error {
  constructor(code, name, msg) { super(msg || code); this.code = code; this.entry = name; }
}
async function writeZip(out, entries, opts = {}) {
  if (entries.length >= 0xffff) throw new Error('파일이 너무 많아요.');
  const V = opts.verify || null;
  let totalRaw = 0;
  let offset = 0;
  const central = [];
  const { time, date } = dosStamp();
  const write = (buf) => new Promise((resolve, reject) => {
    offset += buf.length;
    if (opts.maxBytes && offset > opts.maxBytes) return reject(new Error('zip이 한도 크기를 넘어서 멈췄어요.'));
    if (out.destroyed) return reject(new Error('연결이 끊겼어요.'));
    if (out.write(buf)) return resolve();
    const done = (err) => { out.off('drain', done); out.off('close', done); err instanceof Error ? reject(err) : (out.destroyed ? reject(new Error('연결이 끊겼어요.')) : resolve()); };
    out.once('drain', done);
    out.once('close', done);
  });
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const local = offset;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0808, 6); // 비트 3: 크기는 데이터 뒤에 적는다, 비트 11: 이름은 UTF-8
    head.writeUInt16LE(8, 8);
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt16LE(name.length, 26);
    await write(head);
    await write(name);
    let crc = 0;
    let usize = 0;
    let csize = 0;
    const chk = (code, msg) => new ZipVerifyError(code, e.name, msg);
    const srcNow = () => { try { return fs.statSync(e.file); } catch { return null; } };
    if (V && !e.data && e.size !== undefined) {
      const st = srcNow();
      if (!st || st.size !== e.size || (e.mtimeMs !== undefined && st.mtimeMs !== e.mtimeMs)) throw chk('source-changed', '검사한 뒤에 파일이 바뀌었어요.');
    }
    if (e.data) {
      crc = zlib.crc32(e.data);
      usize = e.data.length;
      const z = zlib.deflateRawSync(e.data);
      csize = z.length;
      if (z.length) await write(z);
    } else {
      const counter = new Transform({
        transform(chunk, _enc, cb) {
          crc = zlib.crc32(chunk, crc); usize += chunk.length;
          if (V && e.size !== undefined && usize > e.size) return cb(chk('source-changed', '만드는 도중 파일이 커졌어요.'));
          cb(null, chunk);
        },
      });
      const def = zlib.createDeflateRaw();
      pipeline(fs.createReadStream(e.file), counter, def, () => {});
      // 쓰는 쪽이 닫히면(시간 제한·연결 끊김) 읽기가 멈춰 있어도 기다리지 않고 이 파일을 포기한다. 원본은 읽기만 하므로 데이터는 그대로다
      const abandon = () => def.destroy(new Error('연결이 끊겼어요.'));
      out.once('close', abandon);
      if (out.destroyed) abandon();
      try { for await (const c of def) { csize += c.length; await write(c); } }
      finally { out.off('close', abandon); }
    }
    if (V) {
      if (!e.data && e.size !== undefined) {
        const st = srcNow();
        if (usize !== e.size || !st || st.size !== e.size || (e.mtimeMs !== undefined && st.mtimeMs !== e.mtimeMs)) throw chk('source-changed', '만드는 도중 파일이 바뀌었어요.');
      }
      if (V.fileMax && usize > V.fileMax) throw chk('file-too-big', '파일 하나가 한도를 넘었어요.');
      if (V.ratio && usize > 1048576 && usize > V.ratio * Math.max(csize, 1)) throw chk('ratio', '압축률이 가져오기 한도를 넘었어요.');
      totalRaw += usize;
      if (V.totalMax && totalRaw > V.totalMax) throw chk('total-too-big', '합계 크기가 한도를 넘었어요.');
    }
    const desc = Buffer.alloc(16);
    desc.writeUInt32LE(0x08074b50, 0);
    desc.writeUInt32LE(crc >>> 0, 4);
    desc.writeUInt32LE(csize, 8);
    desc.writeUInt32LE(usize, 12);
    await write(desc);
    central.push({ name, local, crc: crc >>> 0, csize, usize });
  }
  if (V && V.ratio) {
    const finalSize = offset + central.reduce((n, c) => n + 46 + c.name.length, 0) + 22;
    if (opts.maxBytes && finalSize > opts.maxBytes) throw new ZipVerifyError('too-big', '', 'zip이 한도 크기를 넘어요.');
    if (totalRaw > 1048576 && totalRaw > V.ratio * finalSize) throw new ZipVerifyError('ratio', '', '전체 압축률이 가져오기 한도를 넘었어요.');
  }
  const cdStart = offset;
  for (const c of central) {
    const b = Buffer.alloc(46);
    b.writeUInt32LE(0x02014b50, 0);
    b.writeUInt16LE(20, 4);
    b.writeUInt16LE(20, 6);
    b.writeUInt16LE(0x0808, 8);
    b.writeUInt16LE(8, 10);
    b.writeUInt16LE(time, 12);
    b.writeUInt16LE(date, 14);
    b.writeUInt32LE(c.crc, 16);
    b.writeUInt32LE(c.csize, 20);
    b.writeUInt32LE(c.usize, 24);
    b.writeUInt16LE(c.name.length, 28);
    b.writeUInt32LE(c.local, 42);
    await write(b);
    await write(c.name);
  }
  const cdSize = offset - cdStart;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(cdStart, 16);
  await write(end);
}

// zip 파일의 항목 목차를 읽는다
function readZipIndex(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size < 22) throw new Error('zip 파일이 아니에요.');
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    const at = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (at < 0) throw new Error('zip 파일이 아니에요.');
    const total = tail.readUInt16LE(at + 10);
    const cdSize = tail.readUInt32LE(at + 12);
    const cdOff = tail.readUInt32LE(at + 16);
    checkCentral(total, cdSize, cdOff, size - tailLen + at);
    const cd = readCentral(fd, cdSize, cdOff);
    const entries = [];
    let p = 0;
    for (let i = 0; i < total; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) throw new Error('깨진 zip 파일이에요.');
      const flags = cd.readUInt16LE(p + 8);
      const nlen = cd.readUInt16LE(p + 28);
      const elen = cd.readUInt16LE(p + 30);
      const clen = cd.readUInt16LE(p + 32);
      const e = {
        flags, method: cd.readUInt16LE(p + 10), csize: cd.readUInt32LE(p + 20), usize: cd.readUInt32LE(p + 24),
        offset: cd.readUInt32LE(p + 42), name: cd.toString('utf8', p + 46, p + 46 + nlen),
      };
      p += 46 + nlen + elen + clen;
      if (flags & 1) throw new Error('암호가 걸린 zip은 가져올 수 없어요.');
      if (e.method !== 0 && e.method !== 8) throw new Error('지원하지 않는 압축 방식이에요.');
      entries.push(e);
    }
    return entries;
  } finally { fs.closeSync(fd); }
}

// zip 안의 이름이 안전한 상대 경로인지 (폴더 밖으로 나가는 이름은 거부). 안전하면 정리한 경로, 아니면 null
function safeRel(name) {
  if (typeof name !== 'string' || !name || name.includes('\0') || name.includes('\\') || name.startsWith('/')) return null;
  const parts = name.split('/').filter((x) => x !== '' && x !== '.');
  if (!parts.length || parts.some((x) => x === '..')) return null;
  return parts.join('/');
}

function entryStream(file, e) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(30);
  try { fs.readSync(fd, head, 0, 30, e.offset); } finally { fs.closeSync(fd); }
  if (head.readUInt32LE(0) !== 0x04034b50) throw new Error('깨진 zip 파일이에요.');
  const start = e.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  if (e.csize === 0) return null;
  const rs = fs.createReadStream(file, { start, end: start + e.csize - 1 });
  return e.method === 8 ? [rs, zlib.createInflateRaw()] : [rs];
}

// budget: { left } — 풀려 나온 크기의 남은 한도(바이트). 넘으면 멈춘다
function limiter(budget) {
  return new Transform({
    transform(chunk, _enc, cb) {
      budget.left -= chunk.length;
      if (budget.left < 0) return cb(new Error('압축을 푼 크기가 한도를 넘어요.'));
      cb(null, chunk);
    },
  });
}

async function extractEntry(file, e, dest, budget) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const chain = entryStream(file, e);
  if (!chain) { fs.writeFileSync(dest, ''); return; }
  await pipelineP(...chain, limiter(budget), fs.createWriteStream(dest));
}

async function readEntry(file, e, maxBytes) {
  const chain = entryStream(file, e);
  if (!chain) return Buffer.alloc(0);
  const budget = { left: maxBytes };
  const parts = [];
  const sink = new Transform({ transform(chunk, _enc, cb) { parts.push(chunk); cb(); } });
  await pipelineP(...chain, limiter(budget), sink);
  return Buffer.concat(parts);
}

module.exports = { writeZip, ZipVerifyError, readZipIndex, safeRel, extractEntry, readEntry, MAX_ENTRIES };

// ---- 2단계 추가 (기존 함수는 그대로 두고 덧붙인다) ----
// 목차를 읽으면서 CRC, 만든 곳, 외부 속성, 폴더 여부도 같이 돌려준다
function readZipIndexEx(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size < 22) throw new Error('zip 파일이 아니에요.');
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    const at = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (at < 0) throw new Error('zip 파일이 아니에요.');
    const total = tail.readUInt16LE(at + 10);
    const cdSize = tail.readUInt32LE(at + 12);
    const cdOff = tail.readUInt32LE(at + 16);
    checkCentral(total, cdSize, cdOff, size - tailLen + at);
    const cd = readCentral(fd, cdSize, cdOff);
    const entries = [];
    let p = 0;
    for (let i = 0; i < total; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) throw new Error('깨진 zip 파일이에요.');
      const flags = cd.readUInt16LE(p + 8);
      const nlen = cd.readUInt16LE(p + 28);
      const elen = cd.readUInt16LE(p + 30);
      const clen = cd.readUInt16LE(p + 32);
      const e = {
        flags, madeBy: cd.readUInt16LE(p + 4), method: cd.readUInt16LE(p + 10), crc: cd.readUInt32LE(p + 16),
        csize: cd.readUInt32LE(p + 20), usize: cd.readUInt32LE(p + 24), externalAttr: cd.readUInt32LE(p + 38),
        offset: cd.readUInt32LE(p + 42), name: cd.toString('utf8', p + 46, p + 46 + nlen),
      };
      if (p + 46 + nlen + elen + clen > cd.length) throw new Error('깨진 zip 파일이에요.');
      p += 46 + nlen + elen + clen;
      if (flags & 1) throw new Error('암호가 걸린 zip은 가져올 수 없어요.');
      if (e.method !== 0 && e.method !== 8) throw new Error('지원하지 않는 압축 방식이에요.');
      if (e.offset + 30 + e.csize > size) throw new Error('깨진 zip 파일이에요.');
      e.isDir = e.name.endsWith('/');
      entries.push(e);
    }
    return entries;
  } finally { fs.closeSync(fd); }
}

// 실제로 풀려 나오는 바이트를 세면서 한도, 압축률, 크기 일치, CRC를 검사하는 중간 관
// opts: { maxFile, budget: { left }, ratio }
function verifier(e, opts) {
  let actual = 0;
  let crc = 0;
  const maxFile = opts.maxFile || Infinity;
  const ratio = opts.ratio || Infinity;
  return new Transform({
    transform(chunk, _enc, cb) {
      actual += chunk.length;
      crc = zlib.crc32(chunk, crc);
      if (actual > maxFile) return cb(new Error('파일 하나의 크기가 한도를 넘어요.'));
      if (opts.budget) { opts.budget.left -= chunk.length; if (opts.budget.left < 0) return cb(new Error('압축을 푼 전체 크기가 한도를 넘어요.')); }
      if (e.method === 8 && actual > 1048576 && actual > ratio * Math.max(e.csize, 1)) return cb(new Error('압축률이 비정상적으로 높아요.'));
      cb(null, chunk);
    },
    flush(cb) {
      if (actual !== e.usize) return cb(new Error('zip에 적힌 크기와 실제 크기가 달라요.'));
      if ((crc >>> 0) !== e.crc) return cb(new Error('파일이 깨졌어요(검사값 불일치).'));
      cb();
    },
  });
}

// 폴더를 만들면서 중간 폴더가 심볼릭 링크가 아닌지 확인한다 (root 밖으로 나가지 않게)
function mkdirSafe(root, dir) {
  const rel = path.relative(root, dir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('허용되지 않는 경로예요.');
  let cur = root;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    cur = path.join(cur, part);
    let st = null;
    try { st = fs.lstatSync(cur); } catch (_) { /* 없음 */ }
    if (!st) fs.mkdirSync(cur, { mode: 0o755 });
    else if (!st.isDirectory()) throw new Error('허용되지 않는 경로예요.');
  }
}

// 검사하면서 푼다. dest가 null이면 풀지 않고 검사만 한다. zip의 모드는 무시하고 0o644로 만든다
async function extractVerified(file, e, dest, opts, root) {
  const chain = e.csize === 0 ? null : entryStream(file, e);
  const ver = verifier(e, opts);
  if (dest) {
    mkdirSafe(root, path.dirname(dest));
    try { if (fs.lstatSync(dest)) throw new Error('이미 같은 이름의 파일이 있어요.'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
  const out = dest ? fs.createWriteStream(dest, { flags: 'wx', mode: 0o644 }) : new Transform({ transform(_c, _e, cb) { cb(); } });
  try {
    if (!chain) { ver.end(); ver.resume(); await new Promise((res, rej) => { ver.on('end', res); ver.on('error', rej); }); if (dest) fs.writeFileSync(dest, '', { flag: 'w', mode: 0o644 }); return; }
    await pipelineP(...chain, ver, out);
  } catch (err) {
    if (dest) { try { fs.rmSync(dest, { force: true }); } catch (_) { /* 무시 */ } }
    throw err;
  }
}

// 검사하면서 메모리로 읽는다 (작은 파일용)
async function readVerified(file, e, opts) {
  const parts = [];
  const chain = e.csize === 0 ? null : entryStream(file, e);
  const ver = verifier(e, opts);
  const sink = new Transform({ transform(c, _e, cb) { parts.push(c); cb(); } });
  if (!chain) { ver.end(); ver.resume(); await new Promise((res, rej) => { ver.on('end', res); ver.on('error', rej); }); return Buffer.alloc(0); }
  await pipelineP(...chain, ver, sink);
  return Buffer.concat(parts);
}

// ---- 압축률 미리 보기 (내보내기 전에: 가져오기가 "압축률이 비정상적으로 높다"고 거절할 파일을 처음부터 알린다) ----
// writeZip과 같은 방식(deflateRaw 기본값)으로 실제로 줄여 보고 압축된 크기만 센다 (파일은 읽기만 한다)
async function deflatedSize(src) { // src: 파일 경로 또는 Buffer
  if (Buffer.isBuffer(src)) return zlib.deflateRawSync(src).length;
  let n = 0;
  const { Writable } = require('stream');
  await pipelineP(fs.createReadStream(src), zlib.createDeflateRaw(), new Writable({ write(c, _e, cb) { n += c.length; cb(); } }));
  return n;
}
// 앞·가운데·끝에서 256KB씩 떼어 압축해 본 대략의 압축률 (싸게 훑는 용도). 작은 파일은 통째로
function sampleRatio(file, size) {
  const CH = 256 * 1024;
  const fd = fs.openSync(file, 'r');
  try {
    const spots = size <= CH * 3 ? [0] : [0, Math.floor(size / 2 - CH / 2), size - CH];
    let raw = 0; let comp = 0;
    for (const at of spots) {
      const buf = Buffer.alloc(size <= CH * 3 ? size : CH);
      const got = fs.readSync(fd, buf, 0, buf.length, at);
      raw += got; comp += zlib.deflateRawSync(buf.subarray(0, got)).length;
    }
    return raw / Math.max(comp, 1);
  } finally { fs.closeSync(fd); }
}
Object.assign(module.exports, { deflatedSize, sampleRatio, zipSizeUpperBound, readZipIndexEx, extractVerified, readVerified, mkdirSafe });
