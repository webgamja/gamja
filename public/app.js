(function () {
  const $ = (id) => document.getElementById(id);
  const els = {
    login: $('login'), loginForm: $('loginForm'), pw: $('pw'), loginErr: $('loginErr'),
    app: $('app'), messages: $('messages'), input: $('input'),
    send: $('sendBtn'), mic: $('micBtn'), newBtn: $('newBtn'),
    menuBtn: $('menuBtn'), menu: $('menu'), sessionInfo: $('sessionInfo'), logout: $('logoutBtn'),
    status: $('status'), statusText: $('statusText'),
  };

  // ---------- 모바일 화면 높이 ----------
  // 키보드를 닫은 뒤에도 화면이 밀려 있거나 높이가 어긋나 입력창이 바닥에 붙는 문제 방지:
  // 실제로 보이는 높이(visualViewport)에 맞추고, 밀린 스크롤은 되돌린다
  const vv = window.visualViewport;
  function fitViewport() {
    document.documentElement.style.setProperty('--app-h', `${Math.round(vv ? vv.height : window.innerHeight)}px`);
    if (window.scrollY) window.scrollTo(0, 0);
  }
  (vv || window).addEventListener('resize', fitViewport);
  fitViewport();
  els.input.addEventListener('blur', () => setTimeout(fitViewport, 150));

  // ---------- 저장소 (localStorage 실패해도 동작) ----------
  // ---------- 기기 간에 같이 쓰는 화면 정보 ----------
  // 크루 이름·아이콘·묶음(cc:crew:·cc:tpl:), ★ 자주 쓰는 크루(cc:favs), 채팅방 이름·📌 고정·방 만든 시각(cc:roomTitle·cc:roomPin·cc:roomMade)은
  // 바뀔 때 감자알에 올리고, 채팅 목록을 불러올 때 다른 기기의 변경을 받아 온다. 항목마다 더 늦은 시각이 이긴다. 그 밖의 값(쓰던 글·글자 크기·테마)은 기기마다 따로 둔다
  const UI_MAP_KEYS = { 'cc:roomTitle': 'roomTitle', 'cc:roomPin': 'roomPin', 'cc:roomMade': 'roomMade' };
  const uiTarget = (k) => { // 로컬 키 → 공유 대상 (공유하지 않는 키는 null)
    if (UI_MAP_KEYS[k]) return { whole: UI_MAP_KEYS[k] };
    if (k === 'cc:favs') return { whole: 'favs', list: true };
    if (k.startsWith('cc:crew:')) return { map: 'crew', key: k.slice(8) };
    if (k.startsWith('cc:tpl:')) return { map: 'tpl', key: k.slice(7) };
    return null;
  };
  let uiApplying = false; // 감자알에서 받은 값을 넣는 중에는 다시 올리지 않는다
  let uiOut = [];
  let uiTimer = 0;
  let uiLastTs = 0;
  function uiDiff(t, old, nv) { // 바뀐 항목만 골라 { map, key, v } 목록으로 (v가 null이면 지운 것)
    const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
    if (t.list) {
      const o = new Set(old || []), n = new Set(nv || []);
      return [...n].filter((x) => !o.has(x)).map((key) => ({ map: t.whole, key, v: true })).concat([...o].filter((x) => !n.has(x)).map((key) => ({ map: t.whole, key, v: null })));
    }
    if (t.whole) {
      const o = old || {}, n = nv || {};
      return Object.keys(n).filter((k) => !same(n[k], o[k])).map((key) => ({ map: t.whole, key, v: n[key] }))
        .concat(Object.keys(o).filter((k) => !(k in n)).map((key) => ({ map: t.whole, key, v: null })));
    }
    return same(old, nv) ? [] : [{ map: t.map, key: t.key, v: nv === undefined ? null : nv }];
  }
  function uiPush(changes) {
    if (!changes.length) return;
    let seen = {};
    try { seen = JSON.parse(localStorage.getItem('cc:uiTs') || '{}'); } catch {}
    for (const c of changes) { uiLastTs = Math.max(Date.now(), uiLastTs + 1); c.ts = uiLastTs; seen[`${c.map}|${c.key}`] = c.ts; }
    try { localStorage.setItem('cc:uiTs', JSON.stringify(seen)); } catch {}
    uiOut.push(...changes);
    clearTimeout(uiTimer);
    uiTimer = setTimeout(uiFlush, 400);
  }
  async function uiFlush() {
    if (!uiOut.length) return;
    const batch = uiOut;
    uiOut = [];
    try { await api('/api/ui-state', { changes: batch }); } catch { uiOut = batch.concat(uiOut); } // 못 올렸으면 다음에 다시 올린다
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) {
      const t = uiApplying ? null : uiTarget(k);
      const old = t ? this.get(k, null) : null;
      try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
      if (t) uiPush(uiDiff(t, old, v));
    },
    del(k) {
      const t = uiApplying ? null : uiTarget(k);
      const old = t ? this.get(k, null) : null;
      try { localStorage.removeItem(k); } catch {}
      if (t) uiPush(uiDiff(t, old, null));
    },
  };
  function uiApplyOne(map, key, v) { // 감자알에서 받은 항목 하나를 이 기기에 넣는다
    if (map === 'crew' || map === 'tpl') { const k = `cc:${map}:${key}`; if (v === null) store.del(k); else store.set(k, v); return; }
    if (map === 'favs') {
      const l = store.get('cc:favs', []);
      if (v === null && l.includes(key)) store.set('cc:favs', l.filter((x) => x !== key));
      else if (v !== null && !l.includes(key)) store.set('cc:favs', [...l, key]);
      return;
    }
    const lk = `cc:${map}`;
    const m = store.get(lk, {});
    if (v === null) delete m[key]; else m[key] = v;
    store.set(lk, m);
  }
  // 반환: 이 기기에 바뀐 게 있는지
  function uiApply(ui) {
    if (!ui) return false;
    let seen = {};
    try { seen = JSON.parse(localStorage.getItem('cc:uiTs') || '{}'); } catch {}
    let changed = false;
    uiApplying = true;
    try {
      for (const [map, entries] of Object.entries(ui)) {
        for (const [key, e] of Object.entries(entries || {})) {
          const id = `${map}|${key}`;
          if (!e || typeof e.ts !== 'number' || e.ts <= (seen[id] || 0)) continue;
          seen[id] = e.ts;
          uiApplyOne(map, key, e.v === undefined ? null : e.v);
          changed = true;
        }
      }
    } finally { uiApplying = false; }
    if (changed) { try { localStorage.setItem('cc:uiTs', JSON.stringify(seen)); } catch {} }
    return changed;
  }
  // 이 기기에만 있던 정보는 처음 한 번 감자알에 올려서 합친다 (이미 감자알에 있는 항목은 감자알 것을 따른다)
  function uiMigrate(ui) {
    let done = false;
    try { done = localStorage.getItem('cc:uiMig') === '1'; } catch { done = true; }
    if (done) return;
    const has = (map, key) => !!(ui && ui[map] && ui[map][key]);
    const ch = [];
    for (const [lk, map] of Object.entries(UI_MAP_KEYS)) for (const [k, v] of Object.entries(store.get(lk, {}))) if (!has(map, k)) ch.push({ map, key: k, v });
    for (const n of store.get('cc:favs', [])) if (!has('favs', n)) ch.push({ map: 'favs', key: n, v: true });
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const t = k && uiTarget(k);
        if (t && t.map && !has(t.map, t.key)) { const v = store.get(k, null); if (v !== null) ch.push({ map: t.map, key: t.key, v }); }
      }
      localStorage.setItem('cc:uiMig', '1');
    } catch {}
    uiPush(ch);
  }
  // 🔔 완료 알림을 누르면 ?project=이름 으로 열린다 → 그 프로젝트로 시작
  const linked = new URLSearchParams(location.search).get('project');
  if (linked !== null) { store.set('cc:project', linked); window.history.replaceState(null, '', location.pathname); }
  let project = store.get('cc:project', '');
  let sessionId = null;
  let history = [];
  let runId = null;
  let abortCtl = null;
  let ttsOn = store.get('cc:tts', false);
  let pollTimer = null;
  let remoteRunId = null; // 다른 기기(또는 끊긴 연결)에서 진행 중인 응답
  let liveView = null; // 그 응답을 보여주는 말풍선
  let pending = []; // 보낼 첨부 이미지 [{ blob, url }]
  const voice = { on: false, phase: '' }; // 🗣 음성 대화 모드 상태
  // 새 글이 쓰이는 동안 화면이 따라 내려갈지. 읽던 곳을 보려고 위로 올리면 멈추고, 맨 아래로 돌아오면 다시 따라간다
  let follow = true;
  const LOCALE = window.GAMJA_I18N.locale; // 화면 언어에 맞는 지역 코드 (날짜 모양·음성 인식·읽기 언어에 쓴다)
  // 그룹 채팅(채팅방 만들기·참여자 초대·내보내기)은 다 만들어 뒀지만 고도화 전이라 화면에서 막아 둔다. 열 때 true로 (서버 server.js의 GROUP_CHAT_ENABLED도 같이)
  const GROUP_CHAT_ENABLED = false;
  let tab = null; // 지금 보는 곳: 'crew'(크루) | 'chat'(채팅 목록) | 'more'(더보기) | null(채팅방 안)
  let lastBox = { dist: 0, ch: 0 }; // 대화 영역의 마지막으로 확인한 "맨 아래까지 남은 거리"와 보이는 높이 (키보드·입력창 높이가 바뀔 때 비교용)
  // 스크롤을 코드로 움직인 직후에 불러서 "지금 상태"를 기억해 둔다. 안 그러면 같은 순간에 높이가 바뀔 때 옛 기억과 비교해 엉뚱하게 보정한다
  function noteBox() {
    const m = els.messages;
    lastBox = { dist: m.scrollHeight - m.scrollTop - m.clientHeight, ch: m.clientHeight };
  }
  let bootId = null; // 이 화면을 받아 올 때 감자알의 켜진 시각 (/api/me)
  let loadSeq = 0;
  let loadedProject = null; // 화면에 그려 둔 대화의 프로젝트 (null = 아직 한 번도 안 그림)

  // ---------- 🔍 대화 글자 크기 ----------
  // 대화 영역의 내용만 커지고 위쪽 줄·입력창은 그대로다. 화면 전체 확대는 막고(viewport·touch-action),
  // 대화 위에서 두 손가락으로 벌리거나 오므리는 동작은 여기서 직접 처리한다
  // 크기는 정해진 단계로만 바뀐다: 50, 75, 100, 125, 150, 200 (%)
  const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const snapZoom = (z) => ZOOM_STEPS.reduce((best, s) => (Math.abs(Math.log(s / z)) < Math.abs(Math.log(best / z)) ? s : best), 1);
  let msgZoom = snapZoom(Number(store.get('cc:zoom', 1)) || 1);
  document.documentElement.style.setProperty('--msg-zoom', String(msgZoom));
  function applyMsgZoom(z) {
    const m = els.messages;
    const anchor = m.scrollHeight ? (m.scrollTop + m.clientHeight / 2) / m.scrollHeight : 1; // 보던 자리를 기억해 두었다가
    msgZoom = snapZoom(z);
    document.documentElement.style.setProperty('--msg-zoom', String(msgZoom));
    if (follow) m.scrollTop = m.scrollHeight; // 맨 아래를 보고 있었다면 그대로 맨 아래
    else m.scrollTop = anchor * m.scrollHeight - m.clientHeight / 2; // 아니면 보던 자리가 가운데 오게
    noteBox();
  }
  let pinch = null;
  const touchDist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  els.messages.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) pinch = { d: touchDist(e.touches), z: msgZoom };
  }, { passive: true });
  els.messages.addEventListener('touchmove', (e) => {
    if (pinch && e.touches.length === 2) {
      e.preventDefault();
      applyMsgZoom(pinch.z * touchDist(e.touches) / pinch.d);
      toast(`🔍 ${Math.round(msgZoom * 100)}%`); // 확대·축소하는 동안 지금 크기를 보여 준다
    }
  }, { passive: false });
  const endPinch = (e) => { if (pinch && e.touches.length < 2) { pinch = null; store.set('cc:zoom', msgZoom); } };
  els.messages.addEventListener('touchend', endPinch, { passive: true });
  els.messages.addEventListener('touchcancel', endPinch, { passive: true });
  document.addEventListener('gesturestart', (e) => e.preventDefault()); // iOS Safari: 화면 전체 확대 막기

  // ---------- 테마 (auto / light / dark) — ⚙️ 설정 → 소리·화면에서 고른다 ----------
  function applyTheme(t) {
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    syncBarColor();
  }
  // 감자 앱 안에서는 폰의 위쪽 상태 표시줄 색을 화면의 위쪽 줄 색에 맞춘다
  function syncBarColor() {
    try {
      const c = getComputedStyle(document.documentElement).getPropertyValue('--bar').trim();
      if (c && window.GamjaApp) window.GamjaApp.setBarColor(c);
    } catch { /* 앱 밖이거나 지원 안 함 */ }
  }
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncBarColor);
  let theme = store.get('cc:theme', 'auto');
  applyTheme(theme);

  // ---------- 바텀시트: 확인·알림 공통 (브라우저 기본 alert/confirm 대신) ----------
  // 가볍게 알릴 일은 toast, 결정하거나 되돌릴 수 없는 일은 시트. gSheet(...)는 true(확인)/false(취소·바깥을 누름·뒤로 가기)를 돌려준다
  //   gSheet({ title, message, ok, cancel, danger }) / gAlert(message, title) — 확인 버튼 하나만 있는 알림
  let gsOpen = null; // 지금 열려 있는 시트 { bg, close }
  //   field: { value, placeholder, readonly } — 글칸이 있는 시트. 입력받는 시트(readonly 아님)는 확인하면 글자를, 취소하면 null을 돌려준다.
  //   읽기 전용 글칸은 복사할 글을 보여 줄 때 쓴다 (gCopy)
  function gSheet({ title = '', message = '', ok = '', cancel = '', danger = false, alertOnly = false, field = null } = {}) {
    const T = window.GAMJA_I18N.t;
    return new Promise((resolve) => {
      if (gsOpen) gsOpen.close(false);
      const bg = document.createElement('div');
      bg.className = 'gs-bg';
      bg.innerHTML = '<div class="gs" role="dialog" aria-modal="true">' + (title ? '<h2></h2>' : '') + (message ? '<p></p>' : '') +
        (field ? '<textarea class="gs-field" rows="2" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>' : '') +
        `<div class="gs-btns"><button class="gs-ok${danger ? ' danger' : ''}" type="button"></button>${alertOnly ? '' : '<button class="gs-cancel" type="button"></button>'}</div></div>`;
      if (title) bg.querySelector('h2').textContent = title;
      if (message) bg.querySelector('p').textContent = message;
      const input = field ? bg.querySelector('.gs-field') : null;
      if (input) {
        input.value = field.value || '';
        input.placeholder = field.placeholder || '';
        input.readOnly = !!field.readonly;
        input.rows = field.readonly ? Math.min(6, Math.max(2, Math.ceil(input.value.length / 28))) : 1;
      }
      const asks = !!input && !field.readonly; // 글을 입력받는 시트
      bg.querySelector('.gs-ok').textContent = ok || T('sheet.ok');
      const cancelBtn = bg.querySelector('.gs-cancel');
      if (cancelBtn) cancelBtn.textContent = cancel || T('sheet.cancel');
      const close = (v) => {
        if (!bg.isConnected || bg.classList.contains('out')) return;
        bg.classList.add('out');
        setTimeout(() => bg.remove(), 160);
        if (gsOpen && gsOpen.bg === bg) gsOpen = null;
        resolve(v);
      };
      const accept = () => close(asks ? input.value : true);
      const dismiss = () => close(asks ? null : false);
      bg.addEventListener('click', (e) => {
        if (e.target === bg) dismiss();
        else if (e.target.closest('.gs-ok')) accept();
        else if (e.target.closest('.gs-cancel')) dismiss();
      });
      if (asks) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); accept(); } });
      document.body.appendChild(bg);
      gsOpen = { bg, close: (v) => (asks ? close(null) : close(v)) };
      if (input) setTimeout(() => { input.focus(); input.select(); }, 60); // 복사할 글은 미리 전부 선택해 둔다
    });
  }
  const gAlert = (message, title = '') => gSheet({ title, message, alertOnly: true });
  // 복사할 글을 보여 주는 시트: 복사가 막힌 환경에서 글을 꾹 눌러 복사할 수 있게 (예전의 prompt 대신)
  const gCopy = (title, text, message = '') => gSheet({ title, message, ok: window.GAMJA_I18N.t('sheet.close'), alertOnly: true, field: { value: text, readonly: true } });
  // 브라우저 기본 alert 대신 같은 시트를 쓴다 (이 화면 안의 alert(...) 호출이 모두 시트로 바뀐다)
  function alert(message) { return gAlert(String(message)); }

  // ---------- API ----------
  async function api(path, body) {
    const r = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    if (r.status === 401 && path !== '/api/login') { showLogin(); throw new Error('unauthorized'); }
    const data = await r.json().catch(() => ({}));
    if (data.code === 'lan-off') connPing(); // 폰에서 외부 접속을 껐다 → 안내줄을 바로 보여 준다
    if (!r.ok) throw new Error(data.error || r.statusText);
    return data;
  }

  function showLogin() {
    hideTabs();
    firstOpen = true; // 다시 로그인하면 채팅 목록부터
    els.app.classList.add('hidden');
    els.login.classList.remove('hidden');
    setTimeout(() => els.pw.focus(), 50);
  }
  let firstOpen = true;
  let deepLink = linked !== null; // 알림을 눌러 특정 크루로 열렸는지 (한 번만)
  async function showApp() {
    // 새로고침·첫 접속이 탭 화면(채팅 목록·크루·더보기)으로 시작할 때는, 불러오는 동안 뒤에 있는 채팅방이 잠깐 보이지 않게 가려 둔다
    let startTab = null;
    try { startTab = sessionStorage.getItem('cc:tab'); } catch { /* 저장소를 못 쓰면 채팅 목록 */ }
    if (firstOpen && !deepLink && startTab !== 'room') document.body.classList.add('in-tab');
    els.login.classList.add('hidden');
    els.app.classList.remove('hidden');
    await loadProjects();
    if (!els.input.value) { els.input.value = getDraft(project); autoGrow(); } // 새로고침해도 쓰던 글이 남아 있다
    loadConversation(); // 채팅방 내용은 미리 불러 둔다
    // 접속하면 항상 채팅 목록으로. 단, 알림을 눌러 특정 크루로 들어왔거나, 새로고침(감자알 업데이트 등)이면 있던 곳을 그대로 유지한다
    if (!firstOpen) return;
    firstOpen = false;
    let last = null;
    try { last = sessionStorage.getItem('cc:tab'); } catch { /* 저장소를 못 쓰면 채팅 목록 */ }
    if (deepLink || last === 'room') { deepLink = false; showTab(null); }
    else showTab(last === 'crew' || last === 'more' ? last : 'chat');
  }

  els.loginForm.onsubmit = async (e) => {
    e.preventDefault();
    els.loginErr.textContent = '';
    try {
      await api('/api/login', { password: els.pw.value });
      els.pw.value = '';
      showApp();
    } catch (err) {
      els.loginErr.textContent = err.message;
    }
  };
  els.logout.onclick = async () => {
    await api('/api/logout', {}).catch(() => {});
    els.menu.classList.add('hidden');
    showLogin(); // (열려 있던 탭 화면도 함께 닫힌다)
  };

  // ---------- 크루 선택 (안쪽 이름은 프로젝트 폴더) ----------
  const ROOT_NAME = '🥔 감자 톡톡'; // 특정 크루를 고르기 전의 기본 대화 (~/projects 전체)
  // 이름 끝의 "크루"는 화면에서 뺀다 (너무 크루크루 하지 않게). 가져온 크루의 옛 이름에도 똑같이 적용한다
  const stripCrew = (s) => String(s || '').replace(/\s*크루$/, '');
  // 목록에 보이는 이름: 템플릿·가져온 크루는 "🍽️ 메뉴판·가격표", 직접 만든 폴더는 "📁 폴더이름"
  const crewOf = (n) => String(n || '').split('@')[0]; // 채팅방 번호("크루@번호")에서 크루 이름만. 첫 방은 크루 이름 그대로
  function crewLabel(room) {
    const p = crewOf(room);
    const meta = store.get(`cc:crew:${p}`, null) || window.GAMJA_TEMPLATES.AGENTS.find((a) => a.id === store.get(`cc:tpl:${p}`, ''));
    return meta ? `${meta.icon} ${stripCrew(meta.name)}` : `📁 ${p}`;
  }
  let projectList = []; // 크루(프로젝트 폴더) 이름들
  // 왼쪽 위 버튼: 지금 있는 곳을 보여 준다
  function updateHomeBtn() {
    const members = roomMembers(project);
    $('homeBtn').textContent = `← ${crewParts(members.length > 1 ? members[0] : project).icon} ${roomText(project)}`; // ←를 누르면 채팅 목록으로
    $('madeBtn').classList.toggle('hidden', !project || isGone(project)); // 결과물은 크루 방에서만
    applyGone();
  }
  // 채팅방의 참여자(크루) 목록. 채팅 목록에서 받아 온 정보를 쓰고, 아직 모르면 그 방의 크루 한 명으로 본다
  const roomMembers = (n) => ((chats.find((c) => c.name === n) || {}).members || [crewOf(n)]);
  // 삭제된 크루의 방: 입력창과 대화 관련 메뉴를 끈다 (대화를 이어가려면 크루를 복구해야 한다)
  // 그룹 방: 입력창에 @이름 안내를 보이고, 사진 첨부와 대화 압축은 쓰지 않는다
  function applyGone() {
    const T = window.GAMJA_I18N.t;
    const gone = isGone(project);
    const group = !gone && roomMembers(project).length > 1;
    const off = gone || (group && !GROUP_CHAT_ENABLED); // 그룹 채팅을 막아 둔 동안 이미 있던 그룹방은 입력을 끈다
    $('composerBox').classList.toggle('off', off);
    els.input.disabled = off;
    els.input.placeholder = gone ? T('gone.placeholder') : off ? T('room.groupOff') : group ? T('room.groupPh') : '메시지 입력';
    if (off) els.send.disabled = true; else updateSendState();
    for (const id of ['compactBtn', 'newBtn', 'ttsBtn']) $(id).classList.toggle('hidden', gone);
    $('compactBtn').classList.toggle('hidden', gone || group);
    $('roomCompactNote').classList.toggle('hidden', gone || group);
    $('roomActions').classList.toggle('hidden', gone); // 삭제된 크루의 방에서는 대화 관리를 보여 주지 않는다
    $('attachBtn').classList.toggle('hidden', gone || group);
    if (!gone && !chats.some((c) => c.name === project)) refreshChats().then(() => { if (chats.some((c) => c.name === project)) applyGone(); }); // 참여자 정보를 아직 못 받았으면 받은 뒤에 다시 맞춘다
  }
  async function loadProjects() {
    const { projects } = await api('/api/projects');
    projectList = projects;
    if (project && !isGone(project) && crewOf(project) && !projects.includes(crewOf(project))) { // 보던 크루가 없어졌으면(삭제 등) 감자 톡톡으로
      const gone = project;
      project = '';
      swapRoomInput(gone, '');
      const drafts = getDrafts();
      delete drafts[gone];
      store.set('cc:drafts', drafts);
    }
    updateHomeBtn();
    if (!$('homePanel').classList.contains('hidden')) renderHome();
  }
  async function switchProject(name) {
    const prev = project;
    project = name;
    store.set('cc:project', project);
    swapRoomInput(prev, name);
    if (tab === null) markOpened(name); // (방에 들어가는 경우만: 이름 바꾸기·삭제 뒤의 전환은 제외)
    await loadProjects();
    loadConversation();
  }

  // ---------- 🏠 홈 화면: 크루 목록(누르면 그 방) · ⚙️ 크루 설정 · ＋ 크루 추가 ----------
  const homeEl = $('homePanel');
  const homeBody = $('homeBody');
  // 홈 화면의 아이콘: 이모지 대신 깔끔한 선 아이콘 (글자색을 따라가서 밝게·어둡게 모두 자연스럽다)
  const ICON_SHARE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="M8 7l4-4 4 4"/><path d="M5 12v6a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-6"/></svg>';
  const ICON_SETTINGS = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'; // 톱니바퀴 (Feather 아이콘, MIT)
  // 자주 쓰는 크루(★): 이 기기에 저장. 위쪽에 따로 모아 보여 준다
  const ICON_STAR = '<svg viewBox="0 0 24 24" width="22" height="22" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.2l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.5l6-.8z"/></svg>';
  const getFavs = () => store.get('cc:favs', []).filter((n) => n === '' || projectList.includes(n));
  function toggleFav(name) {
    const favs = store.get('cc:favs', []);
    store.set('cc:favs', favs.includes(name) ? favs.filter((n) => n !== name) : [...favs, name]);
    renderHome();
  }
  // ---------- 크루 탭: 카톡의 친구 목록처럼 (검색 · ★ 자주 쓰는 크루 · 묶음별 내 크루 · 스토어 추천) ----------
  let crewQuery = ''; // 검색어
  // 크루의 이름·아이콘·소개는 템플릿이나 가져올 때 저장해 둔 정보에서 가져오고, 직접 만든 폴더는 폴더 이름만 있다
  const crewMeta = (room) => { const p = crewOf(room); return store.get(`cc:crew:${p}`, null) || AGENTS.find((a) => a.id === store.get(`cc:tpl:${p}`, '')) || null; };
  const GROUP_HOME = { id: 'home', icon: '🏠', name: '기본' };
  const GROUP_ETC = { id: 'etc', icon: '📁', name: '직접 만든 크루' };
  const crewGroup = (n) => {
    if (n === '') return GROUP_HOME;
    const m = crewMeta(n);
    return (m && GROUPS.find((g) => g.id === m.group)) || GROUP_ETC;
  };
  const crewBlurb = (n) => (n === '' ? '폴더와 상관없이 무엇이든 물어보는 기본 대화' : (crewMeta(n) && crewMeta(n).blurb) || crewGroup(n).name);
  const getShut = () => store.get('cc:crewShut', {}); // 접어 둔 묶음
  function toggleGroup(id) {
    const shut = getShut();
    shut[id] = !shut[id];
    store.set('cc:crewShut', shut);
    renderCrewList();
  }
  function renderHome() {
    // 머리(제목·검색·＋)는 한 번만 그려서 검색어를 치는 동안 입력칸이 사라지지 않게 한다
    if (!$('crewListBox')) {
      homeBody.innerHTML =
        '<div class="tab-head"><h1 class="ui-title">크루</h1><div class="tab-acts">' +
        '<button id="crewSearchBtn" type="button" aria-label="검색">🔎</button><button id="crewAddBtn" type="button" aria-label="크루 추가">＋</button></div></div>' +
        '<div id="crewSearchRow" class="fr-search hidden"><input id="crewSearch" type="search" placeholder="크루 이름·소개 검색" autocomplete="off" spellcheck="false"></div>' +
        '<div id="crewListBox"></div>';
    }
    renderCrewList();
    loadTrash(); // 삭제한 크루가 있으면 맨 아래에 "삭제한 크루 복구하기"가 나온다
  }
  // "직접 만들기"와 "코드로 가져오기" 버튼: 크루 탭과 추천 크루 화면이 똑같은 모양을 쓴다
  function makeButtonsHtml() {
    const T = window.GAMJA_I18N.t;
    return `<button class="fr-join fr-make" data-custom="1" type="button">${escapeHtml(T('crew.make'))}<span>${escapeHtml(T('crew.makeSub'))}</span></button>` +
      `<button class="fr-join" data-import="1" type="button">${escapeHtml(T('crew.import'))}<span>${escapeHtml(T('crew.importSub'))}</span></button>`;
  }
  function renderCrewList() {
    const box = $('crewListBox');
    if (!box) return;
    const favs = getFavs();
    const rowHtml = (n) => {
      const { icon, text } = crewParts(n);
      return `<button class="fr-row${n === '' ? ' me' : ''}" data-crew="${escapeHtml(n)}"><i class="fr-av">${escapeHtml(icon)}</i>` +
        `<span class="fr-mid"><b>${escapeHtml(text)}</b><small>${escapeHtml(crewBlurb(n))}</small></span></button>`;
    };
    const list = (names) => `<div class="fr-list">${names.map(rowHtml).join('')}</div>`;
    const all = ['', ...projectList];
    let html = '';
    if (crewQuery) {
      const q = crewQuery.toLowerCase();
      const hit = all.filter((n) => `${crewParts(n).text} ${crewBlurb(n)}`.toLowerCase().includes(q));
      html = hit.length ? `<div class="fr-sec"><span>검색 결과 ${hit.length}</span></div>${list(hit)}` : '<p class="empty">찾는 크루가 없어요.</p>';
    } else {
      // 카톡 친구 목록처럼: 맨 위 감자 톡톡(내 프로필 자리) → ★ 자주 쓰는 크루 → 묶음별 제목 줄과 그 아래 크루 (접고 펼침)
      html += `<div class="fr-list">${rowHtml('')}</div>`;
      if (favs.length) html += `<div class="fr-sec"><span><i class="fr-star">★</i> 자주 쓰는 크루 ${favs.length}</span></div>${list(favs)}`;
      const groups = [...GROUPS, GROUP_ETC];
      const shut = getShut();
      for (const g of groups) {
        const names = projectList.filter((n) => crewGroup(n).id === g.id);
        if (!names.length) continue;
        html += `<button class="fr-grp" data-grp="${g.id}"><span>${escapeHtml(g.name)} ${names.length}</span><small>${shut[g.id] ? '▸' : '▾'}</small></button>`;
        if (!shut[g.id]) html += list(names);
      }
      // 크루 스토어 추천: 아직 안 가진 템플릿
      const rec = AGENTS.filter((a) => !projectList.includes(a.folder)).slice(0, 8);
      if (rec.length) {
        html += '<div class="fr-sec"><span>추천 크루</span><button class="fr-more" data-store="1" type="button">전체 보기 ›</button></div><div class="fr-shelf">' +
          rec.map((a) => `<div class="fr-card"><i class="fr-av big">${escapeHtml(a.icon)}</i><b>${escapeHtml(a.name)}</b><small>${escapeHtml(a.blurb)}</small>` +
            `<button class="fr-pill" data-add="${escapeHtml(a.id)}" type="button">추가</button></div>`).join('') + '</div>';
      }
      // 직접 만들기는 크루 탭에서 바로 보이게 둔다 (추천 크루에도 있다)
      html += makeButtonsHtml();
      // 삭제한 크루가 있을 때만: 30일 안에 되살리거나 완전히 지운다
      if (trashItems.length) html += `<button class="fr-join" data-trash="1" type="button">${escapeHtml(window.GAMJA_I18N.t('trash.row'))}<span>${trashItems.length} ›</span></button>`;
    }
    box.innerHTML = html;
  }
  // ---------- 아래 메뉴(GNB) · 탭 화면: 크루 / 채팅 / 더보기, 그리고 채팅방 ----------
  const chatEl = $('chatPanel');
  const chatBody = $('chatBody');
  const gnbEl = $('gnb');
  let chats = []; // 채팅 목록 (서버가 크루별 마지막 말·작업 중·안 읽음을 알려 준다)
  let chatTimer = 0;
  // 더보기 안의 하위 화면에서는 아래 메뉴를 숨긴다 (글을 쓸 때 키보드 위에 떠 있지 않게)
  let moreLoading = false; // 더보기 화면을 불러오는 동안: 아래 메뉴를 숨기지 않고, 보던 탭 화면을 그대로 둔다 (뒤의 채팅방이 비쳐 보이지 않게)
  function updateGnb() {
    const sub = tab === 'more' && !moreLoading && $('setList').classList.contains('hidden');
    gnbEl.classList.toggle('hidden', !tab || sub);
    for (const b of gnbEl.querySelectorAll('button')) b.classList.toggle('on', b.dataset.tab === tab);
  }
  function hideTabs() {
    tab = null;
    document.body.classList.remove('in-tab');
    document.documentElement.classList.remove('pre-tab');
    clearInterval(chatTimer);
    homeEl.classList.add('hidden');
    chatEl.classList.add('hidden');
    settingsEl.classList.add('hidden');
    gnbEl.classList.add('hidden');
    sheetEl.classList.add('hidden');
  }
  // name: 'crew' | 'chat' | 'more' | null(채팅방으로 들어가기)
  function showTab(name) {
    const keepPanel = [homeEl, chatEl, settingsEl].find((el) => !el.classList.contains('hidden')); // 더보기로 갈 때 보던 탭 화면 (설정을 불러온 뒤에 바꾼다)
    hideTabs();
    moreLoading = false;
    els.menu.classList.add('hidden');
    tab = name;
    document.body.classList.toggle('in-tab', name !== null); // 탭 화면이 덮고 있는 동안 뒤의 채팅방은 보이지 않게 (불러오는 사이 비쳐 보이던 깜빡임 방지)
    document.documentElement.classList.toggle('pre-tab', name !== null);
    try { sessionStorage.setItem('cc:tab', name || 'room'); } catch { /* 새로고침해도 있던 곳으로 돌아오기 위한 것 */ }
    if (name === 'more' && keepPanel) { keepPanel.classList.remove('hidden'); moreLoading = true; }
    if (name === null) { markSeen(); return; }
    if (name === 'crew') { homeEl.classList.remove('hidden'); loadProjects().catch(() => {}).then(renderHome); }
    else if (name === 'chat') { chatKey = ''; chatEl.classList.remove('hidden'); }
    else if (name === 'more') openSettings();
    refreshChats();
    chatTimer = setInterval(refreshChats, 4000); // 아래 메뉴의 안 읽음 숫자와 채팅 목록을 따라간다
    updateGnb();
  }
  gnbEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b && b.dataset.tab !== tab) showTab(b.dataset.tab);
  });
  $('homeBtn').onclick = () => showTab('chat'); // 채팅방의 ← : 채팅 목록으로

  // 안 읽음: 크루마다 "마지막으로 본 답변 시각"을 이 기기에 기억해 두고, 그 뒤에 온 답변 수를 센다
  function markSeen() {
    const lastBot = [...history].reverse().find((m) => m.role === 'bot' && m.ts);
    if (!lastBot) return;
    const seen = store.get('cc:seen', {});
    if (seen[project] === lastBot.ts) return; // 이미 읽은 걸로 알려 둔 답이면 다시 알리지 않는다
    seen[project] = lastBot.ts;
    store.set('cc:seen', seen);
    api('/api/seen', { seen: { [project]: lastBot.ts } }).catch(() => {}); // 감자알에도 알려서 다른 기기의 안 읽음 숫자도 줄어들게 한다
  }
  // 삭제된 크루의 방은 이름이 "~보관이름" 꼴이다 (크루 폴더 이름에는 ~를 쓸 수 없어 겹치지 않는다)
  const isGone = (n) => typeof n === 'string' && n.startsWith('~');
  const goneName = (n) => { const id = n.slice(1); try { return decodeURIComponent(id.slice(id.indexOf('__') + 2)); } catch { return id; } };
  const crewParts = (n) => {
    // 감자 톡톡의 다른 채팅방("@번호")도 감자 톡톡으로 보인다 (예전에는 이름 없이 폴더 아이콘만 나왔다)
    const label = !isGone(n) && crewOf(n) === '' ? ROOT_NAME : crewLabel(isGone(n) ? goneName(n) : n);
    const sp = label.indexOf(' ');
    return sp > 0 ? { icon: label.slice(0, sp), text: label.slice(sp + 1) } : { icon: '🥔', text: label };
  };
  function chatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts), now = new Date();
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 86400000);
    if (diff <= 0) return d.toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' });
    if (diff === 1) return window.GAMJA_I18N.lang === 'en' ? 'Yesterday' : '어제';
    if (diff < 7) return d.toLocaleDateString(LOCALE, { weekday: 'long' });
    return d.toLocaleDateString(LOCALE, { month: 'long', day: 'numeric' });
  }
  // 채팅 목록의 한 줄 미리보기: 마크다운 기호를 빼고, 감자 아이콘이 없는 이모지는 아예 뺀다 (있는 건 아이콘으로 바뀌어 보인다)
  const plain = (s) => String(s || '').replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>|]/g, '')
    .replace(/\p{Extended_Pictographic}[︎️]?/gu, (m) => (window.GAMJA_ICONS.iconFor(m) ? m : ''))
    .replace(/\s+/g, ' ').trim();
  function unreadOf(c, seen) {
    if (!(c.name in seen)) return 0;
    return c.botTs.filter((t) => t > seen[c.name]).length;
  }
  async function refreshChats() {
    let d;
    try { d = await api('/api/chats'); } catch { return; }
    chats = d.chats || [];
    // 처음 보는 크루는 지금까지의 답을 모두 읽은 것으로 시작한다 (처음부터 안 읽음이 쌓여 보이지 않게)
    // 크루 이름·★·채팅방 이름·고정·순서도 기기마다 달라지지 않게 감자알의 것을 받아 오고, 이 기기에서 바꾼 것은 올린다
    const uiChanged = uiApply(d.ui);
    uiMigrate(d.ui || {});
    uiFlush();
    if (uiChanged) { updateHomeBtn(); if (!$('homePanel').classList.contains('hidden')) renderHome(); }
    // 읽음 기록은 감자알과 모든 기기가 같이 쓴다: 감자알의 기록과 이 기기의 기록 중 더 늦은 시각을 따른다
    const seen = store.get('cc:seen', {});
    const shared = d.seen || {};
    let changed = false;
    for (const [room, ts] of Object.entries(shared)) if (ts > (seen[room] || 0)) { seen[room] = ts; changed = true; }
    for (const c of chats) if (!(c.name in seen)) { seen[c.name] = Math.max(0, ...c.botTs); changed = true; } // 처음 보는 크루
    const up = {}; // 이 기기가 더 늦게 읽은 방은 감자알에 올린다 (처음 한 번 기존 기록을 합치는 것도 같은 길)
    for (const [room, ts] of Object.entries(seen)) if (ts > (shared[room] || 0)) up[room] = ts;
    if (Object.keys(up).length) api('/api/seen', { seen: up }).catch(() => {});
    if (changed) store.set('cc:seen', seen);
    const total = chats.reduce((n, c) => n + unreadOf(c, seen), 0);
    const cnt = $('gnbCnt');
    cnt.textContent = total > 9 ? '9+' : String(total);
    cnt.classList.toggle('hidden', !total);
    // 바뀐 게 없으면 다시 그리지 않는다 (스크롤·눌림 상태가 흐트러지지 않게). 시간 글자는 분이 바뀔 때 갱신된다
    const key = `${JSON.stringify(chats)}|${JSON.stringify(seen)}|${JSON.stringify(store.get('cc:roomMade', {}))}|${JSON.stringify(draftRooms())}|${JSON.stringify(getRoomTitles())}|${JSON.stringify(getRoomPins())}|${new Date().getMinutes()}`;
    if (tab === 'chat' && key !== chatKey) { chatKey = key; renderChats(seen); }
  }
  let chatKey = ''; // 마지막으로 그린 채팅 목록의 내용 (같으면 다시 그리지 않는다)
  // 채팅방이 "만들어진" 때: 크루의 채팅하기로 처음 방에 들어간 순간 (말을 하기 전이라도 그때 맨 위에 올라온다).
  // 이미 만들어진 방에 다시 들어갔다 나오는 것은 순서를 바꾸지 않는다
  function markOpened(name) {
    const made = store.get('cc:roomMade', {});
    if (made[name]) return;
    made[name] = Date.now();
    store.set('cc:roomMade', made);
  }
  function renderChats(seen = store.get('cc:seen', {})) {
    // 채팅방이 있는 크루만 보여 준다: 말한 적이 있거나 방이 만들어진 크루 (감자 톡톡은 항상).
    // 맨 위로 올라오는 기준은 두 가지뿐: ① 대화가 오갔을 때(마지막 대화 시각) ② 방이 만들어졌을 때. 더 최근인 방이 위
    const opened = store.get('cc:roomMade', {});
    const drafts = Object.fromEntries(draftRooms().map((n) => [n, 1])); // 쓰던 글이나 붙여 둔 사진이 있는 방 (연필 표시)
    const last = (c) => Math.max(c.ts || 0, opened[c.name] || 0);
    // 채팅방 설정에서 📌 고정한 방은 목록 맨 위에 둔다 (크루 탭의 ★ 자주 쓰는 크루와는 별개). 고정끼리, 나머지끼리는 각각 최근 순. 고정한 방은 대화 전에도 보인다
    const pinned = new Set(Object.keys(getRoomPins()));
    // 감자 톡톡(기본 대화방)은 지울 수 없는 방이라 처음 접속한 이용자에게도 늘 보인다. 다른 크루는 대화가 있거나 방을 열었거나 고정했을 때만 보인다
    const rooms = chats.filter((c) => c.archive || c.extra || c.name === '' || c.ts || opened[c.name] || pinned.has(c.name))
      .filter((c) => GROUP_CHAT_ENABLED || !(c.members && c.members.length > 1)); // 그룹 채팅을 막아 둔 동안은 그룹방을 목록에서 숨긴다
    const rowOf = (c) => {
      const icon = crewParts(c.members && c.members.length > 1 ? c.members[0] : c.name).icon; // 그룹 방은 첫 참여자의 아이콘
      const text = roomText(c.name);
      const unread = unreadOf(c, seen);
      const preview = c.archive ? `${window.GAMJA_I18N.t('chat.deletedCrew')} · ${plain(c.last && c.last.text)}` // 삭제된 크루의 남은 대화: 흐리게
        : c.running ? `작업 중… ${plain(c.status)}`.trim()
        : c.last ? `${c.last.role === 'user' ? '나: ' : ''}${plain(c.last.text)}` : '대화를 시작해 보세요';
      return `<button class="cl-row${c.archive ? ' gone' : ''}" data-go="${escapeHtml(c.name)}"${c.archive ? ` data-archive="${escapeHtml(c.archive)}"` : ''}><i class="cl-av">${escapeHtml(icon)}</i>` +
        `<span class="cl-mid"><b>${escapeHtml(text)}</b><small${c.running ? ' class="run"' : ''}>${escapeHtml(preview)}</small></span>` +
        `<span class="cl-end"><span>${escapeHtml(chatTime(c.ts))}</span>` +
        // 아래 줄: 쓰던 글이 있으면 연필 아이콘, 작업 중이면 노란 점, 안 읽은 답이 있으면 빨간 숫자
        `<span class="cl-flags">${drafts[c.name] ? '<i class="cl-pen" title="쓰던 글이 있어요">✏️</i>' : ''}` +
        `${c.running ? '<span class="cl-dot"></span>' : unread ? `<span class="cl-badge">${unread > 9 ? '9+' : unread}</span>` : ''}</span></span></button>`;
    };
    // 크루 탭과 같은 모양: 상자 없이 줄만, "★ 고정"과 "최근" 제목 줄로 나눈다
    const byRecent = (a, b) => (last(b) - last(a)) || (a.name < b.name ? -1 : 1);
    const pinRooms = rooms.filter((c) => pinned.has(c.name)).sort(byRecent);
    const restRooms = rooms.filter((c) => !pinned.has(c.name)).sort(byRecent);
    let html = '';
    if (pinRooms.length) html += `<div class="cl-hd first"><span><i class="fr-star">★</i> 고정 ${pinRooms.length}</span></div><div class="cl-list">${pinRooms.map(rowOf).join('')}</div>`;
    if (restRooms.length) html += `<div class="cl-hd${pinRooms.length ? '' : ' first'}"><span>최근 ${restRooms.length}</span></div><div class="cl-list">${restRooms.map(rowOf).join('')}</div>`;
    chatBody.innerHTML = '<div class="tab-head"><h1 class="ui-title">채팅</h1>' +
      '<div class="tab-acts"><button id="chatNewBtn" type="button" aria-label="새 채팅">＋</button></div></div>' + (html || '<p class="empty">아직 대화가 없어요.<br>크루 탭에서 크루를 골라 말을 걸어 보세요.</p>');
  }
  // 채팅방 이름: 직접 정한 이름이 있으면 그것, 없으면 크루 이름 (이 기기에 저장)
  const getRoomTitles = () => store.get('cc:roomTitle', {});
  const roomText = (n) => { const t = getRoomTitles(); return t[n] || (isGone(n) && t[goneName(n)]) || crewParts(n).text; }; // 삭제된 크루의 방은 지워지기 전 방 번호로 정해 둔 이름도 찾는다
  // 방을 목록에서 지울 때 같이 비우는 이 기기의 기록: 만들어진 시각, 쓰던 글, 정해 둔 이름
  function forgetRoom(name) {
    const made = store.get('cc:roomMade', {}); delete made[name]; store.set('cc:roomMade', made);
    const drafts = getDrafts(); if (drafts[name]) { delete drafts[name]; store.set('cc:drafts', drafts); }
    const titles = getRoomTitles(); if (titles[name]) { delete titles[name]; store.set('cc:roomTitle', titles); }
    const pins = getRoomPins(); if (pins[name]) { delete pins[name]; store.set('cc:roomPin', pins); }
    chatKey = '';
  }
  const getRoomPins = () => store.get('cc:roomPin', {}); // 채팅방 설정에서 위에 고정한 방 { 방이름: true }
  // (방을 지우는 건 채팅방 설정의 "채팅방 삭제"로만 한다)
  chatBody.addEventListener('click', (e) => {
    if (e.target.closest('#chatNewBtn')) return openNewChat();
    const go = e.target.closest('[data-go]');
    if (go) selectProject(go.dataset.go);
  });
  // 보던 방의 답을 받는 연결만 끊는다. 감자알의 작업은 그대로 계속되고, 그 방에 다시 들어가면 이어서 보여 준다
  function detachRun() {
    if (abortCtl) abortCtl.abort();
    runId = null;
    abortCtl = null;
    remoteRunId = null;
    clearTimeout(pollTimer);
    setRunning(false);
  }
  function selectProject(name) {
    // 다른 방으로 옮길 때: 작업 중이어도 막지 않는다 (사진을 올리는 중일 때만 잠깐 기다린다)
    if (name !== project && runId === 'pending') return alert('사진을 올리는 중이에요. 올리기가 끝난 뒤에 옮겨 주세요.');
    if (name !== project && (runId || remoteRunId)) detachRun();
    if (name !== project) { olderQueue = []; showLoading(); } // 다른 방으로 갈 때 이전 방의 대화가 비치지 않게 먼저 비우고 "불러오는 중" 표시를 보여 준다 (새 방의 대화는 곧 불러와서 그린다)
    showTab(null); // 채팅방으로 들어간다 (아래 메뉴는 사라진다)
    markOpened(name);
    if (name === project) {
      // 같은 방이면 그 사이 도착한 답을 불러오고, 안 읽은 답이 있었으면 맨 아래로 간다
      const before = (chats.find((c) => c.name === name) || { botTs: [] }).botTs.filter((t) => t > (store.get('cc:seen', {})[name] || 0)).length;
      loadConversation().then(() => { if (before) { scrollBottom(true); markSeen(); } });
      return;
    }
    stopSpeaking();
    const prev = project;
    project = name;
    store.set('cc:project', project);
    swapRoomInput(prev, name);
    updateHomeBtn();
    loadConversation();
  }
  homeBody.addEventListener('click', (e) => {
    const t = (sel) => e.target.closest(sel);
    if (t('[data-crew]')) return openSheet(t('[data-crew]').dataset.crew);
    if (t('[data-grp]')) return toggleGroup(t('[data-grp]').dataset.grp);
    if (t('[data-add]')) return addStoreCrew(t('[data-add]').dataset.add);
    if (t('#crewSearchBtn')) {
      const row = $('crewSearchRow');
      row.classList.toggle('hidden');
      if (row.classList.contains('hidden')) { crewQuery = ''; $('crewSearch').value = ''; renderCrewList(); } else $('crewSearch').focus();
      return;
    }
    if (t('#crewAddBtn') || t('[data-store]')) return openAgents();
    if (t('[data-import]')) return openAgents('__import');
    if (t('[data-custom]')) { customIcon = '🙋'; return openAgents('__custom'); }
    if (t('[data-trash]')) return openTrash();
  });
  homeBody.addEventListener('input', (e) => {
    if (e.target.id === 'crewSearch') { crewQuery = e.target.value.trim(); renderCrewList(); }
  });

  // ---------- 크루 프로필 창: 크루를 누르면 곧바로 채팅하지 않고 이 창이 뜬다 (채팅하기 · 공유 · 설정 · ★) ----------
  const sheetEl = $('crewSheet');
  let sheetTarget = null;
  function openSheet(name) {
    sheetTarget = name;
    const { icon, text } = crewParts(name);
    const g = crewGroup(name);
    $('shIcon').textContent = icon;
    $('shName').textContent = text;
    $('shBlurb').textContent = crewBlurb(name);
    $('shGroup').textContent = name === '' ? '기본 대화' : g.name;
    const fav = getFavs().includes(name);
    $('shFav').textContent = fav ? '★ 자주 쓰는 크루' : '☆ 자주 쓰는 크루에 추가';
    $('shFav').classList.toggle('on', fav);
    $('shShare').classList.toggle('hidden', !name); // 홈 대화는 공유할 크루가 아니다
    sheetEl.classList.remove('hidden');
  }
  const closeSheet = () => sheetEl.classList.add('hidden');
  sheetEl.addEventListener('click', (e) => { if (e.target === sheetEl) closeSheet(); });
  $('shChat').onclick = () => { const n = sheetTarget; closeSheet(); selectProject(n); };
  $('shShare').onclick = () => { const n = sheetTarget; closeSheet(); openShare(n); };
  $('shSet').onclick = () => { const n = sheetTarget; closeSheet(); openProjectSettings(n); };
  $('shFav').onclick = () => { toggleFav(sheetTarget); openSheet(sheetTarget); };

  // 스토어 추천 크루를 눌러 추가: 방으로 가지 않고 크루 탭에 그대로 머문다
  async function addStoreCrew(id) {
    const a = AGENTS.find((x) => x.id === id);
    if (a) await createAgent({ folder: a.folder, instructions: a.instructions, tpl: a.id, go: false });
  }

  // ---------- 👀 결과물 (크루가 만든 웹페이지 미리보기) ----------
  const madeEl = $('madePanel');
  const madeBody = $('madeBody');
  const ago = (ms) => {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 90) return '방금 전';
    if (s < 3600) return `${Math.round(s / 60)}분 전`;
    if (s < 86400) return `${Math.round(s / 3600)}시간 전`;
    return `${Math.round(s / 86400)}일 전`;
  };
  const kb = (n) => (n < 1024 ? `${n}B` : `${Math.max(1, Math.round(n / 1024))}KB`);
  // 결과물: 크루가 만든 파일 전부 (웹페이지 · 이미지 · 문서 · 음악 · 영상). 종류별 탭으로 나눠 보여 준다
  const KIND_NAME = { web: '웹페이지', image: '이미지', doc: '문서', audio: '음악', video: '영상' };
  const KIND_ICON = { web: '🌐', image: '🖼', doc: '📄', audio: '🎵', video: '🎬' };
  let madeData = null; // { files, base, origin }
  let madeKind = 'all';
  const fileExt = (p) => (p.match(/\.[^./]+$/) || [''])[0].toLowerCase();
  const OFFICE_EXT = ['.docx', '.xlsx', '.pptx'];
  async function openMade() {
    els.menu.classList.add('hidden');
    if (!crewOf(project)) return alert('크루 방에서 열어 주세요. 아래 메뉴의 크루 탭에서 크루를 고르거나 ＋로 만들 수 있어요.');
    let d;
    try { d = await api('/api/preview-files' + q()); } catch (err) { return alert(err.message); }
    // 다른 기기에서 열 주소: 이 폰 안(127.0.0.1)에서 보고 있으면 같은 와이파이 주소를 알려 준다
    const local = ['127.0.0.1', 'localhost'].includes(location.hostname);
    madeData = { files: d.files, base: `/preview/${d.token}/${encodeURIComponent(d.project)}/`, origin: local ? (d.lan[0] || '') : location.origin };
    if (madeKind !== 'all' && !d.files.some((f) => f.kind === madeKind)) madeKind = 'all';
    $('madeTitle').textContent = `👀 ${crewParts(project).text}의 결과물`;
    renderMade();
    madeEl.classList.remove('hidden');
  }
  const madeUrl = (f) => madeData.base + f.path.split('/').map(encodeURIComponent).join('/');
  function renderMade() {
    const { files, base, origin } = madeData;
    const counts = { all: files.length };
    for (const f of files) counts[f.kind] = (counts[f.kind] || 0) + 1;
    const tabs = ['all', ...Object.keys(KIND_NAME).filter((k) => counts[k])]
      .map((k) => `<button type="button" data-kind="${k}"${k === madeKind ? ' class="on"' : ''}>${k === 'all' ? '전체' : KIND_NAME[k]} ${counts[k]}</button>`).join('');
    const shown = files.map((f, i) => ({ f, i })).filter(({ f }) => madeKind === 'all' || f.kind === madeKind);
    let body;
    if (!files.length) {
      body = '<p class="empty">아직 만든 결과물이 없어요.<br>크루에게 "홈페이지 만들어 줘", "로고 이미지 만들어 줘", "보고서 만들어 줘"라고 말해 보세요.</p>';
    } else if (madeKind === 'image') {
      body = '<div class="made-grid">' + shown.map(({ f, i }) =>
        `<button type="button" data-i="${i}" aria-label="${escapeHtml(f.path)}"><img loading="lazy" alt="" src="${escapeHtml(madeUrl(f))}"></button>`).join('') + '</div>';
    } else {
      body = shown.map(({ f, i }) =>
        `<button class="pick-card" data-i="${i}"><span class="pick-icon">${KIND_ICON[f.kind]}</span><span><b>${escapeHtml(f.path)}</b><small>${KIND_NAME[f.kind]} · ${ago(f.mtime)} · ${kb(f.size)}</small></span></button>`).join('');
    }
    madeBody.innerHTML = (files.length ? `<div class="made-tabs">${tabs}</div>` : '') + body +
      (origin && files.some((f) => f.kind === 'web')
        ? `<h3>다른 기기에서 웹페이지를 보려면</h3><p class="settings-row"><b>${escapeHtml(origin + base)}</b></p>` +
          '<button id="madeCopy" class="settings-save" type="button">📋 주소 복사</button>' +
          '<p class="settings-note">같은 와이파이의 기기에서 이 주소를 열면 로그인 없이 볼 수 있어요. 주소는 <b>6시간</b> 동안만 유효하고, 이 화면을 다시 열면 새 주소가 만들어져요.</p>'
        : '') +
      (files.some((f) => f.kind === 'web')
        ? '<p class="settings-note">ⓘ 만든 웹페이지는 안전을 위해 <b>격리된 상태</b>로 열려요. 그래서 글을 저장해 두는 기능(브라우저 저장소)은 미리보기에서 동작하지 않을 수 있어요. 모두에게 공개하는 건 GAMJA Pro에서 해요.</p>'
        : '');
    madeBody.onclick = (e) => {
      const tab = e.target.closest('[data-kind]');
      if (tab) { madeKind = tab.dataset.kind; return renderMade(); }
      const item = e.target.closest('[data-i]');
      if (item) return openResult(madeData.files[Number(item.dataset.i)]);
      if (e.target.id === 'madeCopy') {
        const text = origin + base;
        navigator.clipboard.writeText(text).then(() => toast('📋 주소를 복사했어요'), () => gCopy('이 주소를 복사하세요', text));
      }
    };
  }
  // 파일 하나 열기: 종류마다 보는 방법이 다르다
  function openResult(f) {
    const url = madeUrl(f);
    const abs = location.origin + url;
    const ext = fileExt(f.path);
    const page = (inner) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>` +
      'html,body{margin:0;height:100%;background:#111;color:#eee;font:15px sans-serif}' +
      'body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:12px;box-sizing:border-box}' +
      'img,video{max-width:100%;max-height:100%;border-radius:8px}audio{width:100%;max-width:480px}.n{opacity:.7;word-break:break-all;text-align:center}</style>' + inner;
    if (f.kind === 'image') return openViewer({ doc: page(`<img src="${escapeHtml(abs)}" alt="">`) }, f.path);
    if (f.kind === 'audio') return openViewer({ doc: page(`<div style="font-size:64px">🎵</div><div class="n">${escapeHtml(f.path)}</div><audio controls src="${escapeHtml(abs)}"></audio>`) }, f.path);
    if (f.kind === 'video') return openViewer({ doc: page(`<video controls playsinline src="${escapeHtml(abs)}"></video>`) }, f.path);
    // PDF·워드·엑셀·파워포인트: 감자 안의 화면(격리된 창)에서는 못 보여 줘서, 폰의 브라우저·다른 앱으로 열거나 내려받는다
    const app = window.GamjaApp;
    if (OFFICE_EXT.includes(ext) || ext === '.pdf') {
      if (app && typeof app.openExternal !== 'undefined') {
        toast('폰의 다른 앱으로 열어요');
        return app.openExternal(abs);
      }
      return window.open(url, '_blank'); // 일반 브라우저: 새 창으로 열거나 내려받는다
    }
    openViewer({ src: url }, f.path); // 웹페이지·글(txt·md·csv)
  }
  // 결과물 보기: 화면 이동 없이 감자 안의 전체 화면 창에 띄운다 (← 로 언제든 돌아옴)
  const viewEl = $('viewPanel');
  // what: { src } 주소를 그대로 열기 | { doc } 직접 만든 작은 페이지 보여 주기 (이미지·음악·영상)
  function openViewer(what, title) {
    // 감자 앱에서는 앱 기능 통로가 없는 따로 떨어진 화면에서 연다. 같은 화면 안의 iframe에서 열면 만든 페이지의 코드가 앱 기능을 부를 수 있기 때문이다.
    // (통로가 없는 일반 브라우저와 옛 앱은 아래의 iframe 창을 쓴다)
    const app = window.GamjaApp;
    if (app && typeof app.openPreview !== 'undefined') {
      return app.openPreview(what.src ? location.origin + what.src : '', what.doc || '', title);
    }
    const frame = $('viewFrame');
    $('viewTitle').textContent = title;
    if (what.doc) { frame.srcdoc = what.doc; } else { frame.removeAttribute('srcdoc'); frame.src = what.src; }
    viewEl.classList.remove('hidden');
  }
  $('viewBack').onclick = () => { viewEl.classList.add('hidden'); const fr = $('viewFrame'); fr.removeAttribute('srcdoc'); fr.src = 'about:blank'; };
  $('madeBtn').onclick = openMade;
  $('madeBack').onclick = () => madeEl.classList.add('hidden');

  // ---------- 👥 크루 고르기 (회사·가게·나만의 크루) ----------
  // 크루 = 프로젝트 + 그 일에 맞는 지침(CLAUDE.md). 고르면 프로젝트가 만들어지고 바로 그 방으로 간다
  const { GROUPS, AGENTS, custom: customInstructions } = window.GAMJA_TEMPLATES;
  const agentEl = $('agentPicker');
  const agentBody = $('agentBody');
  let agentView = null; // null = 분야 고르기, 분야 id = 그 분야의 크루 목록
  const t = window.GAMJA_I18N.t; // 새 화면의 글은 i18n.js에 키로 적고 t('키')로 꺼내 쓴다 (다국어 준비)
  // 직접 만들기 화면에서 고를 수 있는 아이콘 (감자 전용 아이콘으로 바뀌어 보인다)
  const CUSTOM_ICONS = ['🙋', '💬', '🌐', '📄', '📅', '📚', '✍️', '💰', '🧾', '🔎', '📣', '🧳', '🍽️', '🏪', '🏢', '📊'];
  let customIcon = '🙋';
  // 크루 입력 양식: "직접 만들기"(p='cf')와 "크루 설정"(p='ps')이 똑같은 모양을 쓴다.
  // v = { icon, name, blurb, group, job }. withInfo=false면 아이콘·이름·소개·묶음은 빼고 맡은 일만 (감자 톡톡 등)
  const noVs = (s) => String(s).replace(/️/g, '');
  function crewFormHtml(p, v, { withInfo = true, jobRows = 4 } = {}) {
    const icons = CUSTOM_ICONS.some((ic) => noVs(ic) === noVs(v.icon)) ? CUSTOM_ICONS : [v.icon, ...CUSTOM_ICONS];
    const info = !withInfo ? '' :
      `<h3>${escapeHtml(t('cf.icon'))}</h3><div class="cf-icons">` +
      icons.map((ic) => `<button type="button" data-ic="${ic}"${noVs(ic) === noVs(v.icon) ? ' class="on"' : ''}>${ic}</button>`).join('') + '</div>' +
      `<label>${escapeHtml(t('cf.name'))}<input id="${p}Name" maxlength="30" value="${escapeHtml(v.name)}" placeholder="${escapeHtml(t('cf.namePh'))}" autocomplete="off"></label>` +
      `<label>${escapeHtml(t('cf.blurb'))}<input id="${p}Blurb" maxlength="40" value="${escapeHtml(v.blurb)}" placeholder="${escapeHtml(t('cf.blurbPh'))}" autocomplete="off"></label>` +
      `<h3>${escapeHtml(t('cf.group'))}</h3><div class="radio-list seg">` +
      GROUPS.map((g) => `<label><input type="radio" name="${p}Group" value="${g.id}"${v.group === g.id ? ' checked' : ''}> ${escapeHtml(g.name)}</label>`).join('') + '</div>';
    return info + `<label>${escapeHtml(t('cf.job'))}<textarea id="${p}Job" rows="${jobRows}" placeholder="${escapeHtml(t('cf.jobPh'))}">${escapeHtml(v.job || '')}</textarea></label>`;
  }
  // 양식에서 값을 읽는다 (아이콘은 눌려 있는 버튼, 묶음은 고른 칸)
  function readCrewForm(root, p) {
    const on = root.querySelector('.cf-icons .on');
    return {
      icon: on ? on.dataset.ic : null,
      name: root.querySelector(`#${p}Name`) ? root.querySelector(`#${p}Name`).value.trim() : null,
      blurb: root.querySelector(`#${p}Blurb`) ? root.querySelector(`#${p}Blurb`).value.trim() : null,
      group: (root.querySelector(`input[name=${p}Group]:checked`) || {}).value || null,
      job: root.querySelector(`#${p}Job`).value,
    };
  }
  function renderAgents() {
    if (agentView === '__custom') {
      $('agentTitle').textContent = t('cf.title');
      agentBody.innerHTML = `<p class="settings-note">${escapeHtml(t('cf.intro'))}</p>` +
        crewFormHtml('cf', { icon: customIcon, name: '', blurb: '', group: 'personal', job: '' }) +
        `<button id="cfMake" class="settings-save" type="button" disabled>${escapeHtml(t('cf.make'))}</button>`;
      agentBody.scrollTop = 0;
      return;
    }
    if (!agentView) {
      $('agentTitle').textContent = '추천 크루';
      agentBody.innerHTML = (clipCrew
        ? `<button class="pick-card pick-hot" data-clip="1"><span class="pick-icon">📥</span><span><b>복사한 크루 가져오기</b><small>${escapeHtml(clipCrew.icon)} ${escapeHtml(clipCrew.name)}</small></span></button>`
        : '') + GROUPS.map((g) =>
        `<button class="pick-card" data-group="${g.id}"><span class="pick-icon">${g.icon}</span><span><b>${g.name}</b><small>${g.desc}</small></span></button>`).join('') +
        makeButtonsHtml() +
        '<p class="settings-note">크루는 일마다 따로 일하는 AI 팀원이고, 각자 자기 방이 있어요. 고르면 그 일에 맞는 지침이 자동으로 들어가고, ⋯ → 📁 크루 설정에서 언제든 고칠 수 있어요.</p>';
    } else if (agentView === '__import') {
      $('agentTitle').textContent = '📥 크루 가져오기';
      agentBody.innerHTML = '<p class="settings-note">친구가 보낸 글에서 <b>gamja-crew:</b>로 시작하는 코드를 통째로 붙여 넣으세요. 앞뒤에 다른 글이 있어도 괜찮아요.</p>' +
        '<button id="crewPaste" class="settings-save" type="button">📋 복사한 코드 붙여넣기</button>' +
        '<textarea id="crewCode" rows="5" placeholder="또는 여기에 직접 붙여 넣으세요 (gamja-crew:...)" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea>' +
        '<button id="crewCheck" class="settings-ghost" type="button">확인하기</button>';
    } else if (agentView === '__preview' && pendingCrew) {
      const c = pendingCrew;
      const w = crewWarnings(c);
      agentBody.innerHTML =
        `<div class="crew-head"><span class="pick-icon">${escapeHtml(c.icon)}</span><span><b>${escapeHtml(c.name)}</b>` +
        (c.blurb ? `<small>${escapeHtml(c.blurb)}</small>` : '') + (c.author ? `<small>보낸 사람: ${escapeHtml(c.author)}</small>` : '') + '</span></div>' +
        '<p class="settings-note err">⚠️ 이 크루는 Claude가 그대로 따르는 지침이에요. 아래 내용을 끝까지 읽고, 믿을 수 있는 사람이 보낸 것일 때만 추가하세요.</p>' +
        (w.terms.length ? `<p class="settings-note err">⚠️ 지침에 <b>${w.terms.map(escapeHtml).join(', ')}</b> 같은 말이 들어 있어요. 어떤 뜻으로 쓰였는지 아래 지침에서 확인해 보세요.</p>` : '') +
        (w.hidden ? `<p class="settings-note">ⓘ 눈에 보이지 않는 글자 ${w.hidden}개를 지웠어요.</p>` : '') +
        '<h3>지침 전체</h3><pre class="crew-pre">' + escapeHtml(c.instructions) + '</pre>' +
        (c.examples.length ? '<h3>예시 문장</h3>' + c.examples.map((t) => `<p class="settings-note">• ${escapeHtml(t)}</p>`).join('') : '') +
        '<button id="crewAdd" class="settings-save" type="button">크루 추가하기</button>' +
        '<button id="crewCancel" class="settings-ghost" type="button">취소</button>';
    } else {
      const g = GROUPS.find((x) => x.id === agentView);
      $('agentTitle').textContent = `${g.icon} ${g.name}`;
      agentBody.innerHTML = AGENTS.filter((a) => a.group === agentView).map((a) =>
        `<button class="pick-card" data-agent="${a.id}"><span class="pick-icon">${a.icon}</span><span><b>${a.name}</b><small>${a.blurb}</small></span></button>`).join('');
    }
    agentBody.scrollTop = 0;
  }
  let agentDirect = false; // 감자 톡톡 첫 화면의 분야 버튼으로 바로 연 분야 목록인지 (뒤로 가면 추천 크루 화면이 아니라 채팅방으로 바로 돌아간다)
  function openAgents(group = null, direct = false) {
    els.menu.classList.add('hidden');
    agentView = group;
    agentDirect = !!group && direct;
    renderAgents();
    agentEl.classList.remove('hidden');
    if (!group) peekClipboard();
  }
  $('agentBack').onclick = () => {
    if (agentView && !agentDirect) { agentView = null; renderAgents(); } else { agentDirect = false; agentView = null; agentEl.classList.add('hidden'); }
  };
  // go: 만든 뒤 그 크루 방으로 갈지 (스토어 추천의 "추가"는 가지 않고 크루 탭에 머문다)
  async function createAgent({ folder, instructions, tpl, meta, go = true }) {
    if (go && runId === 'pending') return alert('사진을 올리는 중이에요. 올리기가 끝난 뒤에 만들 수 있어요.');
    if (go && runId) detachRun(); // 보던 방의 작업은 감자알에서 계속된다
    let created = true;
    try { await api('/api/projects', { name: folder }); }
    catch (err) {
      if (!/이미 있어요/.test(err.message)) return alert(err.message);
      created = false; // 이미 있는 크루면 지침을 덮어쓰지 않고 그 방으로만 간다
    }
    if (created) {
      try { await api('/api/project-settings', { project: folder, instructions, model: '', effort: '' }); }
      catch (err) { return alert(err.message); }
    }
    if (tpl) store.set(`cc:tpl:${folder}`, tpl);
    if (meta) store.set(`cc:crew:${folder}`, meta); // 가져온 크루의 이름·아이콘·예시 문장 (빈 방에서 보여 줌)
    clipCrew = null;
    agentEl.classList.add('hidden');
    if (!go) {
      await loadProjects();
      renderHome();
      return toast(created ? '✅ 크루를 추가했어요. 위의 내 크루에서 찾을 수 있어요' : '이미 있는 크루예요');
    }
    showTab(null); // 크루 탭에서 크루를 추가했으면 그 크루 방으로 바로 간다
    await switchProject(folder);
    toast(created ? '✅ 크루를 추가했어요. 아래 예시를 눌러 시작해 보세요' : '이미 있는 크루예요. 그 방으로 이동했어요');
  }
  // 직접 만들기 화면에서 "크루 만들기": 이름·아이콘·소개·묶음은 이 기기에 저장하고, 폴더 이름은 이름에서 만든다
  async function createCustomAgent() {
    const f = readCrewForm(agentBody, 'cf');
    const name = f.name;
    const job = f.job.trim();
    if (!name) return toast(t('cf.needName'));
    if (!job) return toast(t('cf.needJob'));
    const blurb = f.blurb || job.replace(/\s+/g, ' ').slice(0, 40);
    const group = f.group || 'personal';
    customIcon = f.icon || customIcon;
    const existing = new Set(projectList);
    const base = folderFromName(name);
    let folder = base;
    for (let n = 2; existing.has(folder); n++) folder = `${base}-${n}`; // 같은 이름이 있으면 새 이름으로
    return createAgent({
      folder, instructions: customInstructions(name, job), tpl: 'custom',
      meta: { name, icon: customIcon, blurb, group, examples: [] },
    });
  }
  const cfReady = () => { const b = $('cfMake'); if (b) b.disabled = !($('cfName').value.trim() && $('cfJob').value.trim()); };
  agentBody.addEventListener('input', (e) => { if (e.target.id === 'cfName' || e.target.id === 'cfJob') cfReady(); });
  // 아이콘 고르기: 두 양식(만들기·설정) 공통. 글 입력칸은 다시 그리지 않고 눌린 표시만 바꾼다
  function pickIcon(btn) {
    for (const b of btn.parentElement.querySelectorAll('[data-ic]')) b.classList.toggle('on', b === btn);
  }
  // ---------- 📤📥 크루 내보내기·가져오기 (크루 코드) ----------
  // 크루 하나를 "gamja-crew:..." 글자 한 덩어리로 만들어 카톡 등으로 보내고, 받는 쪽이 붙여 넣는다.
  // 담는 것은 글(이름·아이콘·소개·지침·예시 문장)뿐이다. 프로그램이나 설정은 담지 않는다
  const CREW_PREFIX = 'gamja-crew:';
  const CREW_MAX_CODE = 100000; // 코드 글자 수 상한
  let pendingCrew = null; // 가져오기 미리보기 중인 크루
  function crewEncode(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return CREW_PREFIX + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  const HIDDEN_CHARS = /[​-‏‪-‮⁠-⁤﻿]/g; // 눈에 안 보이는 글자 (숨은 지시에 쓰일 수 있음)
  function crewDecode(text) {
    const m = String(text).match(/gamja-crew:([A-Za-z0-9_-]+)/);
    if (!m) throw new Error('크루 코드를 찾지 못했어요. "gamja-crew:"로 시작하는 글자를 통째로 붙여 넣어 주세요.');
    if (m[1].length > CREW_MAX_CODE) throw new Error('코드가 너무 길어요.');
    let obj;
    try {
      let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const bin = atob(b64);
      obj = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    } catch { throw new Error('코드가 깨져 있어요. 중간에 잘리지 않았는지 확인해 주세요.'); }
    if (!obj || obj.gamja !== 'crew' || obj.v !== 1) throw new Error('이 감자가 읽을 수 없는 형식이에요. 감자를 최신 버전으로 업데이트해 보세요.');
    const str = (v, n) => (typeof v === 'string' ? v : '').slice(0, n);
    const raw = str(obj.instructions, 50000);
    const instructions = raw.replace(HIDDEN_CHARS, '');
    if (!instructions.trim()) throw new Error('이 코드에는 지침이 없어요.');
    const examples = (Array.isArray(obj.examples) ? obj.examples : []).slice(0, 5).map((t) => str(t, 120).replace(HIDDEN_CHARS, '')).filter(Boolean);
    return {
      name: str(obj.name, 40).replace(HIDDEN_CHARS, '').trim() || '이름 없는 크루',
      icon: str(obj.icon, 8).replace(HIDDEN_CHARS, '') || '🧑‍💼',
      blurb: str(obj.blurb, 200).replace(HIDDEN_CHARS, ''),
      author: str(obj.author, 30).replace(HIDDEN_CHARS, '').trim(),
      examples, instructions,
      hiddenRemoved: raw.length - instructions.length,
    };
  }
  // 받는 사람이 주의해서 읽도록 의심스러운 말을 짚어 준다 (막지는 않는다)
  const WATCH_TERMS = ['비밀번호', '패스워드', 'password', 'api key', 'api_key', 'apikey', '토큰', 'token', 'secret', '시크릿', '.env',
    'ssh', 'curl', 'wget', 'sudo', 'rm -', 'base64', 'http://', 'https://', '업로드', '전송'];
  function crewWarnings(c) {
    const low = c.instructions.toLowerCase();
    return { terms: WATCH_TERMS.filter((t) => low.includes(t)), hidden: c.hiddenRemoved };
  }
  const folderFromName = (name) => name.replace(/[^\w가-힣-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'crew';
  async function addCrew() {
    const c = pendingCrew;
    if (!c) return;
    if (runId) return alert('응답이 끝난 뒤에 크루를 추가할 수 있어요.');
    const existing = new Set(projectList);
    const base = folderFromName(c.name);
    let folder = base;
    for (let n = 2; existing.has(folder); n++) folder = `${base}-${n}`; // 같은 이름이 있으면 새 이름으로 (기존 크루를 덮어쓰지 않는다)
    pendingCrew = null;
    await createAgent({
      folder, instructions: c.instructions, tpl: 'crew',
      meta: { name: c.name, icon: c.icon, blurb: c.blurb, author: c.author, examples: c.examples },
    });
  }
  // 짧게 떴다 사라지는 알림 (확인창 대신)
  let toastTimer = 0;
  function toast(text) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // 📤 공유 카드: 지금 보고 있는 크루를 코드로 만들어 공유창이나 클립보드로 보낸다
  const shareEl = $('sharePanel');
  const shareBody = $('shareBody');
  let shareCrew = null;
  async function openShare(target) {
    els.menu.classList.add('hidden');
    if (!target) return toast('크루 방에서 열어 주세요');
    let d;
    try { d = await api('/api/project-settings?project=' + encodeURIComponent(target)); } catch (err) { return alert(err.message); }
    if (!d.instructions.trim()) return alert('이 크루는 지침이 비어 있어요. 홈 화면에서 그 크루의 ⚙️ 설정을 열어 맡은 일을 먼저 적어 주세요.');
    const known = store.get(`cc:crew:${target}`, null) || AGENTS.find((a) => a.id === store.get(`cc:tpl:${target}`, '')) || {};
    // 이름과 아이콘은 홈 화면 목록(crewLabel)과 똑같이 맞춘다 ("아이콘 이름" 모양에서 앞 글자가 아이콘)
    const label = crewLabel(target);
    const sp = label.indexOf(' ');
    shareCrew = {
      name: sp > 0 ? label.slice(sp + 1) : label, icon: sp > 0 ? label.slice(0, sp) : '📁', blurb: known.blurb || '',
      examples: known.examples || [], instructions: d.instructions,
    };
    shareBody.innerHTML =
      `<div class="share-card"><div class="share-icon">${escapeHtml(shareCrew.icon)}</div><b>${escapeHtml(shareCrew.name)}</b>` +
      (shareCrew.blurb ? `<small>${escapeHtml(shareCrew.blurb)}</small>` : '') + '</div>' +
      // 글은 <span> 하나로 묶어야 토글 옆에서 줄바꿈이 깨지지 않는다
      '<label class="share-check"><span>지침에 전화번호·주소·비밀번호 같은 <b>개인 정보가 없는 걸</b> 확인했어요</span><input id="shareOk" type="checkbox"></label>' +
      '<p class="settings-note">이 크루의 <b>지침 전체</b>가 코드에 담겨요. 받는 사람은 감자에서 내용을 읽어 본 뒤에 추가해요.</p>' +
      (navigator.share ? '<button id="shareSend" class="settings-save" type="button" disabled>📤 공유하기</button>' : '') +
      `<button id="shareCopy" class="${navigator.share ? 'settings-ghost' : 'settings-save'}" type="button" disabled>📋 코드 복사</button>`;
    shareEl.classList.remove('hidden');
  }
  function crewShareText() {
    const author = ''; // "보내는 사람" 입력은 없앴다 (받는 쪽 코드 형식은 그대로)
    const c = shareCrew;
    const code = crewEncode({ gamja: 'crew', v: 1, name: c.name, icon: c.icon, blurb: c.blurb, author, examples: c.examples, instructions: c.instructions });
    return `🥔 감자 크루를 보내요!\n${c.icon} ${c.name}${c.blurb ? `\n${c.blurb}` : ''}\n\n` +
      '받는 방법: 감자 앱 아래 메뉴의 크루 → ＋ → 📥 코드로 가져오기에 아래 글을 붙여 넣으세요.\n\n' +
      `${code}`;
  }
  shareBody.addEventListener('click', async (e) => {
    const id = e.target.id;
    if (id === 'shareOk') {
      for (const b of shareBody.querySelectorAll('#shareSend, #shareCopy')) b.disabled = !e.target.checked;
    } else if (id === 'shareSend') {
      try { await navigator.share({ text: crewShareText() }); }
      catch (err) { if (err && err.name !== 'AbortError') toast('공유창을 열 수 없어요. 코드 복사를 눌러 주세요'); }
    } else if (id === 'shareCopy') {
      const text = crewShareText();
      try { await navigator.clipboard.writeText(text); toast('📋 복사했어요. 카톡에 붙여 넣어서 보내세요'); }
      catch { gCopy('이 글을 복사해서 보내세요', text); }
    }
  });
  $('shareBack').onclick = () => shareEl.classList.add('hidden');
  $('projExport').onclick = () => openShare(projTarget); // 크루 설정 화면: 그 크루

  // 📥 복사해 둔 크루 코드가 있으면 크루 고르기 맨 위에 알려 준다 (열 때 한 번만 확인)
  let clipCrew = null;
  async function peekClipboard() {
    clipCrew = null;
    if (!navigator.clipboard || !navigator.clipboard.readText) return;
    try {
      const t = await navigator.clipboard.readText();
      if (!t || !t.includes(CREW_PREFIX)) return;
      clipCrew = crewDecode(t);
      if (!agentView && !agentEl.classList.contains('hidden')) renderAgents();
    } catch { /* 권한이 없거나 코드가 아니면 조용히 넘어간다 */ }
  }

  agentBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (btn && btn.id === 'crewCheck') {
      try { pendingCrew = crewDecode($('crewCode').value); } catch (err) { return alert(err.message); }
      agentView = '__preview';
      return renderAgents();
    }
    if (btn && btn.id === 'crewPaste') {
      try {
        const t = await navigator.clipboard.readText();
        $('crewCode').value = t;
        if (t.includes(CREW_PREFIX)) { pendingCrew = crewDecode(t); agentView = '__preview'; return renderAgents(); }
        return toast('복사한 글에 크루 코드가 없어요');
      } catch (err) {
        if (err && err.message && /크루|코드/.test(err.message)) return alert(err.message);
        toast('붙여넣기가 막혀 있어요. 아래 칸을 길게 눌러 붙여 넣어 주세요');
        return $('crewCode').focus();
      }
    }
    if (btn && btn.id === 'crewAdd') return addCrew();
    if (btn && btn.id === 'cfMake') return createCustomAgent();
    if (btn && btn.dataset.ic) return pickIcon(btn);
    if (btn && btn.id === 'crewCancel') { pendingCrew = null; agentView = null; return renderAgents(); }
    // 직접 만들기·코드로 가져오기 (크루 탭과 같은 모양의 버튼)
    if (btn && btn.dataset.custom) { customIcon = '🙋'; agentView = '__custom'; return renderAgents(); }
    if (btn && btn.dataset.import) { agentView = '__import'; return renderAgents(); }
    const b = e.target.closest('.pick-card');
    if (!b) return;
    if (b.dataset.group) { agentView = b.dataset.group; renderAgents(); }
    else if (b.dataset.import) { agentView = '__import'; renderAgents(); }
    else if (b.dataset.clip) { pendingCrew = clipCrew; agentView = '__preview'; renderAgents(); }
    else if (b.dataset.custom) { agentView = '__custom'; customIcon = '🙋'; renderAgents(); }
    else if (b.dataset.agent) {
      const a = AGENTS.find((x) => x.id === b.dataset.agent);
      createAgent({ folder: a.folder, instructions: a.instructions, tpl: a.id });
    }
  });
  // 홈 첫 화면의 분야 버튼, 크루 방의 예시 문장
  els.messages.addEventListener('click', (e) => {
    const g = e.target.closest('[data-open-group]');
    if (g) return openAgents(g.dataset.openGroup, true);
    const ex = e.target.closest('[data-example]');
    if (ex) {
      els.input.value = ex.dataset.example;
      autoGrow();
      updateSendState();
      els.input.focus();
    }
  });

  // ---------- 대화 (서버에 저장, 어느 기기에서든 같은 기록) ----------
  const q = () => `?project=${encodeURIComponent(project)}`;

  // 이전 버전은 브라우저(localStorage)에 기록을 저장했다 → 서버로 한 번 옮기고 지운다
  async function migrateLocal(data) {
    const legacyHist = store.get(`cc:hist:${project}`, null);
    const legacySid = store.get(`cc:sid:${project}`, null);
    if (!legacyHist && !legacySid) return data;
    if (!data.messages.length && !data.sessionId && !data.running) {
      data = await api('/api/history/import', { project, sessionId: legacySid, messages: legacyHist || [] });
    }
    store.del(`cc:hist:${project}`);
    store.del(`cc:sid:${project}`);
    return data;
  }

  // 감자알이 다시 켜지면 새 화면 코드를 받으려고 새로고침해야 한다. 그런데 새로고침하면 음성 대화가 꺼지고 읽어 주던 소리도 끊긴다.
  // 그래서 음성 대화 중이거나 소리를 읽어 주는 중이면 새로고침을 미루고, 끝나면 한다 (읽어 주기가 멈추지 않을 때를 대비해 90초까지만 기다린다)
  let reloadSince = 0;
  const speaking = () => !!(synth && (synth.speaking || synth.pending));
  function requestReload() {
    if (voice.on || speaking()) { if (!reloadSince) reloadSince = Date.now(); return false; }
    location.reload();
    return true;
  }
  setInterval(() => {
    if (!reloadSince || runId || remoteRunId) return;
    if (voice.on || (speaking() && Date.now() - reloadSince < 90000)) return;
    reloadSince = 0;
    location.reload();
  }, 1000);
  let awaitingRestart = false; // 서버 재시작을 기다리는 중 → 끝나면 새 화면 코드로 새로고침
  let lastLoadOk = Date.now(); // 마지막으로 기록을 제대로 받아 온 시각 (멈춤 감지용)
  async function loadConversation() {
    const seq = ++loadSeq;
    clearTimeout(pollTimer);
    if (!els.messages.children.length) showLoading(); // 처음 열 때도 빈 화면 대신 "불러오는 중"을 보여 준다
    let data;
    try {
      data = isGone(project) ? await api('/api/history?archive=' + encodeURIComponent(project.slice(1)))
        : await migrateLocal(await api('/api/history' + q()));
    } catch (err) {
      if (err.message === 'unauthorized') return;
      if (isGone(project) || (project && err.message === '알 수 없는 프로젝트')) { // 지워진 방(보관 대화·다른 기기에서 지운 방)이면 감자 톡톡으로 돌아간다
        project = '';
        store.set('cc:project', '');
        updateHomeBtn();
        return loadConversation();
      }
      // 서버가 잠깐 꺼져 있을 수 있다(재시작 중 등) → 포기하지 않고 다시 시도한다.
      // (예전에는 여기서 멈춰서, 진행 중 표시에 갇힌 채 새로고침해야 했다)
      setStatus(awaitingRestart ? '🔄 서버 재시작 중...' : '🔄 서버에 다시 연결하는 중...');
      pollTimer = setTimeout(loadConversation, awaitingRestart || remoteRunId ? 2000 : 3000);
      return;
    }
    lastLoadOk = Date.now();
    const last = data.messages[data.messages.length - 1];
    const pendingRestart = !!(last && last.restartPending);
    if (awaitingRestart && !pendingRestart) {
      if (requestReload()) return; // 음성 대화·읽어 주기 중이면 미룬다
    }
    awaitingRestart = pendingRestart;
    if (seq !== loadSeq || runId) return; // 그 사이 프로젝트를 바꿨거나 전송을 시작함
    // 같은 대화를 다시 불러올 때(답이 끝났을 때 포함)는 화면을 절대 움직이지 않는다. 어느 곳을 보고 있었든 그 자리를 그대로 둔다.
    // 맨 아래로 가는 건: 내가 글을 보냈을 때, 다른 프로젝트·새 대화로 바뀌었을 때뿐. 페이지를 새로 열었으면 저장해 둔 위치로 돌아간다
    const sameConv = loadedProject === project && data.messages.length >= history.length;
    const saved = loadedProject === null ? store.get('cc:scroll', null) : null;
    const keepTop = sameConv ? els.messages.scrollTop
      : saved && saved.project === project && !saved.bottom ? saved.top : null;
    loadedProject = project;
    // 기록이 그대로면 다시 그리지 않는다 (위치·선택 영역 유지)
    if (sameConv && !data.running && !liveView && !awaitingRestart && data.messages.length === history.length &&
      data.messages.at(-1)?.ts === history.at(-1)?.ts && els.messages.children.length && !els.messages.querySelector('.loading')) {
      sessionId = data.sessionId;
      setRunning(false);
      return;
    }
    // 폴링 중 기록이 그대로면 진행 중인 말풍선만 갱신 (긴 대화를 매번 다시 그리지 않도록)
    if (data.running && liveView && data.messages.length === history.length && data.runId === remoteRunId) {
      const live = { role: 'bot', text: data.live.text, tools: data.live.tools };
      paint(liveView, live, true);
      setStatus(data.live.status || '🤔 생각 중...');
      if (follow) scrollBottom();
      updateToBottom();
      pollTimer = setTimeout(loadConversation, 1500);
      return;
    }
    liveView = null;
    sessionId = data.sessionId;
    history = data.messages;
    els.messages.innerHTML = '';
    if (!history.length && !data.running && !data.archived) showEmpty();
    // 큰 방은 맨 아래로 열 때 가장 최근 대화부터 그려서 바로 보여 주고, 오래된 대화는 위로 올려 읽을 때 조금씩 위에 붙인다 (화면이 얼지 않게)
    // 이미 일부만 그려 둔 방을 다시 그릴 때는 같은 만큼만 위쪽을 비워 둔다 (읽던 위치 keepTop이 그대로 맞도록)
    const partial = sameConv && olderQueue.length > 0 && olderQueue.length < history.length;
    const lazy = partial || (keepTop === null && history.length > FIRST_PAINT * 1.5);
    const older = partial ? history.slice(0, olderQueue.length) : lazy ? history.slice(0, history.length - FIRST_PAINT) : [];
    for (const m of lazy ? history.slice(older.length) : history) addMessage(m);
    if (data.archived) addGoneNote();
    updateSessionInfo();

    // 진행 중인 응답이 있으면 (다른 기기에서 보냈거나, 화면이 꺼져 연결이 끊긴 경우) 따라가며 보여준다
    remoteRunId = data.running ? data.runId : null;
    if (data.running) {
      const live = { role: 'bot', text: data.live.text, tools: data.live.tools };
      liveView = addMessage(live);
      paint(liveView, live, true);
      setRunning(true);
      setStatus(data.live.status || '🤔 생각 중...');
      pollTimer = setTimeout(loadConversation, 1500);
    } else {
      setRunning(false);
      if (awaitingRestart) {
        setStatus('🔄 서버 재시작 중...');
        pollTimer = setTimeout(loadConversation, 2000);
      }
    }
    if (keepTop === null) scrollBottom(true);
    else { els.messages.scrollTop = keepTop; follow = false; noteBox(); } // 읽던 곳을 그대로 두고, 자동으로 따라 내려가지 않는다
    if (tab === null) markSeen(); // 채팅방 안에서 받은 답은 읽은 것으로 친다 (채팅 목록의 안 읽음 숫자용)
    olderQueue = older; // 오래된 대화는 위로 올려 읽을 때 조금씩 붙인다
  }
  let olderQueue = []; // 아직 그리지 않은 오래된 대화 (오래된 것부터)
  const FIRST_PAINT = 40; // 큰 방을 열 때 먼저 그리는 최근 대화 수
  const OLDER_CHUNK = 30; // 위로 올릴 때 한 번에 위에 붙이는 오래된 대화 수
  // 위로 올려 읽다가 맨 위 가까이 오면 오래된 대화를 한 조각 위에 붙인다 (카톡처럼). 맨 아래만 보는 동안에는 화면을 건드리지 않는다.
  // 붙일 때는 보던 말풍선의 실제 화면 위치를 재서 그대로 지킨다 (높이 차이를 정수로 더하면 조금씩 어긋난다)
  function loadOlder() {
    const m = els.messages;
    if (!olderQueue.length || m.scrollTop > 800) return;
    const frag = document.createDocumentFragment();
    for (const x of olderQueue.splice(Math.max(0, olderQueue.length - OLDER_CHUNK))) addMessage(x, frag);
    const ref = m.firstElementChild;
    const before = ref ? ref.getBoundingClientRect().top : 0;
    m.insertBefore(frag, m.firstChild);
    if (ref) m.scrollTop += ref.getBoundingClientRect().top - before;
    noteBox();
  }
  // 대화를 불러오는 동안 보여 주는 표시 (점 세 개)
  function showLoading() {
    els.messages.innerHTML = `<div class="loading"><span class="ld-dots"><i></i><i></i><i></i></span><p>${escapeHtml(window.GAMJA_I18N.t('room.loading'))}</p></div>`;
  }
  // 삭제된 크루의 방 맨 아래 안내와 [크루 복구하기] 버튼
  function addGoneNote() {
    const T = window.GAMJA_I18N.t;
    const note = document.createElement('div');
    note.className = 'gone-note';
    note.innerHTML = `<p>${escapeHtml(T('gone.note'))}</p><button id="goneRestore" type="button">${escapeHtml(T('gone.restore'))}</button>`;
    els.messages.append(note);
  }
  // 크루 복구: 휴지통의 크루 폴더·대화·모델 설정을 되돌리고, 이 방을 살아 있는 크루의 방으로 바꾼다
  // 삭제한 크루를 되살린다. go: 되살린 뒤 그 크루 방으로 갈지 (크루 탭의 "삭제한 크루 복구하기"에서는 가지 않는다)
  async function restoreArchived(archiveId, go) {
    const T = window.GAMJA_I18N.t;
    const old = `~${archiveId}`;
    const oldCrew = crewOf(goneName(old));
    let newName = '';
    let r;
    for (;;) { // 같은 이름의 크루가 이미 있으면 새 이름을 물어서 다시 시도한다
      try { r = await api('/api/archive/restore', { id: archiveId, ...(newName ? { newName } : {}) }); break; } catch (err) {
        if (!/같은 이름/.test(err.message)) return alert(err.message);
        const input = await gSheet({ message: T('gone.rename', { name: newName || oldCrew }), field: { value: `${newName || oldCrew}-2` } });
        if (!input || !input.trim()) return;
        newName = input.trim();
      }
    }
    // 이름을 바꿔 복구했으면 화면용 크루 정보(이름·아이콘·소개)도 새 이름 쪽으로 복사한다
    if (r.project !== oldCrew) {
      const meta = crewMeta(oldCrew);
      if (meta) store.set(`cc:crew:${r.project}`, { ...meta, name: r.project });
      const tpl = store.get(`cc:tpl:${oldCrew}`, '');
      if (tpl) store.set(`cc:tpl:${r.project}`, tpl);
    }
    // 방마다 정해 둔 이름·고정·쓰던 글·만들어진 시각을 복구된 방 번호로 옮긴다
    for (const key of ['cc:roomTitle', 'cc:roomPin', 'cc:roomMade', 'cc:drafts']) {
      const o = store.get(key, {});
      for (const room of r.rooms) {
        for (const from of [`~${room.id}`, room.from]) {
          if (from === room.to || !(from in o)) continue;
          if (!(room.to in o)) o[room.to] = o[from];
          delete o[from];
        }
      }
      store.set(key, o);
    }
    const target = (r.rooms.find((x) => x.id === archiveId) || { to: r.project }).to;
    chatKey = '';
    if (go) {
      roomEl.classList.add('hidden');
      await switchProject(target);
    } else await loadProjects();
    toast(T('gone.restored'));
    return r;
  }
  const restoreGoneCrew = () => restoreArchived(project.slice(1), true);
  els.messages.addEventListener('click', (e) => { if (e.target.closest('#goneRestore')) restoreGoneCrew(); });

  let proUi = false; // 개발자 모드인지 (감자알이 알려 준다)
  // ---------- 🗑 삭제한 크루 복구하기 (크루 탭) ----------
  // 크루를 지우면 폴더는 휴지통으로, 대화는 보관함으로 간다. 채팅 목록에는 남기지 않고 여기에서만 보이며, 30일 안에 복구하거나 완전히 지울 수 있다
  let trashItems = [];
  const trashEl = $('trashPanel');
  async function loadTrash() {
    try { trashItems = (await api('/api/trash')).items || []; } catch { return; }
    if ($('crewListBox')) renderCrewList();
    if (!trashEl.classList.contains('hidden')) renderTrash();
  }
  function renderTrash() {
    const T = window.GAMJA_I18N.t;
    $('trashH').textContent = T('trash.title');
    $('trashNote').textContent = T('trash.note');
    const DAY = 86400e3;
    $('trashList').innerHTML = trashItems.length ? trashItems.map((it) => {
      const p = crewParts(it.crew);
      const days = Math.max(0, Math.floor((Date.now() - it.deletedAt) / DAY));
      const left = Math.max(0, 30 - days);
      const when = days === 0 ? T('trash.today') : T('trash.ago', { d: days });
      return `<div class="tool-card"><i class="fr-av">${escapeHtml(p.icon)}</i><div class="tool-mid"><b>${escapeHtml(p.text)}</b>` +
        `<small>${escapeHtml(T('trash.meta', { when, left, n: it.messages }))}</small></div>` +
        `<div class="trash-btns"><button class="tool-btn" type="button" data-restore="${escapeHtml(it.id)}">${escapeHtml(T('trash.restore'))}</button>` +
        `<button class="tool-btn danger" type="button" data-purge="${escapeHtml(it.id)}" data-name="${escapeHtml(p.text)}">${escapeHtml(T('trash.purge'))}</button></div></div>`;
    }).join('') : `<p class="empty">${escapeHtml(T('trash.empty'))}</p>`;
  }
  async function openTrash() {
    await loadTrash();
    renderTrash();
    trashEl.classList.remove('hidden');
  }
  $('trashBack').onclick = () => trashEl.classList.add('hidden');
  trashEl.addEventListener('click', async (e) => {
    const T = window.GAMJA_I18N.t;
    const re = e.target.closest('[data-restore]');
    const pu = e.target.closest('[data-purge]');
    if (re) {
      re.disabled = true;
      try { await restoreArchived(re.dataset.restore, false); } catch (err) { alert(err.message); }
      await loadTrash();
      renderTrash();
      if (!$('homePanel').classList.contains('hidden')) renderHome();
    } else if (pu) {
      if (!(await gSheet({ title: T('trash.purgeTitle'), message: T('trash.purgeMsg', { name: pu.dataset.name }), ok: T('trash.purgeOk'), danger: true }))) return;
      try { await api('/api/trash/purge', { id: pu.dataset.purge }); } catch (err) { return alert(err.message); }
      await loadTrash();
      renderTrash();
    }
  });
  // 읽던 위치 저장 (페이지가 새로 열려도 돌아오도록)
  let scrollSaveTimer = 0;
  els.messages.addEventListener('scroll', () => {
    clearTimeout(scrollSaveTimer);
    scrollSaveTimer = setTimeout(() => store.set('cc:scroll', { project, top: els.messages.scrollTop, bottom: nearBottom() }), 300);
  }, { passive: true });
  // 앱으로 돌아오면(화면 켜짐, 탭 전환) 최신 기록으로 갱신
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || els.app.classList.contains('hidden')) return;
    // 화면이 꺼져 있던 동안 스트림이 끊겼을 수 있다 → 스트림을 닫고 서버 기록으로 이어서 본다
    // (서버의 작업은 계속되고, 진행 중이면 폴링으로 따라가며 보여 준다)
    if (runId && runId !== 'pending' && abortCtl) abortCtl.abort();
    else if (!runId) loadConversation();
  });
  // 아무 일도 없을 때도 4초마다 가볍게 확인: 서버가 스스로 시작한 작업(재시작 후 자동 보고 등)이나
  // 다른 기기에서 보낸 메시지가 새로고침 없이 나타나도록
  setInterval(async () => {
    if (document.visibilityState !== 'visible' || els.app.classList.contains('hidden')) return;
    // 진행 중 응답을 따라가는 중인데 10초 넘게 기록을 못 받았으면 멈춘 것 → 다시 불러와 바로잡는다
    if ((remoteRunId || awaitingRestart) && !runId && Date.now() - lastLoadOk > 10000) return loadConversation();
    if (runId || remoteRunId || awaitingRestart) return; // 이미 따로 따라가는 중
    try {
      const s = await api('/api/status' + q());
      // 감자알이 다시 켜졌다(자동 업데이트·재시작) → 새 화면 코드를 받도록 새로고침. 입력하던 글이 있으면 지우지 않도록 미룬다
      if (s.boot && bootId && s.boot !== bootId && !runId && !remoteRunId && !els.input.value.trim()) {
        bootId = s.boot; // 미루는 동안 같은 일을 되풀이해서 확인하지 않도록
        if (requestReload()) return;
      }
      if (!runId && !remoteRunId && (s.running || s.count !== history.length)) loadConversation();
    } catch {}
  }, 4000);
  function showEmpty() {
    if (!project) {
      // 홈의 첫 화면: 무엇을 하는 앱인지 + 어떤 크루가 필요한지 고르기
      els.messages.innerHTML = '<div class="empty welcome"><div class="welcome-logo">🥔</div>' +
        '<h2>말하면 만들어 주는,<br>내 폰 속 AI 크루</h2>' +
        '<p>맥미니도 서버도 필요 없어요.<br>쓰던 폰 한 대면 돼요.</p>' +
        '<p class="welcome-ask">누구의 크루가 필요하세요?</p>' +
        GROUPS.map((g) => `<button class="welcome-btn" data-open-group="${g.id}">${g.icon} ${g.name}</button>`).join('') +
        '<p class="welcome-hint">크루는 일마다 따로 일하는 AI 팀원이에요.<br>또는 아래에 바로 말해 보세요</p></div>';
      return;
    }
    // 크루 방: 무엇을 시킬지 막막하지 않게 예시 문장을 보여 준다 (누르면 입력창에 들어감)
    const tpl = crewMeta(project);
    const chips = tpl && tpl.examples && tpl.examples.length
      ? `<p class="welcome-ask">${tpl.icon} ${escapeHtml(stripCrew(tpl.name))}에게 이렇게 시켜 보세요</p>` +
        tpl.examples.map((t) => `<button class="chip" data-example="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')
      : '';
    els.messages.innerHTML = `<div class="empty">✳︎<br><b>${escapeHtml(roomText(project))}</b>에서 새 대화를 시작하세요.<br>파일 수정은 자동 승인(acceptEdits)됩니다.${chips}</div>`;
  }
  function updateSessionInfo() {
    els.sessionInfo.textContent = `크루: ${project ? crewLabel(project) : ROOT_NAME}\n세션: ${sessionId || '새 대화'}`;
  }
  els.newBtn.onclick = async () => {
    els.menu.classList.add('hidden');
    if (runId || remoteRunId) return alert('응답 중에는 대화를 지울 수 없어요. 먼저 중지하세요.');
    if (history.length && !(await gSheet({ title: window.GAMJA_I18N.t('room.new'), message: window.GAMJA_I18N.t('room.newConfirm'), ok: window.GAMJA_I18N.t('room.new'), danger: true }))) return;
    stopSpeaking();
    try { await api('/api/history/reset', { project }); } catch (err) { return alert(err.message); }
    roomEl.classList.add('hidden'); // 채팅방 설정에서 눌렀으면 설정 화면을 닫고 새 대화를 보여 준다
    loadConversation();
  };
  // 터미널 등에서 시작한 기존 Claude Code 세션을 이 프로젝트 대화로 불러온다
  $('resumeForm').onsubmit = async (e) => {
    e.preventDefault();
    const id = $('resumeInput').value.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return alert('세션 ID 형식이 아니에요. (예: 44bd115a-6d55-...)');
    if (runId || remoteRunId) return alert('응답이 끝난 뒤에 바꿀 수 있어요.');
    if (history.length && !(await gSheet({ title: '세션을 이어갈까요?', message: '지금 화면의 대화 대신 이 세션을 이어가요.', ok: '이어가기' }))) return;
    try { await api('/api/history/resume', { project, sessionId: id }); } catch (err) { return alert(err.message); }
    $('resumeInput').value = '';
    els.menu.classList.add('hidden');
    loadConversation();
  };
  // 서버 재시작 / 이전 버전으로 되돌리기 (결과는 채팅 알림으로 표시)
  async function adminAction(path, title, message, okLabel) {
    const T = window.GAMJA_I18N.t;
    if (!(await gSheet({ title, message, ok: okLabel, danger: true }))) return;
    els.menu.classList.add('hidden');
    setStatus('🔍 확인 중...');
    let body = { project };
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await api(path, body); break; }
      catch (err) {
        // 되돌리기는 답변 중에는 막혀 있다. 하지만 화면이 망가졌을 때가 바로 되돌릴 때라서, 사용자가 고르면 답변을 멈추고 되돌린다
        if (attempt === 0 && path === '/api/admin/rollback' && /응답이 진행 중/.test(err.message)) {
          setStatus('');
          if (!(await gSheet({ title: T('admin.stopTitle'), message: T('admin.stopMsg'), ok: T('admin.stopOk'), danger: true }))) return;
          setStatus('🔍 확인 중...');
          body = { project, force: true };
          continue;
        }
        setStatus('');
        return gAlert(err.message);
      }
    }
    loadConversation();
  }
  // ---------- 설정 (호칭·답변 스타일·모델·사용량) ----------
  const settingsEl = $('settings');
  // "claude-opus-5-5" → "Claude Opus 5.5"
  function prettyModel(id) {
    if (!id) return '아직 모름 (메시지를 한 번 보내면 표시돼요)';
    const parts = id.replace(/^claude-/, '').replace(/-\d{8}$/, '').split('-');
    const name = parts.shift();
    return `Claude ${name.charAt(0).toUpperCase()}${name.slice(1)} ${parts.join('.')}`.trim();
  }
  async function openSettings() {
    els.menu.classList.add('hidden');
    let d;
    try { d = await api('/api/settings' + q()); } catch (err) { moreLoading = false; updateGnb(); return alert(err.message); }
    showSettingsPage(null); // 항상 설정 목록부터
    $('acctGamja').textContent = d.info.local ? '✅ 로그인됨 · 이 폰' : '✅ 로그인됨 · 다른 기기';
    $('acctClaude').textContent = d.info.account || '로그인 안 됨';
    // 감자 앱 안에서 열었을 때만 "감자 앱" 칸을 보여 준다
    $('appGroup').classList.toggle('hidden', !window.GamjaApp);
    $('infoAppRow').classList.toggle('hidden', !window.GamjaApp);
    // 감자알 로그는 일반 사용자에게 필요 없어서 숨겨 둔다. 나중에 프로(개발자) 모드를 켰을 때만 보여 준다 (앱에서만)
    proUi = !!d.info.pro; // 개발자 모드 (Termux 설치 명령 등을 보여 줄지)
    $('appLog').classList.toggle('hidden', !(window.GamjaApp && d.info.pro));
    $('installRowTitle').textContent = window.GAMJA_I18N.t('install.row');
    $('installRowSub').textContent = window.GAMJA_I18N.t('install.rowSub');
    $('permRowTitle').textContent = window.GAMJA_I18N.t('perm.rowTitle');
    $('permRowSub').textContent = window.GAMJA_I18N.t('perm.rowSub');
    $('extRowTitle').textContent = window.GAMJA_I18N.t('ext.rowTitle');
    $('extRowSub').textContent = window.GAMJA_I18N.t('ext.rowSub');
    if (window.GamjaApp) $('infoApp').textContent = window.GamjaApp.appVersion();
    for (const r of settingsEl.querySelectorAll('input[name=theme]')) r.checked = r.value === theme;
    for (const r of settingsEl.querySelectorAll('input[name=lang]')) r.checked = r.value === window.GAMJA_I18N.pref;
    for (const r of settingsEl.querySelectorAll('input[name=textSize]')) r.checked = Number(r.value) === msgZoom;
    renderTts();
    pwLocal = !!d.info.local; // 이 폰 안에서 연 화면이면 현재 비밀번호를 묻지 않는다
    $('pwCurRow').classList.toggle('hidden', pwLocal);
    $('pwLocalNote').classList.toggle('hidden', !pwLocal);
    $('pwCur').value = ''; $('pwNew').value = ''; $('pwNew').type = 'password'; $('pwShow').checked = false; $('pwStrength').textContent = '';
    $('setNickname').value = d.settings.nickname || '';
    $('setStyle').value = d.settings.style || '';
    for (const r of settingsEl.querySelectorAll('input[name=model]')) r.checked = r.value === (d.settings.model || '');
    $('infoModel').textContent = prettyModel(d.info.model);
    for (const r of settingsEl.querySelectorAll('input[name=effort]')) r.checked = r.value === (d.settings.effort || '');
    for (const r of settingsEl.querySelectorAll('input[name=autocompact]')) r.checked = r.value === (d.settings.autocompact || '');
    const limit = { '200k': 200000, '400k': 400000 }[d.settings.autocompact];
    $('ctxSize').textContent = d.context === null ? '아직 모름 (메시지를 보내면 표시돼요)'
      : d.context === 0 ? '방금 압축했어요'
        : `약 ${Math.round(d.context / 1000)}천 토큰${limit ? ` (압축 시점의 ${Math.min(100, Math.round(d.context / limit * 100))}%)` : ''}`;
    $('infoGamja').textContent = d.info.build ? `0.1.${d.info.build}` : `v${d.info.gamjaVersion} (개발용)`;
    $('infoAutoUpdate').textContent = d.info.build ? '켜짐 (3시간마다 확인)' : '꺼짐 (개발용)';
    $('eggUpdate').onclick = async () => {
      const btn = $('eggUpdate');
      btn.disabled = true;
      toast('🔄 새 버전이 있는지 확인하는 중...');
      try {
        const r = await api('/api/update-check', {});
        toast({
          off: '이 감자알은 개발용이라 자동 업데이트가 꺼져 있어요',
          latest: '✅ 이미 최신 버전이에요',
          restart: '🆕 새 버전을 받았어요. 곧 다시 시작해요',
          busy: '답변 중이라 끝난 뒤에 업데이트해요. 잠시 후 다시 눌러 주세요',
          checking: '이미 확인하는 중이에요',
          skip: '지금은 다시 시작하는 중이에요',
          error: `⚠️ 확인에 실패했어요: ${r.error || ''}`,
        }[r.status] || '확인했어요');
        if (r.status === 'restart') return; // 곧 다시 시작하니 버튼은 눌리지 않게 두고, 화면이 새로고침되길 기다린다
      } catch (err) {
        // 감자알이 다시 시작하는 동안에는 연결이 잠깐 끊겨서 "Failed to fetch"가 난다. 오류가 아니라 정상이다
        toast(/fetch|network/i.test(String(err && err.message)) ? '🔄 감자알이 다시 시작하는 중이에요. 잠시만 기다려 주세요' : `⚠️ ${err.message}`);
        setTimeout(() => { btn.disabled = false; }, UPDATE_BTN_COOLDOWN);
        return;
      }
      setTimeout(() => { btn.disabled = false; }, UPDATE_BTN_COOLDOWN); // 확인이 끝난 뒤 1초 쉬었다가 다시 누를 수 있다
    };
    const ups = (d.info.updates || []).slice(-3).reverse(); // 최근 3개만, 새것이 위로
    $('updateHistory').innerHTML = ups.length
      ? ups.map((u) => `<p class="settings-row"><span>${escapeHtml(u.version)}</span><b>${escapeHtml(new Date(u.ts).toLocaleString(LOCALE, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</b></p>`).join('')
      : '<p class="settings-note">아직 기록이 없어요.</p>';
    if (tab !== 'more') return; // 불러오는 사이에 다른 탭으로 갔으면 더보기를 띄우지 않는다
    settingsEl.classList.remove('hidden');
    homeEl.classList.add('hidden'); // 더보기가 뜬 뒤에야 보던 탭 화면을 걷는다
    chatEl.classList.add('hidden');
    moreLoading = false;
    updateGnb();
  }
  // ⋯ 메뉴의 "채팅방 설정": 채팅방 이름 · 참여자(크루) · 대화 정보 · 채팅방 삭제. 크루 자체의 설정(지침·모델·공유·삭제)은 참여자를 눌러 들어간다
  const roomEl = $('roomSettings');
  function openRoomSettings() {
    const T = window.GAMJA_I18N.t;
    els.menu.classList.add('hidden');
    const gone = isGone(project);
    const p = crewParts(project);
    const blurb = T('chat.deletedCrew');
    const members = ((chats.find((c) => c.name === project) || {}).members || [crewOf(project)]);
    $('roomTitleH').textContent = T('room.title');
    // 대화 관리: 새 대화와 대화 압축은 ⋯ 메뉴가 아니라 여기서 한다
    $('roomManageH').textContent = T('room.manage');
    $('newBtn').textContent = T('room.new');
    $('roomNewNote').textContent = T('room.newNote');
    $('compactBtn').textContent = T('room.compact');
    $('roomCompactNote').textContent = T('room.compactNote');
    $('roomForm').innerHTML =
      `<h3>${escapeHtml(T('room.name'))}</h3><input id="roomName" maxlength="40" placeholder="${escapeHtml(p.text)}" value="${escapeHtml(getRoomTitles()[project] || '')}" autocomplete="off">` +
      `<p class="settings-note">${escapeHtml(T('room.nameNote'))}</p>` +
      `<label class="share-check"><input id="roomPin" type="checkbox"${getRoomPins()[project] ? ' checked' : ''}><span>${escapeHtml(T('room.pin'))}</span></label>` +
      `<h3>${escapeHtml(T('room.members'))} ${gone ? 1 : members.length}</h3><div class="fr-list">` +
      (gone
        ? `<button id="roomRestore" class="fr-row" type="button"><i class="fr-av">${escapeHtml(p.icon)}</i><span class="fr-mid"><b>${escapeHtml(p.text)}</b><small>${escapeHtml(blurb)}</small></span><span class="fr-pill">${escapeHtml(T('gone.restoreShort'))}</span></button>`
        : members.map((m) => { // 참여자 목록 (지금은 한 명). 누르면 그 크루의 설정
          const mp = crewParts(m);
          return `<button class="fr-row" data-member="${escapeHtml(m)}" type="button"><i class="fr-av">${escapeHtml(mp.icon)}</i><span class="fr-mid"><b>${escapeHtml(mp.text)}</b><small>${escapeHtml(crewBlurb(m))}</small></span><span>›</span></button>`;
        }).join('')) +
      '</div>' +
      (gone || !GROUP_CHAT_ENABLED ? '' : project.includes('@') && members.length < MAX_ROOM_MEMBERS
        ? `<button id="roomInvite" class="fr-join" type="button">${escapeHtml(T('room.invite'))}<span>›</span></button>`
        : `<button class="fr-join" type="button" disabled>${escapeHtml(T('room.invite'))}<span>${escapeHtml(T(project.includes('@') ? 'room.inviteFull' : 'room.inviteFirst', { max: MAX_ROOM_MEMBERS }))}</span></button>`) +
      `<p class="settings-note">${escapeHtml(T(gone ? 'room.memberNoteGone' : 'room.memberNote'))}</p>`;
    $('projChatInfo').classList.toggle('hidden', gone);
    $('roomDeleteNote').textContent = T(gone ? 'room.deleteNoteGone' : 'room.deleteNote');
    $('roomDelete').textContent = T('room.delete');
    // 감자 톡톡(기본 대화방)은 지울 수 없다: 처음 접속한 이용자에게 늘 있어야 하는 방이라 삭제 버튼과 설명을 숨긴다 (대화만 지우려면 "대화 모두 지우기")
    const rootRoom = project === '';
    $('roomDelete').classList.toggle('hidden', rootRoom);
    $('roomDeleteNote').classList.toggle('hidden', rootRoom);
    roomEl.classList.remove('hidden');
  }
  $('settingsBtn').onclick = openRoomSettings;
  // 채팅 탭의 ＋: "채팅방 만들기" 화면 (채팅방 이름 + 참여자 고르기). 같은 크루와도 일마다 대화를 따로 나눌 수 있다
  // 참여자를 둘 이상 고르면 그룹 채팅: 크루들이 차례로 자기 분야 의견을 낸다 (서버의 handleGroupChat)
  const MAX_ROOM_MEMBERS = 4; // 서버의 한도와 같게 둔다
  const ROOM_CREATE_ENABLED = true; // 크루 한 명의 새 채팅방은 열려 있다. 둘 이상(그룹)은 GROUP_CHAT_ENABLED와 서버가 막는다
  const newChatEl = $('newChat');
  let ncMembers = []; // 고른 참여자(크루 이름)
  let ncName = ''; // 적어 둔 채팅방 이름
  function renderNewChat() {
    const T = window.GAMJA_I18N.t;
    if (!GROUP_CHAT_ENABLED) return renderNcForm();
    const rows = ['', ...projectList].map((n) => {
      const { icon, text } = crewParts(n);
      const on = ncMembers.includes(n);
      return `<button class="fr-row${on ? ' sel' : ''}" data-pick="${escapeHtml(n)}" type="button"><i class="fr-av">${escapeHtml(icon)}</i>` +
        `<span class="fr-mid"><b>${escapeHtml(text)}</b><small>${escapeHtml(crewBlurb(n))}</small></span><span class="nc-check">${on ? '✓' : ''}</span></button>`;
    }).join('');
    $('newChatForm').innerHTML =
      `<h3>${escapeHtml(T('newchat.name'))}</h3><input id="ncName" maxlength="40" placeholder="${escapeHtml(T('newchat.namePh'))}" value="${escapeHtml(ncName)}" autocomplete="off">` +
      `<h3>${escapeHtml(T('newchat.members'))} ${ncMembers.length}</h3><div class="fr-list">${rows}</div>` +
      `<p class="settings-note">${escapeHtml(T('newchat.groupNote', { max: MAX_ROOM_MEMBERS }))}</p>`;
    $('newChatGo').disabled = !ROOM_CREATE_ENABLED || !ncMembers.length;
  }
  // 새 채팅 시작(크루 한 명): 채팅방 설정과 같은 구성 — 채팅방 이름 · 참여자(누르면 내 크루/추천 크루 중에서 고르기) · 아래 "새 채팅 시작" 버튼
  let ncSel = null; // 고른 크루: { kind: 'crew', name } | { kind: 'agent', id } (추천 크루는 시작할 때 추가한다)
  function ncSelParts() {
    if (!ncSel) return null;
    if (ncSel.kind === 'agent') {
      const a = AGENTS.find((x) => x.id === ncSel.id);
      return a ? { icon: a.icon, text: stripCrew(a.name), blurb: a.blurb, rec: true } : null;
    }
    const p = crewParts(ncSel.name);
    return { icon: p.icon, text: p.text, blurb: crewBlurb(ncSel.name), rec: false };
  }
  function renderNcForm() {
    const T = window.GAMJA_I18N.t;
    const s = ncSelParts();
    $('newChatForm').innerHTML =
      `<h3>${escapeHtml(T('newchat.name'))}</h3><input id="ncName" maxlength="40" placeholder="${escapeHtml(T('newchat.namePh'))}" value="${escapeHtml(ncName)}" autocomplete="off">` +
      `<p class="settings-note">${escapeHtml(T('newchat.nameNote'))}</p>` +
      `<h3>${escapeHtml(T('newchat.members'))} ${s ? 1 : 0}</h3><div class="fr-list"><button class="fr-row" data-nc-open type="button">` +
      (s ? `<i class="fr-av">${escapeHtml(s.icon)}</i><span class="fr-mid"><b>${escapeHtml(s.text)}</b><small>${escapeHtml(s.blurb)}</small>` +
          `${s.rec ? `<small class="nc-tag">${escapeHtml(T('newchat.willAdd'))}</small>` : ''}</span><span class="nc-go">›</span>`
        : `<i class="fr-av">＋</i><span class="fr-mid"><b>${escapeHtml(T('newchat.pick'))}</b><small>${escapeHtml(T('newchat.pickSub'))}</small></span><span class="nc-go">›</span>`) +
      `</button></div><p class="settings-note">${escapeHtml(T('newchat.pickNote'))}</p>`;
    $('newChatGo').disabled = !s;
  }
  // 참여자 고르기 창: 크루 탭의 줄 + 추천 크루 카드. 검색 · 감자 톡톡 · ★ 자주 쓰는 크루 · 묶음별 크루 · 추천 크루
  let ncQuery = '';
  function renderNcPick() {
    const T = window.GAMJA_I18N.t;
    const isSel = (n) => !!ncSel && ncSel.kind === 'crew' && ncSel.name === n;
    const rowHtml = (n) => {
      const { icon, text } = crewParts(n);
      return `<button class="fr-row${n === '' ? ' me' : ''}${isSel(n) ? ' sel' : ''}" data-pick="${escapeHtml(n)}" type="button"><i class="fr-av">${escapeHtml(icon)}</i>` +
        `<span class="fr-mid"><b>${escapeHtml(text)}</b><small>${escapeHtml(crewBlurb(n))}</small></span><span class="nc-go">${isSel(n) ? '✓' : '›'}</span></button>`;
    };
    const list = (names) => `<div class="fr-list">${names.map(rowHtml).join('')}</div>`;
    const shelf = (agents) => '<div class="fr-shelf">' + agents.map((a) =>
      `<div class="fr-card"><i class="fr-av big">${escapeHtml(a.icon)}</i><b>${escapeHtml(stripCrew(a.name))}</b><small>${escapeHtml(a.blurb)}</small>` +
      `<button class="fr-pill" data-pick-agent="${escapeHtml(a.id)}" type="button">${escapeHtml(T('newchat.choose'))}</button></div>`).join('') + '</div>';
    const rec = AGENTS.filter((a) => !projectList.includes(a.folder));
    const q = ncQuery.trim().toLowerCase();
    if (ncAll) { // 추천 크루 전체 보기: 묶음별로 모두 보여 준다 (고르면 크루 탭에 추가될 크루로 정해진다)
      const agentRow = (a) => `<button class="fr-row" data-pick-agent="${escapeHtml(a.id)}" type="button"><i class="fr-av">${escapeHtml(a.icon)}</i>` +
        `<span class="fr-mid"><b>${escapeHtml(stripCrew(a.name))}</b><small>${escapeHtml(a.blurb)}</small></span><span class="nc-go">›</span></button>`;
      const all = GROUPS.map((g) => {
        const as = rec.filter((a) => a.group === g.id);
        return as.length ? `<div class="fr-sec"><span>${escapeHtml(g.icon)} ${escapeHtml(g.name)} ${as.length}</span></div><div class="fr-list">${as.map(agentRow).join('')}</div>` : '';
      }).join('');
      $('ncListBox').innerHTML = all || `<p class="empty">${escapeHtml(T('newchat.none'))}</p>`;
      return;
    }
    let html = '';
    if (q) {
      const hit = ['', ...projectList].filter((n) => `${crewParts(n).text} ${crewBlurb(n)}`.toLowerCase().includes(q));
      const recHit = rec.filter((a) => `${a.name} ${a.blurb}`.toLowerCase().includes(q));
      if (hit.length) html += `<div class="fr-sec"><span>${escapeHtml(T('newchat.results', { n: hit.length }))}</span></div>${list(hit)}`;
      if (recHit.length) html += `<div class="fr-sec"><span>${escapeHtml(T('newchat.recommend'))}</span></div>${shelf(recHit)}`;
      if (!html) html = `<p class="empty">${escapeHtml(T('newchat.none'))}</p>`;
    } else {
      html += list(['']);
      const favs = getFavs().filter((n) => n !== '');
      if (favs.length) html += `<div class="fr-sec"><span><i class="fr-star">★</i> ${escapeHtml(T('newchat.favs'))} ${favs.length}</span></div>${list(favs)}`;
      const shut = getShut();
      for (const g of [...GROUPS, GROUP_ETC]) {
        const names = projectList.filter((n) => crewGroup(n).id === g.id);
        if (!names.length) continue;
        html += `<button class="fr-grp" data-nc-grp="${g.id}" type="button"><span>${escapeHtml(g.name)} ${names.length}</span><small>${shut[g.id] ? '▸' : '▾'}</small></button>`;
        if (!shut[g.id]) html += list(names);
      }
      if (rec.length) html += `<div class="fr-sec"><span>${escapeHtml(T('newchat.recommend'))}</span><button class="fr-more" data-nc-all="1" type="button">${escapeHtml(T('newchat.all'))}</button></div>${shelf(rec.slice(0, 8))}`;
    }
    $('ncListBox').innerHTML = html;
  }
  let ncAll = false; // 추천 크루 전체 보기 중인지
  function openNcPick() {
    const T = window.GAMJA_I18N.t;
    ncAll = false;
    ncQuery = '';
    $('ncSearch').value = '';
    $('ncSearch').placeholder = T('newchat.search');
    $('ncPickH').textContent = T('newchat.pickTitle');
    renderNcPick();
    $('ncPick').classList.remove('hidden');
  }
  function openNewChat() {
    const T = window.GAMJA_I18N.t;
    ncMembers = [];
    ncSel = null;
    ncName = '';
    $('newChatH').textContent = T(GROUP_CHAT_ENABLED ? 'newchat.title' : 'newchat.titleOne');
    $('newChatNote').textContent = T(GROUP_CHAT_ENABLED ? 'newchat.note' : 'newchat.noteOne');
    $('newChatGo').textContent = T(GROUP_CHAT_ENABLED ? 'newchat.go' : 'newchat.start');
    renderNewChat();
    newChatEl.classList.remove('hidden');
  }
  async function startNewChat() {
    let crews = ncMembers.slice();
    if (!GROUP_CHAT_ENABLED) {
      if (!ncSel) return;
      if (ncSel.kind === 'agent') { // 추천 크루를 골랐으면 먼저 크루를 추가하고, 그 크루의 새 채팅방을 만든다
        const a = AGENTS.find((x) => x.id === ncSel.id);
        if (!a) return;
        await createAgent({ folder: a.folder, instructions: a.instructions, tpl: a.id, go: false });
        if (!projectList.includes(a.folder)) return;
        crews = [a.folder];
      } else crews = [ncSel.name];
    }
    if (!ROOM_CREATE_ENABLED || !crews.length) return;
    let r;
    try { r = await api('/api/rooms', { crews }); } catch (err) { return alert(err.message); }
    const d = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    const titles = getRoomTitles();
    // 이름을 안 적으면 같은 크루의 방끼리 구분되게 시각을 붙인다 (채팅방 설정에서 바꿀 수 있다)
    titles[r.room] = ncName.trim() || (crews.length > 1 ? crews.map((c) => crewParts(c).text).join(', ')
      : `${crewParts(crews[0]).text} · ${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`);
    store.set('cc:roomTitle', titles);
    newChatEl.classList.add('hidden');
    selectProject(r.room);
  }
  $('newChatBack').onclick = () => newChatEl.classList.add('hidden');
  $('newChatGo').onclick = startNewChat;
  newChatEl.addEventListener('input', (e) => { if (e.target.id === 'ncName') ncName = e.target.value; });
  // 참여자 고르기 창 (크루 한 명): 내 크루나 추천 크루를 고르면 창이 닫히고 "참여자" 줄에 보인다
  const ncPickEl = $('ncPick');
  $('ncPickBack').onclick = () => {
    if (ncAll) { ncAll = false; $('ncPickH').textContent = window.GAMJA_I18N.t('newchat.pickTitle'); renderNcPick(); return; } // 전체 보기에서는 먼저 크루 고르기로 돌아간다
    ncPickEl.classList.add('hidden');
  };
  $('ncSearch').addEventListener('input', (e) => { ncQuery = e.target.value; renderNcPick(); });
  ncPickEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-nc-all]')) { // 추천 크루 전체 보기 (크루 탭의 "전체 보기"처럼)
      ncAll = true;
      $('ncPickH').textContent = window.GAMJA_I18N.t('newchat.recommend');
      renderNcPick();
      ncPickEl.querySelector('.settings-body').scrollTop = 0;
      return;
    }
    const grp = e.target.closest('[data-nc-grp]'); // 묶음 접고 펴기 (크루 탭과 같은 기억)
    if (grp) { const shut = getShut(); shut[grp.dataset.ncGrp] = !shut[grp.dataset.ncGrp]; store.set('cc:crewShut', shut); return renderNcPick(); }
    const agent = e.target.closest('[data-pick-agent]');
    const row = e.target.closest('[data-pick]');
    if (!agent && !row) return;
    ncSel = agent ? { kind: 'agent', id: agent.dataset.pickAgent } : { kind: 'crew', name: row.dataset.pick };
    ncPickEl.classList.add('hidden');
    renderNcForm();
  });
  newChatEl.addEventListener('click', (e) => {
    if (!GROUP_CHAT_ENABLED && e.target.closest('[data-nc-open]')) return openNcPick();
    const row = e.target.closest('[data-pick]');
    if (!row) return;
    const n = row.dataset.pick;
    if (ncMembers.includes(n)) ncMembers = ncMembers.filter((x) => x !== n);
    else ncMembers = [...ncMembers, n].slice(-MAX_ROOM_MEMBERS); // 한도를 넘으면 먼저 고른 쪽이 빠진다 (지금은 한 명이라 바꿔 고르기)
    renderNewChat();
  });
  // 참여자 정보: 크루 설정으로 가거나, 이 방에서 내보낸다 (그룹 방에서 세 명 이상일 때만. 크루 자체는 지워지지 않는다)
  const memberEl = $('memberInfo');
  let memberTarget = '';
  const namesOf = (list) => Object.fromEntries(list.map((c) => [c, crewParts(c).text])); // 서버가 방에 남길 알림에 쓸 화면용 이름
  function openMemberInfo(crew) {
    const T = window.GAMJA_I18N.t;
    memberTarget = crew;
    const p = crewParts(crew);
    const canKick = project.includes('@') && roomMembers(project).length >= 3;
    $('memberBody').innerHTML =
      `<div class="member-hero"><i class="fr-av">${escapeHtml(p.icon)}</i><h1 class="ui-title">${escapeHtml(p.text)}</h1><p class="settings-note">${escapeHtml(crewBlurb(crew))}</p></div>` +
      `<button id="memberOpen" class="settings-ghost" type="button">${escapeHtml(T('member.open'))}</button>` +
      `<p class="settings-note">${escapeHtml(T(canKick ? 'member.kickNote' : 'member.kickNoteNo'))}</p>` +
      `<button id="memberKick" class="settings-danger" type="button"${canKick ? '' : ' disabled'}>${escapeHtml(T('member.kick'))}</button>`;
    memberEl.classList.remove('hidden');
  }
  $('memberBack').onclick = () => memberEl.classList.add('hidden');
  memberEl.addEventListener('click', async (e) => {
    const T = window.GAMJA_I18N.t;
    if (e.target.closest('#memberOpen')) return openProjectSettings(memberTarget);
    if (!e.target.closest('#memberKick') || e.target.closest('#memberKick').disabled) return;
    if (!(await gSheet({ title: T('member.kick'), message: T('member.kickConfirm', { name: crewParts(memberTarget).text }), ok: T('member.kick'), danger: true }))) return;
    try { await api('/api/rooms/members', { room: project, remove: memberTarget, names: namesOf(roomMembers(project)) }); } catch (err) { return alert(err.message); }
    await refreshChats();
    memberEl.classList.add('hidden');
    updateHomeBtn();
    openRoomSettings(); // 참여자 목록을 새로 그린다
  });
  // 참여자 초대: 아직 방에 없는 크루를 골라 넣는다 (최대 인원까지)
  const inviteEl = $('invitePanel');
  let invPick = [];
  function renderInvite() {
    const T = window.GAMJA_I18N.t;
    const members = roomMembers(project);
    const free = ['', ...projectList].filter((n) => !members.includes(n));
    const slots = MAX_ROOM_MEMBERS - members.length;
    $('inviteList').innerHTML = free.length ? free.map((n) => {
      const { icon, text } = crewParts(n);
      const on = invPick.includes(n);
      return `<button class="fr-row${on ? ' sel' : ''}" data-ipick="${escapeHtml(n)}" type="button"><i class="fr-av">${escapeHtml(icon)}</i>` +
        `<span class="fr-mid"><b>${escapeHtml(text)}</b><small>${escapeHtml(crewBlurb(n))}</small></span><span class="nc-check">${on ? '✓' : ''}</span></button>`;
    }).join('') : `<p class="settings-note">${escapeHtml(T('invite.none'))}</p>`;
    $('inviteNote').textContent = T('invite.note', { slots });
    $('inviteGo').disabled = !invPick.length;
  }
  function openInvite() {
    const T = window.GAMJA_I18N.t;
    invPick = [];
    $('inviteH').textContent = T('invite.title');
    $('inviteGo').textContent = T('invite.go');
    renderInvite();
    inviteEl.classList.remove('hidden');
  }
  $('inviteBack').onclick = () => inviteEl.classList.add('hidden');
  inviteEl.addEventListener('click', (e) => {
    const row = e.target.closest('[data-ipick]');
    if (!row) return;
    const n = row.dataset.ipick;
    const slots = MAX_ROOM_MEMBERS - roomMembers(project).length;
    if (invPick.includes(n)) invPick = invPick.filter((x) => x !== n);
    else if (invPick.length < slots) invPick = [...invPick, n];
    renderInvite();
  });
  $('inviteGo').onclick = async () => {
    if (!invPick.length) return;
    try { await api('/api/rooms/members', { room: project, add: invPick, names: namesOf(invPick) }); } catch (err) { return alert(err.message); }
    await refreshChats();
    inviteEl.classList.add('hidden');
    updateHomeBtn();
    openRoomSettings();
    loadConversation(); // 방에 남은 "참여했어요" 알림을 보여 준다
  };
  $('roomBack').onclick = () => roomEl.classList.add('hidden');
  roomEl.addEventListener('change', (e) => {
    if (e.target.id !== 'roomName') return;
    const titles = getRoomTitles();
    const v = e.target.value.trim();
    if (v) titles[project] = v; else delete titles[project];
    store.set('cc:roomTitle', titles);
    updateHomeBtn();
    chatKey = ''; // 채팅 목록의 이름도 새로 그린다
    toast(window.GAMJA_I18N.t('room.saved'));
  });
  roomEl.addEventListener('change', (e) => {
    if (e.target.id !== 'roomPin') return;
    const pins = getRoomPins();
    if (e.target.checked) pins[project] = true; else delete pins[project];
    store.set('cc:roomPin', pins);
    chatKey = '';
  });
  roomEl.addEventListener('click', (e) => {
    const member = e.target.closest('[data-member]');
    if (member) { if (GROUP_CHAT_ENABLED) openMemberInfo(member.dataset.member); else openProjectSettings(member.dataset.member); } // 내보내기는 그룹 채팅을 열 때부터. 그 전에는 바로 크루 설정
    if (e.target.closest('#roomInvite')) openInvite();
    if (e.target.closest('#roomRestore')) restoreGoneCrew();
  });
  $('roomDelete').onclick = async () => {
    const T = window.GAMJA_I18N.t;
    if (!(await gSheet({ title: T('room.deleteTitle'), message: T('room.deleteConfirm', { name: roomText(project) }), ok: T('room.deleteOk'), danger: true }))) return;
    if (runId || remoteRunId) return alert(T('chat.eraseBusy'));
    const name = project;
    try {
      if (isGone(name)) await api('/api/archive/delete', { id: name.slice(1) });
      else if (name.includes('@')) await api('/api/rooms/delete', { room: name });
      else await api('/api/history/reset', { project: name });
    } catch (err) { return alert(err.message); }
    forgetRoom(name);
    if (isGone(name) || name.includes('@')) { project = ''; store.set('cc:project', ''); swapRoomInput(name, ''); updateHomeBtn(); } // 없어진 방에서는 감자 톡톡으로 나간다
    roomEl.classList.add('hidden');
    showTab('chat');
  };
  const UPDATE_BTN_COOLDOWN = 1000; // 버전 옆 🔄 버튼을 누른 뒤 다시 누를 수 있기까지 (밀리초)

  // 감자 앱 기능 (앱 안에서만): 앱이 안드로이드 화면을 띄워 준다
  for (const [id, fn] of [['appUpdate', 'checkUpdate'], ['appLogin', 'openLogin'],
    ['appBattery', 'batterySettings'], ['appLog', 'showLog'], ['appLicense', 'showLicenses']]) {
    $(id).onclick = () => {
      try { window.GamjaApp[fn](); } catch { toast('감자 앱에서만 쓸 수 있어요'); }
      if (id === 'appUpdate') { // 업데이트 확인 버튼은 연달아 눌리지 않게 1초 동안 쉰다
        const b = $(id);
        b.disabled = true;
        setTimeout(() => { b.disabled = false; }, UPDATE_BTN_COOLDOWN);
      }
    };
  }
  // 감자 앱의 뒤로 가기 버튼: 열려 있는 창부터 하나씩 닫는다 (닫았으면 true). 위에 있는 창부터 확인
  window.gamjaBack = () => {
    if (gsOpen) { gsOpen.close(false); return true; } // 확인 시트가 열려 있으면 그것부터 닫는다
    if (!sheetEl.classList.contains('hidden')) { closeSheet(); return true; }
    for (const [panel, back] of [['viewPanel', 'viewBack'], ['sharePanel', 'shareBack'], ['ghPanel', 'ghBack'], ['ncPick', 'ncPickBack'], ['installPanel', 'installBack'], ['trashPanel', 'trashBack'], ['invitePanel', 'inviteBack'], ['newChat', 'newChatBack'], ['projSettings', 'projBack'], ['memberInfo', 'memberBack'], ['roomSettings', 'roomBack'], ['tunnelPanel', 'tunnelBack'],
      ['agentPicker', 'agentBack'], ['madePanel', 'madeBack']]) {
      if (!$(panel).classList.contains('hidden')) { $(back).click(); return true; }
    }
    if (!els.menu.classList.contains('hidden')) { els.menu.classList.add('hidden'); return true; }
    // 탭 화면: 더보기 하위 화면 → 더보기 목록 → 채팅 목록. 채팅방 → 채팅 목록. 채팅 목록에서는 앱이 알아서 처리(나가기)
    if (tab === 'more') {
      if ($('setList').classList.contains('hidden')) showSettingsPage(null); else showTab('chat');
      return true;
    }
    if (tab === 'crew') { showTab('chat'); return true; }
    if (tab === null) { showTab('chat'); return true; }
    return false;
  };

  // 설정 목록 → 하위 화면 (뒤로 가기는 목록으로, 목록에서는 닫기)
  // ---------- 🛠 도구 상자: 크루가 문서·그림·영상·소리를 만들 때 쓰는 도구를 설치한다 ----------
  let toolsTimer = 0;
  // 더보기 → 허용한 명령: 크루별로 "항상 허용"한 명령 목록과 지우기
  async function renderPerm() {
    const T = window.GAMJA_I18N.t;
    $('page-perm').dataset.title = T('perm.pageTitle');
    $('settingsTitle').textContent = T('perm.pageTitle');
    $('settingsHead').textContent = T('perm.pageTitle');
    let d;
    try { d = await api('/api/perm'); } catch { return; }
    const byCrew = {};
    for (const r of d.rules) (byCrew[r.crew] = byCrew[r.crew] || []).push(r);
    const groups = Object.entries(byCrew).map(([crew, rules]) =>
      `<h3>${escapeHtml(crewParts(crew).icon)} ${escapeHtml(crewParts(crew).text)}</h3>` +
      rules.map((r) => `<div class="tool-card"><div class="tool-mid"><b data-no-i18n>${escapeHtml(r.rule.replace(/^Bash\(|\)$/g, ''))}</b>` +
        `<small data-no-i18n>${escapeHtml(r.cmd)}</small></div>` +
        `<button class="tool-btn" type="button" data-crew="${escapeHtml(crew)}" data-rule="${escapeHtml(r.rule)}">${escapeHtml(T('perm.remove'))}</button></div>`).join('')).join('');
    $('permBody').innerHTML = `<p class="settings-note">${escapeHtml(T('perm.intro'))}</p>` +
      (groups || `<p class="settings-note">${escapeHtml(T('perm.empty'))}</p>`);
  }
  $('permBody').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-rule]');
    if (!b) return;
    b.disabled = true;
    try { await api('/api/perm/remove', { crew: b.dataset.crew, rule: b.dataset.rule }); } catch (err) { toast(err.message); }
    renderPerm();
  });
  async function renderTools() {
    let d;
    try { d = await api('/api/tools'); } catch { return; }
    const T = window.GAMJA_I18N.t;
    const cards = d.kits.map((k) => {
      const label = k.installed ? T('tools.installed') : d.installing === k.id ? T('tools.installing') : T('tools.install');
      return `<div class="tool-card"><div class="tool-mid"><b>${escapeHtml(k.name)}</b><small>${escapeHtml(k.desc)}</small><small>${escapeHtml(k.size)}</small></div>` +
        `<button class="tool-btn${k.installed ? ' done' : ''}" data-kit="${k.id}" type="button"${k.installed || d.installing ? ' disabled' : ''}>${escapeHtml(label)}</button></div>`;
    }).join('');
    $('toolsBody').innerHTML = `<p class="settings-note">${escapeHtml(T('tools.intro'))}</p>` + cards +
      (d.error ? `<p class="settings-note err">${escapeHtml(d.error)}</p>` : '') +
      (d.installing ? `<pre class="crew-pre" data-no-i18n>${escapeHtml(d.log.join('\n'))}</pre>` : '') +
      `<p class="settings-note">${escapeHtml(T('tools.note'))}</p>`;
    clearTimeout(toolsTimer);
    if (d.installing && !$('page-tools').classList.contains('hidden')) toolsTimer = setTimeout(renderTools, 3000); // 설치하는 동안 진행 상황을 따라간다
  }
  $('toolsBody').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-kit]');
    if (!b) return;
    b.disabled = true;
    try { await api('/api/tools/install', { kit: b.dataset.kit }); toast(window.GAMJA_I18N.t('tools.started')); }
    catch (err) { toast(err.message); }
    renderTools();
  });
  function showSettingsPage(page) {
    if (page === 'tools') renderTools();
    if (page === 'perm') renderPerm();
    $('setList').classList.toggle('hidden', !!page);
    $('setInfo').classList.toggle('hidden', !!page);
    for (const el of settingsEl.querySelectorAll('.set-page')) el.classList.toggle('hidden', el.id !== `page-${page}`);
    $('settingsTitle').textContent = page ? $(`page-${page}`).dataset.title : '⚙️ 설정';
    $('settingsHead').textContent = page ? $(`page-${page}`).dataset.title : '더보기'; // 새 디자인: 큰 제목은 화면 안에
    settingsEl.classList.toggle('sub', !!page); // 하위 화면에서만 위쪽 ←가 보인다
    settingsEl.querySelector('.settings-body').scrollTop = 0;
    updateGnb(); // 하위 화면에서는 아래 메뉴를 숨긴다
  }
  $('setList').addEventListener('click', (e) => {
    const b = e.target.closest('.set-row');
    if (b) showSettingsPage(b.dataset.page);
  });
  $('settingsBack').onclick = () => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); // 쓰던 글칸이 있으면 먼저 저장되게
    if ($('setList').classList.contains('hidden')) showSettingsPage(null);
    else showTab('chat');
  };
  // 바꾸는 즉시 저장 (선택은 바로, 글칸은 칸 밖을 누를 때)
  async function autoSaveSettings() {
    const pick = (name) => settingsEl.querySelector(`input[name=${name}]:checked`)?.value || '';
    try {
      await api('/api/settings', {
        nickname: $('setNickname').value, style: $('setStyle').value,
        model: pick('model'), autocompact: pick('autocompact'), effort: pick('effort'),
      });
      toast('✅ 저장했어요');
    } catch (err) { toast(err.message); }
  }
  for (const name of ['model', 'effort', 'autocompact']) {
    for (const r of settingsEl.querySelectorAll(`input[name=${name}]`)) r.addEventListener('change', autoSaveSettings);
  }
  $('setNickname').addEventListener('change', autoSaveSettings);
  $('setStyle').addEventListener('change', autoSaveSettings);
  for (const r of settingsEl.querySelectorAll('input[name=textSize]')) {
    r.addEventListener('change', () => {
      applyMsgZoom(Number(r.value));
      store.set('cc:zoom', msgZoom);
      toast('✅ 바꿨어요');
    });
  }
  for (const r of settingsEl.querySelectorAll('input[name=theme]')) {
    r.addEventListener('change', () => {
      theme = r.value;
      store.set('cc:theme', theme);
      applyTheme(theme);
      toast('✅ 바꿨어요');
    });
  }
  // 화면 언어: 고르면 저장하고 새로고침해서 적용한다 (자동 = 폰의 언어를 따라감)
  for (const r of settingsEl.querySelectorAll('input[name=lang]')) {
    r.addEventListener('change', () => {
      window.GAMJA_I18N.setLang(r.value);
      location.reload();
    });
  }

  // ---------- 🗜 대화 압축 ----------
  $('compactBtn').onclick = async () => {
    els.menu.classList.add('hidden');
    if (runId || remoteRunId) return alert('응답이 끝난 뒤에 해 주세요.');
    if (!(await gSheet({ title: '대화를 압축할까요?', message: '화면의 대화 기록은 그대로 남고, Claude의 기억만 요약본으로 바뀌어요. 오래된 세부 내용은 일부 빠질 수 있어요.', ok: '압축하기' }))) return;
    try { await api('/api/compact', { project }); } catch (err) { return alert(err.message); }
    roomEl.classList.add('hidden'); // 채팅방 설정에서 눌렀으면 설정 화면을 닫는다
    loadConversation(); // 진행 상황을 따라가며 보여 준다
  };

  // ---------- 🌐 외부 접속 주소 (https 터널) ----------
  const tunnelEl = $('tunnelPanel');
  let tunnelPoll = 0;
  const TUNNEL_LABEL = { off: '꺼짐', starting: '켜는 중... (처음에는 1분쯤 걸려요)', on: '✅ 켜짐', error: '⚠️ 문제가 생겼어요' };
  function renderTunnel(t) {
    $('tunnelStatus').textContent = TUNNEL_LABEL[t.status] || t.status;
    $('tunnelUrl').textContent = t.url || '';
    $('tunnelUrlRow').classList.toggle('hidden', !t.url);
    $('tunnelCopy').classList.toggle('hidden', !t.url);
    $('tunnelError').textContent = t.error || '';
    $('tunnelError').classList.toggle('hidden', !t.error);
    if (t.weakPassword !== undefined) $('tunnelWeak').classList.toggle('hidden', !t.weakPassword);
    const toggle = $('tunnelToggle');
    toggle.textContent = t.status === 'on' ? '끄기' : t.status === 'starting' ? '켜는 중...' : '켜기';
    toggle.disabled = t.status === 'starting';
    toggle.dataset.on = t.status === 'on' ? '1' : '';
  }
  async function refreshTunnel() {
    clearTimeout(tunnelPoll);
    let t;
    try { t = await api('/api/tunnel'); } catch { return; }
    $('tunnelPro').classList.toggle('hidden', !t.pro);
    $('proLocked').classList.toggle('hidden', !!t.pro);
    renderTunnel(t);
    if (t.status === 'starting' && !tunnelEl.classList.contains('hidden')) tunnelPoll = setTimeout(refreshTunnel, 1500);
  }
  // 같은 와이파이 접속 스위치 (기본 꺼짐)
  async function refreshLan() {
    const T = window.GAMJA_I18N.t;
    let d;
    try { d = await api('/api/lan'); } catch { return; }
    $('lanToggle').checked = d.enabled;
    $('lanInfo').classList.toggle('hidden', !d.enabled);
    // 첫 주소로 QR을 만들어 보여 준다 (다른 폰의 카메라로 찍으면 바로 열려요)
    lanAddr = d.addresses[0] || '';
    const qr = lanAddr && window.GAMJA_QR ? window.GAMJA_QR.svg(lanAddr) : '';
    $('lanQr').innerHTML = qr;
    $('lanQr').classList.toggle('hidden', !qr);
    $('lanQrHint').classList.toggle('hidden', !qr);
    $('lanAddrs').textContent = d.addresses.length ? d.addresses.join('\n') : T('ext.lanNone');
    $('lanCopy').classList.toggle('hidden', !lanAddr);
    $('lanShowApp').classList.toggle('hidden', !window.GamjaApp);
  }
  let lanAddr = '';
  $('lanCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(lanAddr); toast(window.GAMJA_I18N.t('ext.copied')); }
    catch { gCopy(window.GAMJA_I18N.t('ext.copy'), lanAddr); }
  };
  $('lanToggle').onchange = async () => {
    try { await api('/api/lan', { on: $('lanToggle').checked }); } catch (err) { alert(err.message); }
    refreshLan();
  };
  $('lanShowApp').onclick = () => {
    try { window.GamjaApp.showAddress(); } catch { toast('감자 앱에서만 쓸 수 있어요'); }
  };
  $('tunnelBtn').onclick = () => {
    const T = window.GAMJA_I18N.t;
    for (const [id, key] of [['extTitle', 'ext.title'], ['lanH', 'ext.lanH'], ['lanLabel', 'ext.lanLabel'], ['lanNote', 'ext.lanNote'],
      ['lanShowApp', 'ext.lanShowApp'], ['lanPwNote', 'ext.lanPwNote'], ['lanQrHint', 'ext.qrHint'], ['lanCopy', 'ext.copy'], ['proH', 'ext.proH'], ['proLockedTitle', 'ext.proTitle'], ['proLockedNote', 'ext.proNote']]) $(id).textContent = T(key);
    els.menu.classList.add('hidden');
    tunnelEl.classList.remove('hidden');
    refreshLan();
    refreshTunnel();
  };
  $('tunnelBack').onclick = () => { clearTimeout(tunnelPoll); tunnelEl.classList.add('hidden'); };
  $('tunnelToggle').onclick = async () => {
    const turnOn = !$('tunnelToggle').dataset.on;
    if (turnOn && !(await gSheet({ title: '인터넷에 공개되는 주소를 만들까요?', message: '주소를 아는 누구나 로그인 화면까지 올 수 있어요.', ok: '만들기', danger: true }))) return;
    try { await api('/api/tunnel', { on: turnOn }); } catch (err) { return alert(err.message); }
    refreshTunnel();
  };
  $('tunnelCopy').onclick = async () => {
    const url = $('tunnelUrl').textContent;
    try { await navigator.clipboard.writeText(url); alert('주소를 복사했어요. 다른 기기의 브라우저에 붙여 넣으세요.'); }
    catch { gCopy('이 주소를 복사하세요', url); }
  };

  // ---------- 🐙 GitHub 연결 (기록 보관) ----------
  const ghEl = $('ghPanel');
  const ghBody = $('ghBody');
  let ghUiTimer = 0;
  async function renderGh() {
    let s;
    try { s = await api('/api/github/status'); } catch { return; }
    if (ghEl.classList.contains('hidden')) return;
    let html;
    if (s.connected) {
      html = `<div class="share-card"><div class="share-icon">🐙</div><b>@${escapeHtml(s.login)}</b><small>${escapeHtml(s.repo)} · 비공개 저장소</small></div>` +
        `<p class="settings-row"><span>마지막 기록</span><b>${s.syncing ? '기록하는 중…' : s.lastSync ? ago(s.lastSync) : '아직 없어요'}</b></p>` +
        (s.lastCount ? `<p class="settings-row"><span>그때 바뀐 파일</span><b>${s.lastCount}개</b></p>` : '') +
        (s.lastError ? `<p class="settings-note err">⚠️ ${escapeHtml(s.lastError)}</p>` : '') +
        (s.skipped.length ? `<p class="settings-note">ⓘ 자기 git 기록이 이미 있는 폴더는 건너뛰어요: ${s.skipped.map(escapeHtml).join(', ')}</p>` : '') +
        `<a class="settings-save ghlink" href="https://github.com/${encodeURIComponent(s.login)}/${encodeURIComponent(s.repo)}" target="_blank" rel="noopener">GitHub에서 보기</a>` +
        '<button id="ghSync" class="settings-ghost" type="button">지금 기록하기</button>' +
        '<p class="settings-note">• 크루가 답을 끝낼 때마다 그 크루 폴더의 바뀐 파일이 자동으로 기록돼요.<br>• <b>대화 내용은 올리지 않아요.</b> 점(.)으로 시작하는 파일, 비밀번호·열쇠처럼 보이는 파일, 1MB 넘는 파일도 올리지 않아요.<br>• 저장소가 공개로 바뀌면 기록을 멈춰요.</p>' +
        '<button id="ghOff" class="settings-danger" type="button">연결 끊기</button>' +
        '<p class="settings-note">연결을 끊으면 이 폰에 저장한 열쇠를 지워요. GitHub 쪽 승인까지 완전히 취소하려면 github.com/settings/applications 에서 GAMJA를 지워 주세요. 이미 올라간 기록은 그대로 남아요.</p>';
    } else if (s.pending && !s.pending.error) {
      html = '<p class="settings-note">GitHub에서 아래 코드를 입력해 승인해 주세요. 승인되면 이 화면이 자동으로 바뀌어요.</p>' +
        `<div class="gh-code">${escapeHtml(s.pending.user_code)}</div>` +
        `<a class="settings-save ghlink" href="${escapeHtml(s.pending.verification_uri)}" target="_blank" rel="noopener">GitHub 열어서 코드 입력하기</a>` +
        '<button id="ghCopy" class="settings-ghost" type="button">📋 코드 복사</button>' +
        '<p class="settings-note">GitHub 화면에서 <b>Authorize</b>를 누르면 끝나요. 승인 화면에 "private 저장소" 권한이 보이는 건, 비공개 저장소(gamja-workspace)를 만들고 쓰기 위해서예요.</p>';
    } else {
      html = (s.pending && s.pending.error ? `<p class="settings-note err">⚠️ ${escapeHtml(s.pending.error)}</p>` : '') +
        '<p class="settings-note">크루가 일한 결과(파일)를 <b>내 GitHub 계정의 비공개 저장소</b>에 자동으로 기록해 둬요. 언제든 이전 상태를 볼 수 있고, 폰을 바꿔도 되살릴 수 있어요.</p>' +
        '<h3>어떻게 되나요</h3>' +
        '<p class="settings-note">• GitHub 승인은 <b>한 번만</b> 해요. 비밀번호를 감자에 입력하지 않아요.<br>• 내 계정에 <b>gamja-workspace</b>라는 비공개 저장소가 생겨요.<br>• 열쇠는 <b>이 폰에만</b> 저장되고, 우리에게 보내지 않아요.<br>• 대화 내용은 올리지 않아요.</p>' +
        '<button id="ghConnect" class="settings-save" type="button">GitHub 연결하기</button>' +
        '<p class="settings-note">GitHub 계정이 없으면 github.com에서 무료로 만들 수 있어요.</p>';
    }
    ghBody.innerHTML = html;
  }
  $('ghBtn').onclick = () => {
    ghEl.classList.remove('hidden');
    renderGh();
    clearInterval(ghUiTimer);
    ghUiTimer = setInterval(renderGh, 3000); // 승인 여부와 기록 상태를 따라간다
  };
  $('ghBack').onclick = () => { clearInterval(ghUiTimer); ghEl.classList.add('hidden'); };
  ghBody.addEventListener('click', async (e) => {
    const id = e.target.id;
    try {
      if (id === 'ghConnect') { await api('/api/github/start', {}); renderGh(); }
      else if (id === 'ghCopy') {
        const code = ghBody.querySelector('.gh-code').textContent;
        try { await navigator.clipboard.writeText(code); toast('📋 코드를 복사했어요'); } catch { gCopy('이 코드를 복사하세요', code); }
      } else if (id === 'ghSync') { await api('/api/github/sync', {}); toast('기록을 시작했어요'); renderGh(); }
      else if (id === 'ghOff') {
        if (!(await gSheet({ title: 'GitHub 연결을 끊을까요?', message: '이 폰에 저장한 열쇠를 지우고, 앞으로는 기록하지 않아요. 이미 올라간 기록은 그대로 남아요.', ok: '연결 끊기', danger: true }))) return;
        await api('/api/github/disconnect', {});
        toast('연결을 끊었어요');
        renderGh();
      }
    } catch (err) { toast(err.message); }
  });

  // ---------- 📁 크루 설정 (지침·모델·이름 바꾸기·삭제) ----------
  const projEl = $('projSettings');
  let projLoadedInstructions = '';
  let projTarget = ''; // 지금 설정 화면이 가리키는 크루 (홈 화면에서 다른 크루의 ⚙️를 눌러도 그 크루를 고친다)
  async function openProjectSettings(name = '') {
    projTarget = name;
    els.menu.classList.add('hidden');
    let d;
    try { d = await api('/api/project-settings?project=' + encodeURIComponent(name)); } catch (err) { return alert(err.message); }
    $('projTitle').textContent = name ? `⚙️ ${crewLabel(name)}` : `⚙️ ${ROOT_NAME}`;
    projLoadedInstructions = d.instructions;
    // "직접 만들기"와 같은 입력 양식. 감자 톡톡(루트)과 감자 앱이 들어 있는 폴더는 이름·아이콘을 바꾸지 않고 맡은 일만 보여 준다
    const withInfo = !!name && !d.locked;
    const meta = name ? crewMeta(name) : null;
    const parts = crewParts(name);
    $('projForm').innerHTML = crewFormHtml('ps', {
      icon: parts.icon, name: parts.text, blurb: (meta && meta.blurb) || '', group: (meta && meta.group) || '', job: d.instructions,
    }, { withInfo, jobRows: 8 });
    for (const r of projEl.querySelectorAll('input[name=projModel]')) r.checked = r.value === (d.model || '');
    for (const r of projEl.querySelectorAll('input[name=projEffort]')) r.checked = r.value === (d.effort || '');
    // 루트(전체)와 GAMJA 앱이 들어 있는 폴더는 삭제 불가
    $('projDelete').classList.toggle('hidden', d.locked);
    $('projExport').classList.toggle('hidden', !name); // 홈 대화는 내보낼 크루가 없다
    projEl.classList.remove('hidden');
  }
  // 바꾸는 즉시 저장: 모델·생각 깊이는 고르는 순간, 지침은 글칸 밖을 누를 때. 이름 바꾸기는 따로 버튼으로
  async function autoSaveProject() {
    const form = readCrewForm($('projForm'), 'ps');
    const instructions = form.job;
    if (projLoadedInstructions.trim() && !instructions.trim() && !(await gSheet({ title: '지침을 모두 지울까요?', message: '이 크루의 CLAUDE.md 파일이 삭제돼요.', ok: '지우기', danger: true }))) {
      $('psJob').value = projLoadedInstructions;
      return;
    }
    // 이름·아이콘·소개·묶음: 이 기기에 저장해 두는 화면용 정보 (폴더 이름은 그대로)
    if (projTarget && form.name !== null) {
      const prev = crewMeta(projTarget) || {};
      const keepName = crewParts(projTarget).text;
      const meta = {
        name: form.name || keepName,
        icon: form.icon || prev.icon || crewParts(projTarget).icon,
        blurb: form.blurb,
        group: form.group || prev.group || 'personal',
        examples: prev.examples || [],
      };
      store.set(`cc:crew:${projTarget}`, meta);
      $('projTitle').textContent = `⚙️ ${crewLabel(projTarget)}`;
      updateHomeBtn();
      if (!$('homePanel').classList.contains('hidden')) renderHome();
      chatKey = ''; // 채팅 목록의 이름·아이콘도 새로 그린다
    }
    const model = projEl.querySelector('input[name=projModel]:checked')?.value || '';
    const effort = projEl.querySelector('input[name=projEffort]:checked')?.value || '';
    try {
      await api('/api/project-settings', { project: projTarget, instructions, model, effort });
      projLoadedInstructions = instructions;
      toast('✅ 저장했어요');
    } catch (err) { toast(err.message); }
  }
  // 양식(아이콘·이름·소개·묶음·맡은 일)은 고치고 칸 밖을 누르거나 고르는 순간 저장한다 (만들기 화면과 같은 양식)
  $('projForm').addEventListener('change', autoSaveProject);
  $('projForm').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ic]');
    if (b) { pickIcon(b); autoSaveProject(); }
  });
  for (const r of projEl.querySelectorAll('input[name=projModel], input[name=projEffort]')) r.addEventListener('change', autoSaveProject);
  $('projBack').onclick = () => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); // 쓰던 글칸이 있으면 먼저 저장되게
    projEl.classList.add('hidden');
  };
  $('projDelete').onclick = async () => {
    if (!(await gSheet({ title: window.GAMJA_I18N.t('crew.deleteTitle'), message: window.GAMJA_I18N.t('crew.deleteConfirm', { name: projTarget }), ok: window.GAMJA_I18N.t('room.deleteOk'), danger: true }))) return;
    try { await api('/api/projects/delete', { project: projTarget }); } catch (err) { return alert(err.message); }
    const wasCurrent = projTarget === crewOf(project);
    projEl.classList.add('hidden');
    if (wasCurrent) await switchProject(''); else await loadProjects();
  };
  // ---------- 🔒 로그인 비밀번호 바꾸기 ----------
  const PW_RE = /^[A-Za-z0-9._@#%+=:,\/^!-]{8,64}$/;
  let pwLocal = false;
  const pwNew = $('pwNew');
  function pwStrength() {
    const v = pwNew.value;
    const el = $('pwStrength');
    const bad = [...new Set(v.replace(/[A-Za-z0-9._@#%+=:,\/^!-]/g, ''))];
    if (!v) el.textContent = '';
    else if (bad.length) el.textContent = `쓸 수 없는 글자가 있어요: ${bad.join(' ')}`;
    else if (v.length < 8) el.textContent = '너무 짧아요 (8자 이상)';
    else if (v.length < 12) el.textContent = '보통이에요. 12자 이상이면 더 안전해요';
    else el.textContent = '좋아요 👍';
    el.classList.toggle('err', !!v && (bad.length > 0 || v.length < 8));
  }
  pwNew.addEventListener('input', pwStrength);
  $('pwShow').onchange = (e) => { pwNew.type = e.target.checked ? 'text' : 'password'; };
  // 헷갈리는 글자(0 O 1 l I)를 뺀 글자로 5자씩 4묶음 (예: k7Hqm-3ZtPf-9xWra-X4eNb)
  $('pwGen').onclick = async () => {
    const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const limit = 256 - (256 % alphabet.length); // 골고루 뽑기 위해 치우치는 값은 버린다
    const pick = () => { let b; do { b = crypto.getRandomValues(new Uint8Array(1))[0]; } while (b >= limit); return alphabet[b % alphabet.length]; };
    const group = () => Array.from({ length: 5 }, pick).join('');
    const pw = [group(), group(), group(), group()].join('-');
    pwNew.value = pw;
    $('pwShow').checked = true;
    pwNew.type = 'text';
    pwStrength();
    try { await navigator.clipboard.writeText(pw); toast('📋 복사했어요. 저장하기 전에 꼭 적어 두세요'); }
    catch { toast('보이는 비밀번호를 꼭 적어 두세요'); }
  };
  $('pwSave').onclick = async () => {
    const current = $('pwCur').value;
    const next = pwNew.value;
    if ((!pwLocal && !current) || !next) return toast(pwLocal ? '새 비밀번호를 적어 주세요' : '현재 비밀번호와 새 비밀번호를 모두 적어 주세요');
    if (!PW_RE.test(next)) return alert('새 비밀번호는 8~64자이고, 영문·숫자와 . _ - @ # % + = : , / ^ ! 만 쓸 수 있어요.');
    if (!(await gSheet({ title: window.GAMJA_I18N.t('pw.confirmTitle'), message: window.GAMJA_I18N.t('pw.confirmMsg'), ok: window.GAMJA_I18N.t('pw.confirmOk'), danger: true }))) return;
    let r;
    try { r = await api('/api/password', { current, next }); } catch (err) { return alert(err.message); }
    settingsEl.classList.add('hidden');
    if (!r.restarting) return alert('바꿨어요. 감자알을 다시 켜면 새 비밀번호가 적용돼요.');
    toast('🔒 바꿨어요. 잠시 뒤 새 비밀번호로 로그인해 주세요');
    // 감자알이 다시 켜질 때까지 기다렸다가 새로고침 → 로그인 화면
    for (let i = 0; i < 40; i++) {
      await new Promise((ok) => setTimeout(ok, 1000));
      try { const m = await fetch('/api/me'); if (m.ok && (await m.json()).boot !== bootId) break; } catch { /* 아직 꺼져 있음 */ }
    }
    location.reload();
  };

  // 다른 폰에 감자 설치: 내려받기 QR + 설치 순서. 새 폰이 QR을 찍으면 홈페이지(내려받기 버튼)가 열린다
  // (예전의 Termux 명령 방식은 개발용 폰을 만들던 길이라 개발자 모드에서만 보여 준다)
  const installEl = $('installPanel');
  const installUrl = () => (window.GAMJA_I18N.lang === 'en' ? 'https://webgamja.com/en/' : 'https://webgamja.com/');
  function openInstall() {
    const T = window.GAMJA_I18N.t;
    els.menu.classList.add('hidden');
    for (const [id, key] of [['installH', 'install.title'], ['installNote', 'install.note'], ['installQrHint', 'install.qrHint'], ['installCopy', 'install.copy'],
      ['installStepsH', 'install.stepsH'], ['installMove', 'install.move'], ['installDevH', 'install.devH'], ['installDevNote', 'install.devNote'], ['installTermux', 'install.devBtn']]) $(id).textContent = T(key);
    const url = installUrl();
    $('installQr').innerHTML = window.GAMJA_QR ? window.GAMJA_QR.svg(url) : '';
    $('installQr').classList.toggle('hidden', !$('installQr').innerHTML);
    $('installUrl').textContent = url.replace('https://', '');
    $('installSteps').innerHTML = [1, 2, 3, 4].map((n) => `<p class="install-step"><b>${n}</b><span>${escapeHtml(T(`install.s${n}`))}</span></p>`).join('');
    $('installDev').classList.toggle('hidden', !proUi);
    installEl.classList.remove('hidden');
  }
  $('installBtn').onclick = openInstall;
  $('installBack').onclick = () => installEl.classList.add('hidden');
  $('installCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(installUrl()); toast(window.GAMJA_I18N.t('install.copied')); }
    catch { gCopy(window.GAMJA_I18N.t('install.copy'), installUrl()); }
  };
  // 개발자 모드: 새 폰의 Termux에 붙여 넣을 한 줄 명령 (30분 유효)
  $('installTermux').onclick = async () => {
    let command;
    try { ({ command } = await api('/api/install-link', {})); } catch (err) { return alert(err.message); }
    let copied = false;
    try { await navigator.clipboard.writeText(command); copied = true; } catch {}
    gCopy('다른 폰에 감자 설치', command, `${copied ? '명령을 복사했어요. ' : ''}새 폰에서 Termux를 열고 이 명령을 붙여 넣으세요. (30분 동안 유효, 두 폰이 같은 와이파이에 있어야 해요)`);
  };
  $('rollbackBtn').onclick = () => adminAction('/api/admin/rollback', window.GAMJA_I18N.t('admin.rollbackTitle'), window.GAMJA_I18N.t('admin.rollbackMsg'), window.GAMJA_I18N.t('admin.rollbackOk'));
  // ---------- 화면비율 (⋯ 메뉴): 크롬의 확대·축소 줄처럼 [−] 100% [＋] ----------
  function renderZoomRow() {
    const T = window.GAMJA_I18N.t;
    const i = ZOOM_STEPS.indexOf(msgZoom);
    $('zoomLabel').textContent = T('menu.zoom');
    $('zoomVal').textContent = `${Math.round(msgZoom * 100)}%`;
    $('zoomVal').title = T('menu.zoomReset');
    $('zoomOut').disabled = i <= 0;
    $('zoomIn').disabled = i >= ZOOM_STEPS.length - 1;
  }
  function stepZoom(dir) {
    const i = Math.max(0, Math.min(ZOOM_STEPS.length - 1, ZOOM_STEPS.indexOf(msgZoom) + dir));
    applyMsgZoom(ZOOM_STEPS[i]);
    store.set('cc:zoom', msgZoom);
    renderZoomRow();
  }
  $('zoomOut').onclick = () => stepZoom(-1);
  $('zoomIn').onclick = () => stepZoom(1);
  $('zoomVal').onclick = () => { applyMsgZoom(1); store.set('cc:zoom', msgZoom); renderZoomRow(); }; // 가운데 숫자를 누르면 100%로
  els.menuBtn.onclick = (e) => { e.stopPropagation(); renderZoomRow(); els.menu.classList.toggle('hidden'); };
  document.addEventListener('click', (e) => { if (!els.menu.contains(e.target)) els.menu.classList.add('hidden'); });

  // ---------- 메시지 렌더링 ----------
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function fmtTime(ts) {
    const d = new Date(ts);
    const h = d.getHours();
    return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function nearBottom() {
    const m = els.messages;
    return m.scrollHeight - m.scrollTop - m.clientHeight < 120;
  }
  // force: 내가 보냈거나 새 대화를 불러왔을 때 → 무조건 맨 아래로 (그리고 다시 따라가기 시작).
  // force가 아니면 "따라가는 중"일 때만 내려간다
  // 사용자가 손가락·휠로 직접 스크롤하는 중인지 (손을 뗀 뒤 관성으로 밀리는 시간 포함).
  // "따라가기" 상태는 사용자가 직접 움직일 때만 바꾼다. 우리가 자동으로 내린 스크롤이 상태를 되돌려 놓으면
  // 위로 올려도 자꾸 맨 아래로 끌려 내려가기 때문이다
  let userScrollUntil = 0;
  const userScrolling = () => performance.now() < userScrollUntil;
  function scrollBottom(force) {
    if (force) follow = true;
    if (!force && !follow) return;
    requestAnimationFrame(() => {
      // 기다리는 사이에 사용자가 위로 올렸거나 지금 스크롤 중이면 내리지 않는다
      if (!force && (!follow || userScrolling())) return;
      els.messages.scrollTop = els.messages.scrollHeight;
      noteBox();
    });
  }
  // 위로 올렸을 때 나타나는 "맨 아래로" 버튼
  const toBottomBtn = $('toBottom');
  function updateToBottom() {
    const m = els.messages;
    const far = m.scrollHeight - m.scrollTop - m.clientHeight > 160;
    toBottomBtn.classList.toggle('hidden', !far);
    // 버튼은 대화 영역 맨 아래 오른쪽 모서리에 붙인다. fixed의 top과 getBoundingClientRect가 같은 기준이라 키보드·입력창 높이가 바뀌어도 어긋나지 않는다
    if (far) toBottomBtn.style.top = `${Math.round(m.getBoundingClientRect().bottom - toBottomBtn.offsetHeight - 12)}px`;
  }
  // 키보드가 올라오거나 내려가고 입력창 높이가 바뀌어 대화 영역의 높이가 달라지면 카카오톡처럼 "아래쪽 기준"으로 맞춘다:
  // 맨 아래까지 남은 거리(dist)를 그대로 유지한다. 그래서 어느 화면을 보고 있었든 보던 내용이 입력창(키보드) 위에 그대로 붙어서 따라 움직이고,
  // 맨 아래를 보고 있었다면(dist 0) 계속 맨 아래다. 브라우저가 높이가 커질 때 스크롤을 스스로 줄여 놓아도 결과가 같다
  function onMessagesResize() {
    const m = els.messages;
    if (lastBox.ch && m.clientHeight !== lastBox.ch) m.scrollTop = m.scrollHeight - m.clientHeight - lastBox.dist;
    noteBox();
    updateToBottom();
  }
  if (window.ResizeObserver) new ResizeObserver(onMessagesResize).observe(els.messages);
  window.addEventListener('resize', onMessagesResize);
  // (높이가 바뀐 만큼만 맞추므로 키보드가 올라오는 동안 여러 번 불려도 문제없다)
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onMessagesResize);
  noteBox();
  for (const ev of ['touchstart', 'touchmove', 'touchend', 'wheel', 'pointerdown']) {
    els.messages.addEventListener(ev, () => { userScrollUntil = performance.now() + 1500; }, { passive: true });
  }
  els.messages.addEventListener('scroll', () => {
    const m = els.messages;
    // 사용자가 직접 움직였을 때만: 맨 아래 근처면 따라가기, 위로 올리면 멈춤
    if (userScrolling()) follow = m.scrollHeight - m.scrollTop - m.clientHeight < 40;
    if (userScrolling()) loadOlder(); // 사용자가 직접 위로 올릴 때만 오래된 대화를 붙인다
    noteBox();
    updateToBottom();
  }, { passive: true });
  toBottomBtn.onclick = () => scrollBottom(true);

  // m: {role:'user'|'bot'|'error', text, ts, tools?, meta?}
  // into: 말풍선을 붙일 곳 (기본은 대화 영역 맨 아래. 오래된 대화를 위에 붙일 때는 조각 모음을 넘긴다)
  function addMessage(m, into = els.messages) {
    if (into === els.messages) {
      const empty = els.messages.querySelector('.empty');
      if (empty) empty.remove();
    }
    if (m.role === 'notice') {
      const n = document.createElement('div');
      n.className = 'notice';
      n.textContent = m.text;
      into.appendChild(n);
      return null;
    }
    const row = document.createElement('div');
    row.className = `row ${m.role === 'user' ? 'me' : m.role === 'error' ? 'bot error' : 'bot'}`;
    if (m.role === 'user') {
      row.innerHTML = `<div class="col"><div class="line"><div class="bubble"></div><span class="time"></span></div></div>`;
    } else {
      row.innerHTML = `<div class="avatar">✳︎</div><div class="col"><div class="name">Claude</div>` +
        `<div class="line"><div class="bubble"></div><span class="time"></span></div><div class="extra"></div></div>`;
    }
    // 그룹 채팅의 크루 말풍선은 Claude 대신 그 크루의 이름을 보여 준다 (사회자 정리는 "정리")
    if (m.by !== undefined && m.role !== 'user') row.querySelector('.name').textContent = m.summary ? window.GAMJA_I18N.t('room.summary') : crewParts(m.by).text;
    into.appendChild(row);
    const view = {
      row,
      bubble: row.querySelector('.bubble'),
      time: row.querySelector('.time'),
      extra: row.querySelector('.extra'),
    };
    view.time.textContent = m.ts ? fmtTime(m.ts) : '';
    paint(view, m);
    return view;
  }
  function imageUrl(name) {
    return `/api/uploads?project=${encodeURIComponent(project)}&name=${encodeURIComponent(name)}`;
  }
  const INSTALL_MARK = /\s*\[\[gamja-install:\w+\]\]\s*/g;
  function permCardHtml(d) {
    const T = window.GAMJA_I18N.t;
    const blocked = !d.once; // 위험하거나 이어진 명령: 허용 버튼 없이 안내만
    const btn = (mode, label, cls = '') => `<button class="perm-btn ${cls}" type="button" data-mode="${mode}">${escapeHtml(label)}</button>`;
    return `<div class="perm-card${blocked ? ' blocked' : ''}" data-id="${escapeHtml(d.id)}"><b>${escapeHtml(T('perm.title'))}</b>` +
      `<code data-no-i18n>${escapeHtml(d.cmd)}</code>` +
      (blocked ? '' : `<small>👍 ${escapeHtml(T('perm.good.' + d.risk))}</small>`) +
      `<small>⚠️ ${escapeHtml(T('perm.warn.' + d.risk))}</small>` +
      `<div class="perm-btns">${blocked ? btn('no', T('perm.ok'))
        : btn('once', T('perm.once'), 'main') + (d.always ? btn('always', T('perm.always')) : '') + btn('no', T('perm.no'), 'ghost')}</div>` +
      (d.always ? `<small class="perm-note">${escapeHtml(T('perm.alwaysNote'))}</small>` : '') + '</div>';
  }
  function paint(view, m, streaming) {
    if (m.role === 'user' && (m.images || m.localImages)) {
      // 첨부 이미지 + 글 (보내는 중에는 미리보기 주소, 저장 후에는 서버 주소)
      view.bubble.textContent = '';
      const srcs = m.localImages || m.images.map(imageUrl);
      const box = document.createElement('div');
      box.className = 'bubble-images';
      for (const src of srcs) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = '첨부 이미지';
        img.loading = 'lazy';
        img.onclick = () => window.open(src, '_blank');
        box.appendChild(img);
      }
      view.bubble.appendChild(box);
      if (m.text) view.bubble.appendChild(document.createTextNode(m.text));
    } else if (m.role === 'user' || m.role === 'error') view.bubble.textContent = m.text;
    else {
      // 크루가 "도구 설치가 필요해요"라고 붙인 표시 줄은 글에서 숨긴다 (쓰는 중인 반쪽짜리 표시도 함께)
      const shown = m.text ? m.text.replace(INSTALL_MARK, '\n').replace(/\s*\[\[gamja[^\]]*$/, '').trim() : '';
      view.bubble.innerHTML = shown ? window.renderMarkdown(shown) : '';
      view.bubble.classList.toggle('cursor', !!streaming);
    }
    if (!view.extra) return;
    let html = '';
    // 답이 오는 동안 이 칸은 계속 새로 그려지므로, 펼쳐 둔 상태를 기억해 두었다가 그대로 다시 펼쳐 준다
    if (!view.extra.dataset.toggleWatch) {
      view.extra.dataset.toggleWatch = '1';
      view.extra.addEventListener('toggle', (e) => { if (e.target.matches('details.tools')) view.toolsOpen = e.target.open; }, true);
    }
    if (m.tools && m.tools.length) {
      html += `<details class="tools"${view.toolsOpen ? ' open' : ''}><summary>🔧 도구 ${m.tools.length}회 사용</summary>` +
        m.tools.map((t) => `<div>${escapeHtml(t)}</div>`).join('') + '</details>';
    }
    // 설치 안 된 도구가 필요할 때: 누르면 설치하고 하던 일을 이어서 하는 카드
    if (m.install && m.install.length) {
      const T = window.GAMJA_I18N.t;
      html += m.install.map((k) => `<div class="install-card"><b>${escapeHtml(T('tool.need', { name: k.name }))}</b><small>${escapeHtml(T('tool.sub', { size: k.size }))}</small>` +
        `<button class="install-go" type="button" data-kit="${escapeHtml(k.id)}">${escapeHtml(T('tool.go'))}</button></div>`).join('');
    }
    // 막힌 명령: 허용 여부를 묻는 카드 (이번만 / 항상 / 허용 안 함)
    for (const d of (m.denied || []).filter((x) => !x.answered)) html += permCardHtml(d);
    if (m.meta) html += `<div class="meta">${escapeHtml(m.meta)}</div>`;
    if (!streaming && m.text && m.role === 'bot') html += `<button class="speak-btn" type="button" title="읽어주기">🔊</button>`;
    view.extra.innerHTML = html;
    const sb = view.extra.querySelector('.speak-btn');
    if (sb) sb.onclick = () => speak(m.text, true);
  }

  // 허용 카드: 고른 뒤 허용했으면 하던 일을 이어서 해 달라고 자동으로 보낸다
  els.messages.addEventListener('click', async (e) => {
    const b = e.target.closest('.perm-btn');
    if (!b) return;
    const T = window.GAMJA_I18N.t;
    const card = b.closest('.perm-card');
    const mode = b.dataset.mode;
    const room = project;
    const buttons = card.querySelectorAll('button');
    buttons.forEach((x) => { x.disabled = true; });
    try { await api('/api/perm/answer', { project: room, id: card.dataset.id, mode }); }
    catch (err) { buttons.forEach((x) => { x.disabled = false; }); return alert(err.message); }
    card.remove();
    if (mode === 'no') return card.classList.contains('blocked') ? null : toast(T('perm.noted'));
    if (room !== project || runId || remoteRunId) return toast(T('perm.allowedElsewhere'));
    els.input.value = T('perm.resume');
    sendMessage();
  });

  // 도구 설치 카드: 설치 → 끝나면 하던 일을 이어서 해 달라고 자동으로 보낸다
  els.messages.addEventListener('click', async (e) => {
    const btn = e.target.closest('.install-go');
    if (!btn) return;
    const T = window.GAMJA_I18N.t;
    const kit = btn.dataset.kit;
    const room = project;
    btn.disabled = true;
    btn.textContent = T('tool.going');
    try {
      await api('/api/tools/install', { kit });
      for (;;) { // 설치가 끝날 때까지 3초마다 확인 (몇 분 걸려요)
        await new Promise((r) => setTimeout(r, 3000));
        const s = await api('/api/tools');
        if (s.installing) continue;
        if ((s.kits.find((k) => k.id === kit) || {}).installed) break;
        throw new Error(s.error || T('tool.fail'));
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = T('tool.go');
      return alert(err.message);
    }
    const card = btn.closest('.install-card');
    if (card) card.innerHTML = `<b>${escapeHtml(T('tool.done'))}</b>`;
    if (room !== project) return toast(T('tool.doneElsewhere'));
    els.input.value = T('tool.resume');
    sendMessage();
  });

  // 코드 복사
  els.messages.addEventListener('click', async (e) => {
    const btn = e.target.closest('.copy');
    if (!btn) return;
    const code = btn.closest('.codeblock').querySelector('code').innerText;
    try { await navigator.clipboard.writeText(code); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = code; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    btn.textContent = '복사됨';
    setTimeout(() => { btn.textContent = '복사'; }, 1200);
  });

  // ---------- 상태 표시 ----------
  function setStatus(text) {
    if (voice.on && voice.phase === 'work' && text) $('voiceState').textContent = text; // 음성 대화 화면에도 진행 상태
    if (!text) return els.status.classList.add('hidden');
    els.statusText.textContent = text;
    els.status.classList.remove('hidden');
  }
  function setRunning(on) {
    if (on) {
      els.send.classList.add('stop');
      els.send.classList.remove('voice-btn');
      els.send.dataset.mode = 'stop';
      els.send.textContent = '■';
      els.send.title = '중지';
      els.send.disabled = false;
    } else {
      els.send.classList.remove('stop');
      setStatus('');
      updateSendState();
    }
  }

  // ---------- 전송 & SSE 수신 ----------
  // 반환: { text, finished, error } (음성 대화 모드가 답을 읽어 주는 데 씀), 보내지 않았으면 null
  // 그룹 채팅이면 크루들의 화면용 이름과, @이름으로 부른 크루만 골라서 함께 보낸다 (서버는 화면용 이름을 모른다)
  function groupInfo(text) {
    const members = roomMembers(project);
    if (members.length < 2) return {};
    const names = {};
    for (const c of members) names[c] = crewParts(c).text;
    return { names, only: members.filter((c) => text.includes(`@${names[c]}`)) };
  }
  async function sendMessage(opts = {}) {
    const text = els.input.value.trim();
    if ((!text && !pending.length) || runId) return null;
    if (remoteRunId) { alert('이전 응답이 아직 진행 중이에요. 끝난 뒤에 보내 주세요.'); return null; }
    stopListening();
    stopSpeaking();
    clearTimeout(pollTimer);

    // 첨부 이미지를 먼저 올린다 (실패하면 보내지 않고 그대로 둔다)
    let images = [];
    const sending = pending.slice();
    if (sending.length) {
      runId = 'pending';
      setRunning(true);
      setStatus(`🖼️ 이미지 올리는 중... (${sending.length}장)`);
      try {
        for (const a of sending) {
          const r = await fetch('/api/upload' + q(), { method: 'POST', headers: { 'Content-Type': a.blob.type }, body: a.blob });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.error || r.statusText);
          images.push(d.name);
        }
      } catch (err) {
        runId = null;
        setRunning(false);
        // 원인을 찾을 수 있게 오류 내용을 그대로 보여 준다 (첨부는 그대로 남겨 둠)
        alert(`이미지를 올리지 못했어요.\n오류: ${err.message}\n\n이 문구를 Claude에게 알려 주세요.`);
        return null;
      }
    }
    els.input.value = '';
    autoGrow();

    const userMsg = { role: 'user', text, ts: Date.now() };
    if (sending.length) userMsg.localImages = sending.map((a) => a.url);
    clearAttachments(false);
    addMessage(userMsg);
    scrollBottom(true);
    // 입력창이 줄어들고 "생각 중" 줄이 나타나 높이가 다 자리 잡은 뒤에, 맨 아래로 한 번 더 보낸다 (내 말풍선이 가려지지 않게)
    setTimeout(() => scrollBottom(true), 250);

    const bot = { role: 'bot', text: '', ts: Date.now(), tools: [] };
    const view = addMessage(bot);
    paint(view, bot, true);
    scrollBottom(true);

    runId = 'pending';
    setRunning(true);
    setStatus('🤔 생각 중...');

    let raf = 0;
    const repaint = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; paint(view, bot, true); if (follow) scrollBottom(); updateToBottom(); });
    };
    let lastWasTool = false;
    let finished = false;
    let errorMsg = null;
    let rejected = false; // 서버가 받지 않은 메시지 (입력창에 되돌려 놓음)

    abortCtl = new AbortController();
    // 화면이 꺼지거나 네트워크가 바뀌면 스트림이 오류 없이 끊길 수 있다.
    // 서버는 15초마다 ping을 보내므로 45초 동안 아무것도 안 오면 끊고, 서버 기록을 따라가는 방식(폴링)으로 전환한다.
    let lastByte = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastByte > 45000 && abortCtl) abortCtl.abort();
    }, 5000);
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, project, images, voice: !!opts.voice, lang: window.GAMJA_I18N.lang, ...groupInfo(text) }),
        signal: abortCtl.signal,
      });
      if (r.status === 401) { rejected = true; showLogin(); throw new Error('로그인이 필요합니다'); }
      if (!r.ok) { rejected = true; throw new Error((await r.json().catch(() => ({}))).error || r.statusText); }

      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        lastByte = Date.now();
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let event = 'message', data = '';
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (!data) continue;
          let d;
          try { d = JSON.parse(data); } catch { continue; }
          switch (event) {
            case 'start': runId = d.runId; break;
            case 'session':
              if (d.sessionId) { sessionId = d.sessionId; updateSessionInfo(); }
              break;
            case 'delta':
              if (lastWasTool && bot.text && !bot.text.endsWith('\n\n')) bot.text += '\n\n';
              lastWasTool = false;
              bot.text += d.text;
              setStatus('✍️ 답변 작성 중...');
              repaint();
              break;
            case 'status':
              if (/새 코드 검사|재시작/.test(d.text)) restartHint = Date.now();
              setStatus(d.text);
              break;
            case 'tool':
              lastWasTool = true;
              bot.tools.push(d.text);
              setStatus(d.text);
              repaint();
              break;
            case 'result': {
              finished = true;
              if (d.sessionId) { sessionId = d.sessionId; updateSessionInfo(); }
              bot.meta = d.meta || ''; // 서버가 만든 "시간 · 토큰" 표시
              if (d.install) bot.install = d.install;
              if (d.denied) bot.denied = d.denied;
              if (d.denials && d.denials.length) {
                bot.text += `\n\n> ⚠️ 권한이 거부된 도구: ${[...new Set(d.denials)].map((x) => '`' + x + '`').join(', ')}`;
              }
              if (d.isError) errorMsg = d.errorText || `오류 (${d.subtype})`;
              break;
            }
            case 'error': errorMsg = d.message; break;
          }
        }
      }
    } catch (err) {
      if (rejected) errorMsg = err.message;
    } finally {
      clearInterval(watchdog);
      if (raf) cancelAnimationFrame(raf);
      runId = null;
      abortCtl = null;
      setRunning(false);
    }

    if (rejected) {
      // 서버에 저장되지 않은 메시지 → 화면에서 빼고 입력창에 되돌린다
      if (!els.input.value) { els.input.value = text; autoGrow(); }
      if (errorMsg !== '로그인이 필요합니다') alert(errorMsg);
    }
    // 답변과 오류는 서버가 기록했다 → 서버 기록으로 다시 그린다 (연결이 끊겼으면 진행 중 응답을 따라감)
    await loadConversation();
    // 검사 실패 시 서버가 곧바로 자동 후속 실행을 시작하므로 한 번 더 확인
    setTimeout(() => { if (!runId && !remoteRunId && !awaitingRestart) loadConversation(); }, 1500);
    if (!opts.voice && ttsOn && finished && bot.text && !errorMsg) speak(bot.text); // 음성 대화 모드는 직접 읽어 줌
    return { text: bot.text, finished, error: errorMsg };
  }

  async function stopRun() {
    if (!runId && remoteRunId) {
      // 다른 기기(또는 끊긴 연결)에서 진행 중인 응답 중지
      await api('/api/stop', { runId: remoteRunId }).catch(() => {});
      return;
    }
    const id = runId;
    if (id && id !== 'pending') await api('/api/stop', { runId: id }).catch(() => {});
    // 서버가 종료 이벤트를 보내지 않으면 클라이언트 쪽에서도 끊는다
    setTimeout(() => { if (abortCtl && runId === id) abortCtl.abort(); }, 4000);
  }

  // 오른쪽 버튼: 응답 중 ■ 중지 / 입력이 비어 있으면 🗣 음성 대화 모드 / 아니면 ➤ 보내기
  els.send.onclick = () => {
    if (runId || remoteRunId) return stopRun();
    if (els.send.dataset.mode === 'voice') return startVoice();
    sendMessage();
  };

  // ---------- 이미지 첨부 ----------
  const MAX_IMAGES = 12;
  const MAX_SIDE = 1800; // 스크린샷 글씨가 읽히는 정도로 줄인다
  const attachBox = $('attachments');
  const fileInput = $('fileInput');

  // 파일 앞부분으로 실제 이미지 형식 판별 (브라우저가 형식을 비워 주는 경우가 있음)
  function sniffType(b) {
    const s = (i, n) => String.fromCharCode(...b.slice(i, i + n));
    if (b[0] === 0x89 && s(1, 3) === 'PNG') return 'image/png';
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (s(0, 3) === 'GIF') return 'image/gif';
    if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'image/webp';
    if (s(4, 4) === 'ftyp' && /hei|mif|avif/.test(s(8, 4))) return 'heic';
    return null;
  }
  function decode(blob) {
    return new Promise((ok, fail) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => ok({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('이 이미지를 열 수 없어요.')); };
      img.src = url;
    });
  }
  // 고르는 즉시 내용을 끝까지 읽어 메모리에 복사한다 (안드로이드는 나중에 읽으려 하면 실패할 수 있음)
  // → 형식 확인 → 큰 이미지는 줄여서 JPEG로
  async function prepareImage(file) {
    let bytes;
    try { bytes = new Uint8Array(await file.arrayBuffer()); }
    catch { throw new Error('사진을 읽을 수 없어요. 휴대폰에 저장된 사진인지(클라우드에만 있는 사진이 아닌지) 확인해 주세요.'); }
    if (!bytes.length) throw new Error('빈 파일이에요. 휴대폰에 저장된 사진인지 확인해 주세요.');
    const type = sniffType(bytes);
    if (type === 'heic') throw new Error('HEIC 형식은 지원하지 않아요. 스크린샷이나 JPG 사진으로 보내 주세요.');
    if (!type) throw new Error('지원하지 않는 형식이에요. PNG·JPG·WEBP·GIF만 보낼 수 있어요.');
    const blob = new Blob([bytes], { type });
    const { img, url } = await decode(blob);
    if (type === 'image/gif' || (blob.size < 800e3 && Math.max(img.naturalWidth, img.naturalHeight) <= MAX_SIDE)) {
      return { blob, url };
    }
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const small = await new Promise((ok) => canvas.toBlob((b) => ok(b), 'image/jpeg', 0.88));
    const out = small && small.size ? small : blob;
    return { blob: out, url: URL.createObjectURL(out) };
  }
  // 한도를 넘으면 창을 띄우지 않고 짧은 알림(토스트)으로만 알린다. 감자 앱의 안내와 같은 문장이다
  const overLimitText = () => `사진은 ${MAX_IMAGES}장까지 첨부할 수 있어요`;
  async function addAttachments(files) {
    files = files.filter(Boolean);
    const room = MAX_IMAGES - pending.length;
    if (files.length > Math.max(room, 0)) toast(overLimitText());
    for (const f of files.slice(0, Math.max(room, 0))) {
      try {
        pending.push(await prepareImage(f));
      } catch (err) {
        alert(`${f.name ? `'${f.name}': ` : ''}${err.message}`);
      }
    }
    renderAttachments();
  }
  function renderAttachments() {
    attachBox.innerHTML = '';
    attachBox.classList.toggle('hidden', !pending.length);
    updateSendState();
    pending.forEach((a, i) => {
      const item = document.createElement('div');
      item.className = 'attach';
      item.innerHTML = `<img alt="첨부 미리보기"><button type="button" title="빼기">✕</button>`;
      item.querySelector('img').src = a.url;
      item.querySelector('button').onclick = () => {
        URL.revokeObjectURL(a.url);
        pending.splice(i, 1);
        renderAttachments();
      };
      attachBox.appendChild(item);
    });
  }
  function clearAttachments(revoke = true) {
    if (revoke) pending.forEach((a) => URL.revokeObjectURL(a.url));
    pending = [];
    renderAttachments();
  }
  // 감자 앱에서는 앱이 사진을 직접 골라 줄여서 넘겨 준다 (__gamjaPicked). 일반 브라우저는 기존 파일 선택
  $('attachBtn').onclick = () => {
    const app = window.GamjaApp;
    if (app && typeof app.pickImages !== 'undefined') {
      const room = MAX_IMAGES - pending.length;
      if (room <= 0) return toast(overLimitText());
      app.pickImages(room);
    } else fileInput.click();
  };
  window.__gamjaPicked = (name, mime, b64) => {
    if (!b64) return toast('사진을 읽지 못했어요');
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      addAttachments([new File([bytes], name || 'photo.jpg', { type: mime || 'image/jpeg' })])
        .catch((err) => toast(`사진을 붙이지 못했어요: ${err.message}`));
    } catch (err) { toast(`사진을 붙이지 못했어요: ${err.message}`); }
  };
  fileInput.onchange = () => {
    const files = [...fileInput.files];
    if (!files.length) toast('선택한 사진을 받지 못했어요');
    addAttachments(files).catch((err) => toast(`사진을 붙이지 못했어요: ${err.message}`));
    fileInput.value = '';
  };
  // PC: 캡처한 화면을 입력창에 바로 붙여 넣기
  els.input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.items || [])].filter((it) => it.kind === 'file').map((it) => it.getAsFile()).filter(Boolean);
    if (files.length) { e.preventDefault(); addAttachments(files); }
  });

  // 입력창: 데스크톱은 Enter 전송/Shift+Enter 줄바꿈, 모바일은 Enter 줄바꿈
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !coarse && !e.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });
  // 입력창 높이를 글 줄 수에 맞춘다: 8줄까지 늘어나고 9줄부터는 스크롤.
  // 줄 높이가 소수(22.4px)라 높이 계산이 1px 모자라면 스크롤바가 생기므로 넉넉히 올림하고,
  // 2줄부터는 버튼들을 아래 줄로 내린다(multiline). 다시 비울 때까지는 여러 줄 모양을 유지해 깜빡임을 막는다.
  const MAX_LINES = 8;
  const composerBox = $('composerBox');
  function autoGrow() {
    const el = els.input;
    // 높이를 재려고 입력창을 잠깐 한 줄로 줄이면 대화 영역이 그 순간 커지면서 브라우저가 맨 아래 스크롤을 스스로 줄여 버린다.
    // 입력창이 두 줄 이상일 때 타이핑할 때마다 화면이 조금씩 위로 올라가던 원인이라, 맨 아래까지 남은 거리를 기억해 두었다가 되돌려 놓는다
    const m = els.messages;
    const dist = m.scrollHeight - m.scrollTop - m.clientHeight;
    if (!el.value) composerBox.classList.remove('multiline');
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight);
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const max = Math.ceil(line * MAX_LINES + pad);
    el.style.height = 'auto';
    let h = el.scrollHeight;
    if (h > line * 1.5 + pad && !composerBox.classList.contains('multiline')) {
      composerBox.classList.add('multiline'); // 넓어진 폭으로 다시 잰다
      h = el.scrollHeight;
    }
    el.style.height = Math.min(Math.ceil(h) + 1, max) + 'px';
    el.style.overflowY = h > max ? 'auto' : 'hidden';
    if (m.clientHeight) { m.scrollTop = m.scrollHeight - m.clientHeight - dist; noteBox(); }
    updateSendState();
    saveDraft(); // 쓰는 글은 그 채팅방의 임시저장으로 남긴다
  }

  // ---------- 채팅방마다 따로 쓰던 글(임시저장)과 붙여 둔 사진 ----------
  // 한 방에서 쓰던 글이 다른 방으로 따라가지 않게, 방마다 따로 저장하고 방을 옮길 때 바꿔 끼운다.
  // 채팅 목록은 쓰던 글이 있는 방에 연필 아이콘을 보여 준다
  const getDrafts = () => store.get('cc:drafts', {});
  const getDraft = (name) => getDrafts()[name] || '';
  function saveDraft(name = project) {
    const drafts = getDrafts();
    const text = els.input.value;
    if (text.trim()) drafts[name] = text; else delete drafts[name];
    store.set('cc:drafts', drafts);
  }
  const draftImages = {}; // 방마다 붙여 둔 사진 (이 화면을 닫기 전까지만)
  // 쓰던 글이 있거나 사진을 붙여 둔 방들 (채팅 목록의 연필 표시). 지금 방의 사진은 pending, 다른 방의 사진은 draftImages에 있다
  function draftRooms() {
    const set = new Set(Object.keys(getDrafts()));
    for (const [room, list] of Object.entries(draftImages)) if (room !== project && list && list.length) set.add(room);
    if (pending.length) set.add(project);
    return [...set];
  }
  function swapRoomInput(from, to) {
    if (from === to) return;
    saveDraft(from); // 방을 옮기기 직전의 글을 떠나는 방에 저장 (아직 입력칸에는 그 글이 있다)
    draftImages[from] = pending;
    pending = draftImages[to] || [];
    els.input.value = getDraft(to);
    autoGrow(); // 들어가는 방의 글을 보여 준다 (project는 이미 to로 바뀐 뒤여야 한다)
    renderAttachments();
  }
  els.input.addEventListener('input', autoGrow);
  // 스크롤바는 스크롤하는 동안만 얇게 보인다
  let scrollHide = 0;
  els.input.addEventListener('scroll', () => {
    els.input.classList.add('scrolling');
    clearTimeout(scrollHide);
    scrollHide = setTimeout(() => els.input.classList.remove('scrolling'), 800);
  });
  // 오른쪽 버튼 모양: 응답 중 ■(setRunning이 처리) / 입력이 비면 🗣 음성 대화(지원 브라우저만) / 아니면 ➤
  function updateSendState() {
    if (runId || remoteRunId) { els.send.disabled = false; return; }
    const hasContent = !!(els.input.value.trim() || pending.length);
    const voiceOk = !hasContent && !!(window.SpeechRecognition || window.webkitSpeechRecognition) && !!window.speechSynthesis;
    els.send.dataset.mode = voiceOk ? 'voice' : 'send';
    els.send.classList.toggle('voice-btn', voiceOk);
    els.send.textContent = voiceOk ? '🗣' : '➤';
    els.send.title = voiceOk ? '음성 대화' : '전송';
    els.send.disabled = !hasContent && !voiceOk;
  }

  // ---------- 음성 입력 (Web Speech API, ko-KR) ----------
  // 안드로이드 크롬은 연속 모드(continuous)에서 앞 문장을 포함한 결과를 반복해서 돌려줘 같은 말이 겹쳐 붙는다.
  // → 한 문장씩 듣고(continuous=false) 확정된 문장만 입력창에 붙인 뒤 자동으로 다시 듣는다. 🎤를 다시 누르면 멈춤.
  //   확정 전 중간 결과는 입력창이 아니라 그 위의 회색 줄에만 보여 준다.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const interimBox = $('interim');
  let rec = null, wantListen = false, lastFinal = '', silentRuns = 0;
  if (!SR) {
    els.mic.title = '이 브라우저는 음성 인식을 지원하지 않아요';
    els.mic.style.opacity = '.35';
  }
  // 마이크 권한이 없을 때: 앱에서는 알림만 띄우지 않고 폰의 GAMJA 앱 정보 화면(권한)으로 바로 데려간다
  const isMicDenied = (code) => code === 'not-allowed' || code === 'service-not-allowed' || code === 'service-permission';
  let voiceDeniedKind = ''; // 음성 대화 중 마이크가 막힌 이유 (위 코드 중 하나)
  let voiceDeniedDetail = '';
  // 앱이 보내는 오류는 "종류|진단 글" 모양이다 (진단 글: 오류 번호, 감자의 마이크 권한, 폰의 음성 인식 서비스)
  const errCode = (e) => String((e && e.error) || '').split('|')[0];
  const errDetail = (e) => String((e && e.error) || '').split('|').slice(1).join('|');
  // 말 없음·중단은 평소에도 나는 일이라 조용히 넘기고, 그 밖의 오류는 번호를 보여 줘서 원인을 찾기 쉽게 한다
  const reportMicError = (code, detail) => { if (code && !['no-speech', 'aborted', 'network'].includes(code) && !isMicDenied(code)) toast(`음성 인식 오류 (${detail || code})`); };
  async function micDenied(kind, detail) {
    const app = window.GamjaApp;
    const diag = detail ? `\n\n[진단] ${detail}` : '';
    if (kind === 'service-permission') {
      // 감자는 허용돼 있는데, 말을 글자로 바꿔 주는 폰의 음성 인식 서비스(Google 앱)에 마이크 권한이 없는 경우
      if (app && typeof app.recognizerSettings !== 'undefined') {
        if (await gSheet({ title: '마이크 권한이 필요해요', message: '폰의 음성 인식 서비스(Google 앱)에 마이크 권한이 필요해요.\n그 앱의 설정 화면을 열까요?\n(권한 → 마이크 → 허용)' + diag, ok: '설정 열기' })) app.recognizerSettings();
      } else alert('폰의 음성 인식 서비스(Google 앱)에 마이크 권한이 없어요. 폰 설정 → 앱 → Google → 권한에서 마이크를 허용해 주세요.' + diag);
      return;
    }
    if (app && typeof app.appSettings !== 'undefined') {
      if (await gSheet({ title: '마이크를 허용해 주세요', message: '음성을 쓰려면 마이크를 허용해야 해요.\n폰의 GAMJA 앱 설정 화면을 열까요?\n(권한 → 마이크 → 허용)' + diag, ok: '설정 열기' })) app.appSettings();
    } else if (app) alert('마이크 권한이 없어요. 폰 설정 → 앱 → GAMJA → 권한에서 마이크를 허용해 주세요.' + diag);
    else alert('마이크 권한이 없어요. (HTTPS 또는 localhost 접속이 필요할 수 있어요)');
  }
  function setInterim(t) {
    interimBox.textContent = t ? `🎤 ${t}` : '';
    interimBox.classList.toggle('hidden', !t);
  }
  function stopListening() {
    wantListen = false;
    setInterim('');
    els.mic.classList.remove('listening');
    if (rec) { try { rec.stop(); } catch {} }
  }
  function appendFinal(t) {
    t = t.trim();
    if (!t || t === lastFinal) return; // 같은 문장이 또 오면 건너뜀
    lastFinal = t;
    const cur = els.input.value;
    els.input.value = cur && !/\s$/.test(cur) ? `${cur} ${t}` : cur + t;
    autoGrow();
  }
  function listenOnce() {
    rec = new SR();
    rec.lang = LOCALE;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText = r[0].transcript; // 이어 붙이지 않고 마지막 확정 결과만
        else interim += r[0].transcript;
      }
      setInterim(finalText ? '' : interim);
    };
    rec.onerror = (e) => {
      if (isMicDenied(errCode(e))) {
        stopListening();
        micDenied(errCode(e), errDetail(e));
      } else reportMicError(errCode(e), errDetail(e));
      // no-speech·aborted 등은 onend에서 처리
    };
    rec.onend = () => {
      setInterim('');
      if (finalText) { appendFinal(finalText); silentRuns = 0; } else silentRuns++;
      // 한동안 말이 없으면 멈춘다 (계속 다시 켜면 휴대폰이 매번 알림음을 냄)
      if (wantListen && silentRuns < 2) setTimeout(() => { if (wantListen) listenOnce(); }, 250);
      else stopListening();
    };
    try { rec.start(); } catch { stopListening(); }
  }
  els.mic.onclick = () => {
    if (!SR) return alert('이 브라우저는 음성 인식을 지원하지 않아요. (Chrome/Safari 권장, HTTPS 또는 localhost 필요)');
    if (wantListen) return stopListening();
    stopSpeaking();
    wantListen = true;
    lastFinal = '';
    silentRuns = 0;
    els.mic.classList.add('listening');
    listenOnce();
  };

  // ---------- 답변 읽어주기 (speechSynthesis) ----------
  const synth = window.speechSynthesis;
  // 읽어주기 켜기·끄기: ⋯ 메뉴의 답변 읽어주기 항목과 ⚙️ 설정 → 소리·화면의 스위치가 같은 설정이다
  function renderTts() {
    $('setTts').checked = ttsOn;
    const b = $('ttsBtn');
    b.textContent = ttsOn ? '🔊 답변 읽어주기: 켜짐' : '🔇 답변 읽어주기: 꺼짐';
    b.setAttribute('aria-pressed', String(ttsOn));
    b.style.opacity = synth ? '' : '.35';
  }
  function setTtsOn(on) {
    if (on && !synth) { renderTts(); return alert('이 브라우저는 음성 합성을 지원하지 않아요.'); }
    ttsOn = on;
    store.set('cc:tts', ttsOn);
    renderTts();
    if (ttsOn) synth.speak(new SpeechSynthesisUtterance('')); // iOS: 사용자 동작으로 잠금 해제
    else stopSpeaking();
    toast(ttsOn ? '🔊 답변을 읽어 드릴게요' : '🔇 읽어주기를 껐어요');
  }
  renderTts();
  $('setTts').onchange = (e) => setTtsOn(e.target.checked);
  $('ttsBtn').onclick = () => { els.menu.classList.add('hidden'); setTtsOn(!ttsOn); };
  function stopSpeaking() { if (synth) synth.cancel(); }
  function toSpeech(md) {
    return md
      .replace(/```[\s\S]*?(```|$)/g, ' 코드 블록 생략. ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, ' 링크 ')
      .replace(/^\s*[#>|-]+\s*/gm, '')
      .replace(/[*_~|]/g, '')
      .replace(/\n{2,}/g, '. ')
      .trim();
  }
  function pickVoice() {
    const voices = synth.getVoices();
    const base = LOCALE.slice(0, 2);
    return voices.find((v) => v.lang === LOCALE && /google|yuna|sora|heami|samantha|aria/i.test(v.name)) ||
      voices.find((v) => v.lang && v.lang.replace('_', '-').startsWith(base));
  }
  // 긴 텍스트는 일부 브라우저에서 끊기므로 문장 단위로 나눈 발화 목록을 만든다
  function utterances(md) {
    const text = toSpeech(md);
    const chunks = text.match(/[^.!?。\n]+[.!?。]?/g) || [text];
    const v = pickVoice();
    const out = [];
    let cur = '';
    const flush = () => {
      if (!cur.trim()) return;
      const u = new SpeechSynthesisUtterance(cur.trim());
      u.lang = LOCALE;
      if (v) u.voice = v;
      u.rate = 1.05;
      out.push(u);
      cur = '';
    };
    for (const c of chunks) {
      if ((cur + c).length > 180) flush();
      cur += c;
    }
    flush();
    return out;
  }
  function speak(md, force) {
    if (!synth || (!ttsOn && !force)) return;
    stopSpeaking();
    for (const u of utterances(md)) synth.speak(u);
  }
  // 다 읽으면(또는 중간에 끊으면) 끝나는 읽기 — 음성 대화 모드에서 "다 읽은 뒤 다시 듣기"에 쓴다
  function speakAndWait(md) {
    return new Promise((resolve) => {
      if (!synth) return resolve();
      stopSpeaking();
      const list = utterances(md);
      if (!list.length) return resolve();
      let done = false;
      const finish = () => { if (!done) { done = true; clearInterval(guard); resolve(); } };
      list[list.length - 1].onend = list[list.length - 1].onerror = finish;
      for (const u of list) synth.speak(u);
      // 일부 브라우저는 중간에 끊었을 때 끝 신호를 안 보내므로, 읽기가 멈췄는지도 주기적으로 확인
      const guard = setInterval(() => { if (!synth.speaking && !synth.pending) finish(); }, 700);
    });
  }
  if (synth && synth.onvoiceschanged !== undefined) synth.onvoiceschanged = () => {};

  // ---------- 🗣 음성 대화 모드 ----------
  // 듣기 → (1.5초 확인 후) 자동 전송 → 작업 → 답을 읽어 줌 → 다시 듣기 … 를 반복한다.
  // 서버에는 "짧게 말하듯 답해 달라"는 표시(voice)를 함께 보낸다. 화면이 켜져 있어야 동작한다(브라우저 제약).
  const voiceEl = $('voice');
  const VOICE_DENIED = Symbol('denied');
  let voiceRec = null;
  let voiceTap = null; // 원을 눌렀을 때 할 일 (단계마다 다름)
  let voiceNote = ''; // 음성 대화에서 직전에 말이 안 들렸을 때 화면에 남겨 두는 설명
  let wakeLock = null;
  const VOICE_LABEL = {
    listen: '👂 듣고 있어요', more: '👂 계속 듣고 있어요 — 다 말했으면 원을 누르세요',
    confirm: '⏳ 곧 보낼게요 — 원을 누르면 취소', work: '🤔 작업 중...',
    speak: '🔊 말하는 중 — 원을 누르면 끊고 말할 수 있어요', paused: '⏸ 쉬는 중 — 원을 누르면 다시 들어요',
  };
  function setVoice(phase, text) {
    voice.phase = phase;
    voiceEl.dataset.phase = phase;
    $('voiceState').textContent = VOICE_LABEL[phase] || '';
    if (text !== undefined) $('voiceText').textContent = text;
  }
  async function keepAwake(on) {
    try {
      if (on && navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
      else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch {}
  }
  // 한 문장 듣기 → 확정된 말 (없으면 null)
  // startTimeout: 그 시간 안에 말을 시작하지 않으면 그만 듣는다 (이어 말하기 기다릴 때)
  // prefix: 앞서 들은 말 (화면에 이어 붙여 보여 줌)
  function recognizeOnce({ startTimeout = 0, prefix = '' } = {}) {
    const SRc = window.SpeechRecognition || window.webkitSpeechRecognition;
    return new Promise((resolve) => {
      const r = new SRc();
      r.lang = LOCALE;
      r.interimResults = true;
      r.continuous = false;
      let finalText = '';
      let denied = false;
      let heard = false;
      const giveUp = startTimeout ? setTimeout(() => { if (!heard) { try { r.abort(); } catch {} } }, startTimeout) : 0;
      let lastErr = ''; // 말이 안 들렸을 때 화면에 이유를 보여 주기 위한 기록
      r.onstart = () => { if (!prefix) $('voiceText').textContent = '(마이크가 켜졌어요. 말씀해 보세요)'; };
      r.onspeechstart = () => { heard = true; if (!prefix) $('voiceText').textContent = '(소리가 들려요…)'; };
      r.onresult = (e) => {
        heard = true;
        voiceNote = '';
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) finalText = e.results[i][0].transcript;
          else interim += e.results[i][0].transcript;
        }
        $('voiceText').textContent = [prefix, finalText || interim].filter(Boolean).join(' ');
      };
      r.onerror = (e) => {
        lastErr = `${errCode(e)}${errDetail(e) ? ` · ${errDetail(e)}` : ''}`;
        if (isMicDenied(errCode(e))) { denied = true; voiceDeniedKind = errCode(e); voiceDeniedDetail = errDetail(e); } else reportMicError(errCode(e), errDetail(e));
      };
      r.onend = () => {
        clearTimeout(giveUp);
        voiceRec = null;
        if (!finalText.trim() && !prefix) voiceNote = `(들은 말이 없어요${heard ? '' : ' · 소리가 안 잡혔어요'}${lastErr ? ` · ${lastErr}` : ''})`;
        resolve(denied ? VOICE_DENIED : finalText.trim() || null);
      };
      voiceRec = r;
      try { r.start(); } catch { clearTimeout(giveUp); resolve(null); }
    });
  }
  // ms 동안 기다림. 그 사이 원을 누르면 false
  function confirmWait(ms) {
    return new Promise((resolve) => {
      const t = setTimeout(() => { voiceTap = null; resolve(true); }, ms);
      voiceTap = () => { clearTimeout(t); voiceTap = null; resolve(false); };
    });
  }
  function waitForTap() {
    return new Promise((resolve) => { voiceTap = () => { voiceTap = null; resolve(); }; });
  }
  async function voiceLoop() {
    let silent = 0;
    while (voice.on) {
      setVoice('listen', voiceNote); // 직전에 말이 안 들렸으면 이유를 같이 보여 준다
      voiceTap = null;
      const said = await recognizeOnce();
      if (!voice.on) break;
      if (said === VOICE_DENIED) {
        stopVoice();
        micDenied(voiceDeniedKind, voiceDeniedDetail);
        break;
      }
      if (!said) {
        // 두 번 연속 말이 없으면 쉬기 (계속 다시 켜면 휴대폰이 매번 알림음을 냄)
        if (++silent >= 2) { setVoice('paused'); await waitForTap(); silent = 0; }
        continue;
      }
      silent = 0;
      // 말하다 잠깐 쉬어도 끊지 않는다: 2.5초 안에 다시 말을 시작하면 이어 붙이고, 조용하면 그때 보낸다.
      // 다 말했으면 원을 눌러 바로 보낼 수 있다.
      let collected = said;
      let sendNow = false;
      while (voice.on && !sendNow) {
        setVoice('more', collected);
        voiceTap = () => { sendNow = true; if (voiceRec) { try { voiceRec.abort(); } catch {} } };
        const more = await recognizeOnce({ startTimeout: 2500, prefix: collected });
        voiceTap = null;
        if (!more || more === VOICE_DENIED) break;
        collected += ` ${more}`;
      }
      if (!voice.on) break;
      if (!sendNow) {
        setVoice('confirm', collected);
        if (!(await confirmWait(1200))) continue; // 취소 → 다시 듣기
        if (!voice.on) break;
      }
      setVoice('work', collected);
      els.input.value = collected;
      autoGrow();
      // 오래 걸리면 가끔 "아직 작업 중"이라고 알려 준다
      const nag = setInterval(() => { if (voice.phase === 'work' && synth && !synth.speaking) speak('아직 작업 중이에요.', true); }, 45000);
      const r = await sendMessage({ voice: true });
      clearInterval(nag);
      if (!voice.on) break;
      const reply = r && r.text ? r.text : r && r.error ? '문제가 생겼어요. 화면에서 내용을 확인해 주세요.' : '';
      const before = history.length; // 이 뒤에 생기는 자동 보고(재시작 결과 등)를 찾기 위해 기억해 둔다
      if (reply) {
        setVoice('speak', toSpeech(reply));
        voiceTap = () => stopSpeaking(); // 누르면 끊고 바로 내 차례
        await speakAndWait(reply);
        voiceTap = null;
        await new Promise((ok) => setTimeout(ok, 300)); // 스피커 소리가 마이크에 들어가지 않게 잠깐 쉼
      }
      // 감자알이 다시 켜지는 중이거나 자동 보고가 진행 중이면, 끝날 때까지 기다렸다가 그 결과도 짧게 읽어 준다
      // (기다리지 않고 바로 듣기를 시작하면 "이전 응답이 진행 중" 경고가 뜨고, 새로고침으로 음성 대화가 꺼지는 문제도 있었다)
      if (voice.on && (remoteRunId || awaitingRestart)) {
        setVoice('work', '감자알이 다시 켜지는 중이에요...');
        const t0 = Date.now();
        while (voice.on && (remoteRunId || awaitingRestart) && Date.now() - t0 < 180000) await new Promise((ok) => setTimeout(ok, 500));
      }
      if (!voice.on) break;
      const report = history.slice(before).filter((m) => m.role === 'bot' && m.text).pop();
      if (report) {
        const md = report.text.length > 220 ? `${report.text.slice(0, 220).replace(/\S*$/, '')} … 자세한 내용은 화면에 있어요.` : report.text;
        setVoice('speak', toSpeech(md));
        voiceTap = () => stopSpeaking();
        await speakAndWait(md);
        voiceTap = null;
        await new Promise((ok) => setTimeout(ok, 300));
      }
    }
  }
  function startVoice() {
    if (voice.on) return;
    stopListening();
    stopSpeaking();
    if (synth) synth.speak(new SpeechSynthesisUtterance('')); // 휴대폰: 사용자 동작으로 읽기 기능 잠금 해제
    voice.on = true;
    voiceEl.classList.remove('hidden');
    keepAwake(true);
    voiceLoop();
  }
  function stopVoice() {
    voice.on = false;
    if (voiceRec) { try { voiceRec.abort(); } catch {} }
    if (voiceTap) voiceTap();
    stopSpeaking();
    keepAwake(false);
    voiceEl.classList.add('hidden');
    // 진행 중이던 작업은 계속되고, 채팅 화면에서 이어서 보인다
  }
  $('voiceOrb').onclick = () => { if (voiceTap) voiceTap(); };
  $('voiceEnd').onclick = stopVoice;

  // ---------- 당겨서 새로고침: 채팅방(#app)을 뺀 모든 화면에서, 맨 위에 있을 때 위에서 아래로 끌어내리면 새로고침 ----------
  // 채팅방은 위로 올려 지난 대화를 읽는 곳이라 일부러 뺐다. 입력칸·가로로 밀리는 줄·결과물 창(iframe)에서 시작한 끌기도 무시한다
  (function pullToRefresh() {
    const PULL = 84; // 이만큼(손가락 이동 기준) 끌어내리면 새로고침
    const MAX = 120;
    const ind = document.createElement('div');
    ind.className = 'ptr';
    ind.setAttribute('aria-hidden', 'true');
    ind.innerHTML = window.GAMJA_ICONS ? window.GAMJA_ICONS.svg('refresh') : '↻';
    document.body.appendChild(ind);
    let startX = 0, startY = 0, tracking = false, pulling = false, scroller = null, dist = 0;
    const scrollParent = (el) => { // 눌린 곳에서 위로 올라가며 세로로 스크롤되는 상자를 찾는다
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const oy = getComputedStyle(n).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
      }
      return null;
    };
    const show = (d, ready) => {
      ind.style.setProperty('--pull', `${d}px`);
      ind.style.opacity = d > 4 ? String(Math.min(1, d / 50)) : '0';
      ind.classList.toggle('ready', !!ready);
      ind.firstElementChild.style.transform = `rotate(${Math.round(d * 3)}deg)`;
    };
    const reset = () => { tracking = false; pulling = false; dist = 0; ind.classList.remove('drag'); show(0, false); };
    document.addEventListener('touchstart', (e) => {
      tracking = false; pulling = false;
      if (e.touches.length !== 1) return;
      const t = e.target;
      if (!t.closest || t.closest('#app, #voice, input, textarea, select, iframe, .fr-shelf, .made-tabs, pre, .codeblock')) return;
      scroller = scrollParent(t);
      if (scroller && scroller.scrollTop > 0) return; // 맨 위에 있을 때만
      startX = e.touches[0].clientX; startY = e.touches[0].clientY;
      tracking = true;
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (!tracking) return;
      const dy = e.touches[0].clientY - startY, dx = e.touches[0].clientX - startX;
      if (!pulling) {
        if (Math.abs(dx) > Math.abs(dy) || dy < -6) { tracking = false; return; } // 옆으로 밀거나 위로 올리는 건 새로고침이 아니다
        if (dy < 10) return;
        if (scroller && scroller.scrollTop > 0) { tracking = false; return; }
        pulling = true;
        ind.classList.add('drag');
      }
      dist = Math.min(MAX, dy * 0.6);
      show(dist, dy >= PULL);
      if (e.cancelable) e.preventDefault(); // 끌어내리는 동안 화면이 같이 끌려 내려가지 않게
    }, { passive: false });
    const end = () => {
      if (!tracking && !pulling) return;
      const go = pulling && dist >= PULL * 0.6;
      if (!go) return reset();
      const T = window.GAMJA_I18N.t;
      if (pending.length || Object.values(draftImages).some((l) => l && l.length)) { toast(T('ptr.keep')); return reset(); } // 붙여 둔 사진은 새로고침하면 사라진다
      ind.classList.remove('drag');
      ind.classList.add('spin');
      show(60, true);
      setTimeout(() => { if (!requestReload()) { ind.classList.remove('spin'); reset(); } }, 250);
    };
    document.addEventListener('touchend', end, { passive: true });
    document.addEventListener('touchcancel', reset, { passive: true });
  })();

  // ---------- 연결 상태: 감자알이 다시 켜지거나 접속이 끊기면 위쪽에 안내줄을 보여 준다 ----------
  // 5초마다 /api/me로 확인한다. 실패가 이어지면 "확인하는 중", 30초가 넘으면 "연결할 수 없어요"+다시 시도,
  // 폰에서 외부 접속을 껐으면 "접속이 끊겼어요". 다시 연결되면 잠깐 알리고, 감자알이 다시 켜졌거나 접속이 꺼져 있었다면 화면을 새로고침한다
  const connBar = $('connBar');
  let connState = 'ok'; // ok | down | off
  let connFails = 0;
  let connDownSince = 0;
  let connBoot = null;
  let connTimer = 0;
  let connBusy = false;
  let restartHint = 0; // 감자알이 "새 코드 검사·재시작 중"이라고 알린 시각 (이때는 연결이 한참 끊겨도 정상이라 안내를 다르게 한다)
  function connShow(kind, text, retry) {
    connBar.className = `conn-bar ${kind}`;
    $('connText').textContent = text;
    $('connRetry').textContent = window.GAMJA_I18N.t('conn.retry');
    $('connRetry').disabled = false;
    $('connRetry').classList.toggle('hidden', !retry);
  }
  async function connPing() {
    if (connBusy) return;
    connBusy = true;
    clearTimeout(connTimer);
    const T = window.GAMJA_I18N.t;
    let next = 5000;
    try {
      if (document.hidden) return; // 화면이 꺼져 있을 때는 확인하지 않는다 (다시 켜지면 바로 확인)
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 4000);
      let r;
      try { r = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin', signal: ctl.signal }); } finally { clearTimeout(to); }
      const d = await r.json().catch(() => ({}));
      if (r.status === 403 && d.code === 'lan-off') {
        connState = 'off';
        connFails = 0;
        connShow('off', T('conn.off'), true);
        next = 4000;
      } else if (r.ok) {
        connFails = 0;
        const restarted = !!(connBoot && d.boot && d.boot !== connBoot);
        if (d.boot) connBoot = d.boot;
        const was = connState;
        connState = 'ok';
        if (was !== 'ok') connShow('ok', T('conn.back'), false);
        if (restarted || was === 'off') { if (requestReload()) return; } // 새 코드나 새 로그인이 필요하다
        if (was === 'down') { setTimeout(() => { if (connState === 'ok') connBar.className = 'conn-bar hidden'; }, 2000); if (!runId) loadConversation(); }
        else if (was === 'off') setTimeout(() => { if (connState === 'ok') connBar.className = 'conn-bar hidden'; }, 2000);
      } else throw new Error('status ' + r.status);
    } catch (err) {
      if (connBar.className.includes('off') && connState === 'off') return;
      connFails++;
      next = 3000;
      if (connFails >= 2) { // 한 번 실패한 건 흔들림일 수 있어서 두 번째부터 알린다
        if (connState !== 'down') { connState = 'down'; connDownSince = Date.now(); }
        // 재시작 중이면 1분 넘게 걸릴 수 있어서 "연결할 수 없어요"는 90초가 지난 뒤에, 그 전에는 "다시 켜는 중"이라고 알린다
        const restarting = awaitingRestart || Date.now() - restartHint < 180000;
        const long = Date.now() - connDownSince > (restarting ? 90000 : 30000);
        connShow('down', long ? T('conn.lost') : T(restarting ? 'conn.restarting' : 'conn.checking'), long);
      }
    } finally {
      connBusy = false;
      connTimer = setTimeout(connPing, next);
    }
  }
  $('connRetry').onclick = async () => {
    const b = $('connRetry');
    b.disabled = true; // 눌렀다는 게 보이게: 확인하는 동안 "확인 중…"
    b.textContent = window.GAMJA_I18N.t('conn.checkingBtn');
    connFails = Math.max(connFails, 1);
    for (let i = 0; connBusy && i < 50; i++) await new Promise((r) => setTimeout(r, 100)); // 이미 확인 중이면 끝나길 잠깐 기다린다
    await connPing();
    b.disabled = false;
    b.textContent = window.GAMJA_I18N.t('conn.retry');
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) connPing(); });
  window.addEventListener('online', connPing);
  connPing();

  // ---------- 시작 ----------
  updateSendState();
  api('/api/me').then((d) => {
    bootId = d.boot || null;
    // 자동 업데이트 직후에 열린 화면이면 짧은 알림으로 알려 준다 (대화에는 남기지 않는다)
    const u = d.lastUpdate;
    if (u && Date.now() - u.ts < 10 * 60e3 && u.ts > store.get('cc:seenUpdate', 0)) {
      store.set('cc:seenUpdate', u.ts);
      setTimeout(() => toast(`🆕 감자알이 ${u.version}으로 업데이트됐어요`), 600);
    }
    return d.authed ? showApp() : showLogin();
  }).catch(showLogin);
})();
