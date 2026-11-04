'use strict';
// 사주(四柱) 계산: 양력 생년월일시 → 년·월·일·시 기둥, 오행 개수, 십성, 대운. 외부 라이브러리 없이 태양의 위치(절기)를 직접 계산한다.
// 쓰는 곳: gamja-make.js의 `saju` 명령 (타로·사주 크루가 말로 계산하다 틀리지 않도록 계산은 이 프로그램이 한다)

const STEMS = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'];
const STEMS_H = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const BRANCHES = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'];
const BRANCHES_H = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const ELEMENTS = ['목', '화', '토', '금', '수'];
const STEM_ELEMENT = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4];
const BRANCH_ELEMENT = [4, 2, 0, 0, 2, 1, 1, 2, 3, 3, 2, 4];
// 지지에 든 가장 중심이 되는 천간(본기): 자 계, 축 기, 인 갑, 묘 을, 진 무, 사 병, 오 정, 미 기, 신 경, 유 신, 술 무, 해 임
const MAIN_STEM = [9, 5, 0, 1, 4, 2, 3, 5, 6, 7, 4, 8];
const JIE = [315, 345, 15, 45, 75, 105, 135, 165, 195, 225, 255, 285]; // 월이 바뀌는 절기(입춘·경칩·청명·입하·망종·소서·입추·백로·한로·입동·대설·소한)의 태양 황경
const JIE_NAME = ['입춘', '경칩', '청명', '입하', '망종', '소서', '입추', '백로', '한로', '입동', '대설', '소한'];

const mod = (a, n) => ((a % n) + n) % n;
const pillarName = (i) => `${STEMS[i % 10]}${BRANCHES[i % 12]}(${STEMS_H[i % 10]}${BRANCHES_H[i % 12]})`;
const pillarIdx = (stem, branch) => { for (let i = 0; i < 60; i++) if (i % 10 === stem && i % 12 === branch) return i; return 0; };

// 그레고리력 날짜 → 정오 기준 율리우스 일수(정수). 2000-01-01 = 2451545
function jdn(y, m, d) {
  const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}
// 율리우스일(소수) → [년, 월, 일, 시, 분]
function fromJd(jd) {
  const z = Math.floor(jd + 0.5), f = jd + 0.5 - z;
  const alpha = Math.floor((z - 1867216.25) / 36524.25);
  const a = z + 1 + alpha - Math.floor(alpha / 4);
  const b = a + 1524, c = Math.floor((b - 122.1) / 365.25), d = Math.floor(365.25 * c), e = Math.floor((b - d) / 30.6001);
  const day = b - d - Math.floor(30.6001 * e);
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;
  const mins = Math.floor(f * 1440 + 1e-6);
  return [year, month, day, Math.floor(mins / 60), mins % 60];
}
// 겉보기 태양 황경(도). jd는 율리우스일(세계시). 정확도는 약 0.01도(절입 시각 ±15분)
function sunLongitude(jd) {
  const T = (jd + 69 / 86400 - 2451545.0) / 36525; // 지구시 보정(약 69초)
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * Math.PI / 180;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) + (0.019993 - 0.000101 * T) * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
  const omega = (125.04 - 1934.136 * T) * Math.PI / 180;
  return mod(L0 + C - 0.00569 - 0.00478 * Math.sin(omega), 360);
}
// 그 해(양력)에 태양 황경이 target도가 되는 때(율리우스일, 세계시)
function termJd(year, target) {
  let jd = jdn(year, 1, 1) - 0.5 + mod(target - 280, 360) / 0.9856;
  for (let i = 0; i < 10; i++) jd += (mod(sunLongitude(jd) - target + 180, 360) - 180) / -0.9856;
  return jd;
}
const fmt = (p) => `${p[0]}-${String(p[1]).padStart(2, '0')}-${String(p[2]).padStart(2, '0')} ${String(p[3]).padStart(2, '0')}:${String(p[4]).padStart(2, '0')}`;

// 십성: 일간을 기준으로 다른 글자가 어떤 관계인지
function tenGod(dayStem, other) {
  const same = dayStem % 2 === other % 2;
  const d = STEM_ELEMENT[dayStem], o = STEM_ELEMENT[other];
  if (o === d) return same ? '비견' : '겁재';
  if (o === (d + 1) % 5) return same ? '식신' : '상관';
  if (o === (d + 2) % 5) return same ? '편재' : '정재';
  if (o === (d + 3) % 5) return same ? '편관' : '정관';
  return same ? '편인' : '정인';
}

