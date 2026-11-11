'use strict';
// 의존성 없는 zip 도구 (Node 기본 기능만): 채팅 내보내기·가져오기에 쓴다.
// 쓰기는 조각 단위로 흘려 보내서 큰 파일도 메모리에 다 올리지 않는다. 읽기는 파일 끝의 목차를 읽고 항목마다 따로 푼다.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline, Transform } = require('stream');
const { pipeline: pipelineP } = require('stream/promises');

const MAX_ENTRIES = 20000;

function dosStamp(d = new Date()) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

// out(쓰기 스트림)에 zip을 쓴다. entries: [{ name, data: Buffer } | { name, file: 경로 }]
async function writeZip(out, entries) {
  if (entries.length >= 0xffff) throw new Error('파일이 너무 많아요.');
  let offset = 0;
  const central = [];
  const { time, date } = dosStamp();
  const write = (buf) => new Promise((resolve, reject) => {
    offset += buf.length;
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
    if (e.data) {
      crc = zlib.crc32(e.data);
      usize = e.data.length;
      const z = zlib.deflateRawSync(e.data);
      csize = z.length;
      if (z.length) await write(z);
    } else {
      const counter = new Transform({
        transform(chunk, _enc, cb) { crc = zlib.crc32(chunk, crc); usize += chunk.length; cb(null, chunk); },
      });
      const def = zlib.createDeflateRaw();
      pipeline(fs.createReadStream(e.file), counter, def, () => {});
      for await (const c of def) { csize += c.length; await write(c); }
    }
    const desc = Buffer.alloc(16);
    desc.writeUInt32LE(0x08074b50, 0);
    desc.writeUInt32LE(crc >>> 0, 4);
    desc.writeUInt32LE(csize, 8);
    desc.writeUInt32LE(usize, 12);
    await write(desc);
    central.push({ name, local, crc: crc >>> 0, csize, usize });
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
    if (total === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) throw new Error('지원하지 않는 zip이에요.');
    if (total > MAX_ENTRIES) throw new Error('zip 안의 파일이 너무 많아요.');
    if (cdOff + cdSize > size) throw new Error('깨진 zip 파일이에요.');
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOff);
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

module.exports = { writeZip, readZipIndex, safeRel, extractEntry, readEntry, MAX_ENTRIES };