// opts: { date:'YYYY-MM-DD', time:'HH:MM'|null, gender:'M'|'F'|null, lon:127, tz:9, correction:true, zasi:'yaja'|'jo' }
function compute(opts) {
  const dm = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(opts.date || '');
  if (!dm) throw new Error('날짜는 양력 YYYY-MM-DD 모양으로 적어 주세요. (예: 1990-05-15)');
  const [Y, Mo, D] = [+dm[1], +dm[2], +dm[3]];
  if (Y < 1900 || Y > 2100 || Mo < 1 || Mo > 12 || D < 1 || D > 31) throw new Error('1900~2100년의 올바른 양력 날짜만 계산해요.');
  let h = 12, mi = 0;
  const known = !!opts.time;
  if (known) {
    const tm = /^(\d{1,2}):(\d{2})$/.exec(opts.time);
    if (!tm || +tm[1] > 23 || +tm[2] > 59) throw new Error('시각은 24시간제 HH:MM으로 적어 주세요. (예: 14:30, 모르면 모름)');
    h = +tm[1]; mi = +tm[2];
  }
  const tz = opts.tz === undefined ? 9 : opts.tz;
  const lon = opts.lon === undefined ? 127 : opts.lon;
  const corr = opts.correction === false || !known ? 0 : Math.round((lon - tz * 15) * 4); // 진태양시 보정(분): 서울(동경 127도)은 한국 표준시(동경 135도)보다 약 32분 늦다
  const zasi = opts.zasi === 'jo' ? 'jo' : 'yaja';

  // 실제 출생 순간(세계시). 년·월 기둥은 절기의 정확한 시각과 이 순간을 비교한다
  const wall = jdn(Y, Mo, D) - 0.5 + (h * 60 + mi) / 1440;
  const birthJd = wall - tz / 24;
  const lichun = termJd(Y, 315);
  const sajuYear = birthJd >= lichun ? Y : Y - 1;
  const yearIdx = mod(sajuYear - 4, 60);
  const sunLon = sunLongitude(birthJd);
  const monthNo = Math.floor(mod(sunLon - 315, 360) / 30); // 0=인월 … 11=축월
  const monthStem = (mod(yearIdx % 10, 5) * 2 + 2 + monthNo) % 10;
  const monthBranch = (2 + monthNo) % 12;
  const monthIdx = pillarIdx(monthStem, monthBranch);

  // 일·시 기둥은 진태양시(보정한 시각)로
  const adj = wall + corr / 1440;
  const dayNumber = Math.floor(adj + 0.5);
  const minutesOfDay = (adj + 0.5 - dayNumber) * 1440;
  let dayIdx = mod(dayNumber + 49, 60);
  const lateZi = known && minutesOfDay >= 1380; // 23:00~24:00 (야자시)
  let hourDayIdx = dayIdx;
  if (lateZi) {
    hourDayIdx = mod(dayIdx + 1, 60); // 시주의 천간은 다음날 일간 기준
    if (zasi === 'jo') dayIdx = hourDayIdx; // 조자시 설: 23시부터 다음날로 본다
  }
  const dayStem = dayIdx % 10;
  const out = { pillars: {}, notes: [] };
  out.pillars.year = yearIdx;
  out.pillars.month = monthIdx;
  out.pillars.day = dayIdx;
  if (known) {
    const hb = Math.floor(mod(minutesOfDay + 60, 1440) / 120);
    const hs = (mod(hourDayIdx % 10, 5) * 2 + hb) % 10;
    out.pillars.hour = pillarIdx(hs, hb);
  }

  // 십성과 오행
  const list = [['년주', 'year'], ['월주', 'month'], ['일주', 'day'], ['시주', 'hour']].filter(([, k]) => out.pillars[k] !== undefined);
  const counts = [0, 0, 0, 0, 0];
  out.rows = list.map(([label, k]) => {
    const i = out.pillars[k], s = i % 10, b = i % 12;
    counts[STEM_ELEMENT[s]]++; counts[BRANCH_ELEMENT[b]]++;
    return { label, name: pillarName(i), stemGod: k === 'day' ? '일간(나)' : tenGod(dayStem, s), branchGod: tenGod(dayStem, MAIN_STEM[b]), stemEl: ELEMENTS[STEM_ELEMENT[s]], branchEl: ELEMENTS[BRANCH_ELEMENT[b]] };
  });
  out.counts = ELEMENTS.map((e, i) => `${e} ${counts[i]}`).join(' · ');
  out.dayMaster = `${STEMS[dayStem]}(${STEMS_H[dayStem]}) ${dayStem % 2 === 0 ? '양' : '음'}${ELEMENTS[STEM_ELEMENT[dayStem]]}`;

  // 절기 정보와 경계 경고
  const tzMin = tz * 60;
  const toWall = (jd) => fromJd(jd + tz / 24);
  out.lichun = fmt(toWall(lichun));
  const terms = [];
  for (const yy of [Y - 1, Y, Y + 1]) JIE.forEach((lonT, i) => terms.push({ jd: termJd(yy, lonT), name: JIE_NAME[i] }));
  terms.sort((a, b) => a.jd - b.jd);
  const prev = [...terms].reverse().find((t) => t.jd <= birthJd);
  const next = terms.find((t) => t.jd > birthJd);
  out.prevTerm = `${prev.name} ${fmt(toWall(prev.jd))}`;
  out.nextTerm = `${next.name} ${fmt(toWall(next.jd))}`;
  const nearest = Math.min(birthJd - prev.jd, next.jd - birthJd) * 1440;
  if (nearest < 60) out.notes.push(`절기가 바뀌는 시각과 ${Math.round(nearest)}분 차이예요. 출생 시각이 조금만 달라도 월주(또는 년주)가 달라질 수 있으니 출생 시각을 꼭 다시 확인하세요.`);
  if (known && Math.abs(minutesOfDay - Math.round(minutesOfDay / 120) * 120 + 60) < 1) out.notes.push('시(時)가 바뀌는 경계 시각이에요. 출생 시각을 다시 확인하세요.');
  if (lateZi) out.notes.push(`23:00~24:00 출생이라 학파에 따라 일주가 달라요. 지금은 ${zasi === 'yaja' ? '야자시(일주는 그날, 시주는 다음날 일간 기준)' : '조자시(23시부터 다음날)'}로 계산했어요. 다른 방식은 --zasi ${zasi === 'yaja' ? 'jo' : 'yaja'}로 계산할 수 있어요.`);
  if (!known) out.notes.push('태어난 시각을 몰라서 시주는 계산하지 않았어요.');
  if (Y < 1962 && Y > 1947) out.notes.push('1948~1961년에는 한국 표준시와 서머타임이 여러 번 바뀌었어요. 출생 시각이 그 시기라면 만세력 책이나 앱으로 한 번 더 확인하세요.');
  if (Y >= 1987 && Y <= 1988) out.notes.push('1987~1988년 여름에는 서머타임이 있었어요. 5월 10일~10월 11일 사이 출생이라면 입력한 시각에서 1시간을 뺀 시각으로 다시 계산하세요.');

  // 대운: 양남음녀는 순행, 음남양녀는 역행. 3일 = 1년
  if (opts.gender === 'M' || opts.gender === 'F') {
    const yang = (yearIdx % 10) % 2 === 0;
    const forward = (yang && opts.gender === 'M') || (!yang && opts.gender === 'F');
    const edge = forward ? next : prev;
    const days = Math.abs(edge.jd - birthJd);
    const years = days / 3;
    const startYears = Math.floor(years), startMonths = Math.floor((years - startYears) * 12);
    const luck = [];
    for (let k = 1; k <= 9; k++) luck.push({ age: startYears + (k - 1) * 10, name: pillarName(mod(monthIdx + (forward ? k : -k), 60)) });
    out.luck = { forward, start: `${startYears}세 ${startMonths}개월`, list: luck, from: `${edge.name} ${fmt(toWall(edge.jd))}` };
  }
  out.header = `양력 ${opts.date}${known ? ` ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : ' (시간 모름)'} · 성별 ${opts.gender === 'M' ? '남' : opts.gender === 'F' ? '여' : '모름'}` +
    (known && corr ? ` · 진태양시 보정 ${corr}분` : '') + ` (표준시 UTC${tz >= 0 ? '+' : ''}${tz})`;
  out.yearBase = `${sajuYear}년(입춘 ${out.lichun} 기준)`;
  return out;
}

function format(r) {
  const L = [];
  L.push(r.header, '');
  L.push(`| 기둥 | 간지 | 천간 십성 | 지지(본기) 십성 | 오행 |`, `|---|---|---|---|---|`);
  for (const x of r.rows) L.push(`| ${x.label} | ${x.name} | ${x.stemGod} | ${x.branchGod} | ${x.stemEl}/${x.branchEl} |`);
  L.push('', `일간(나): ${r.dayMaster}`, `오행 분포(8자): ${r.counts}`, `년주 기준 해: ${r.yearBase}`);
  L.push(`직전 절기: ${r.prevTerm} / 다음 절기: ${r.nextTerm}`);
  if (r.luck) {
    L.push('', `대운: ${r.luck.forward ? '순행' : '역행'}, 시작 ${r.luck.start} (기준 ${r.luck.from})`);
    L.push(r.luck.list.map((x) => `${x.age}세 ${x.name}`).join(' → '));
  }
  if (r.notes.length) L.push('', ...r.notes.map((n) => `※ ${n}`));
  return L.join('\n');
}

// 명령줄: saju <YYYY-MM-DD> <HH:MM|모름> [M|F|모름] [--lon 127] [--tz 9] [--zasi yaja|jo] [--no-correction]
function run(args) {
  const pos = [];
  const o = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--lon') o.lon = parseFloat(args[++i]);
    else if (a === '--tz') o.tz = parseFloat(args[++i]);
    else if (a === '--zasi') o.zasi = args[++i];
    else if (a === '--no-correction') o.correction = false;
    else pos.push(a);
  }
  o.date = pos[0];
  o.time = pos[1] && !/^(모름|-|unknown|\?)$/i.test(pos[1]) ? pos[1] : null;
  const g = String(pos[2] || '').toUpperCase();
  o.gender = ['M', '남', '남자'].includes(g) || pos[2] === '남' ? 'M' : ['F', '여', '여자'].includes(g) || pos[2] === '여' ? 'F' : null;
  if ((o.lon !== undefined && !Number.isFinite(o.lon)) || (o.tz !== undefined && !Number.isFinite(o.tz))) throw new Error('--lon, --tz에는 숫자를 적어 주세요.');
  return format(compute(o));
}

module.exports = { compute, format, run, sunLongitude, termJd, jdn, fromJd };
