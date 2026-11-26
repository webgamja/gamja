(function () {
  const $ = (id) => document.getElementById(id);
  const els = {
    login: $('login'), loginForm: $('loginForm'), pw: $('pw'), loginErr: $('loginErr'),
    app: $('app'), messages: $('messages'), input: $('input'),
    send: $('sendBtn'), mic: $('micBtn'), newBtn: $('newBtn'),
    menuBtn: $('menuBtn'), menu: $('menu'), logout: $('logoutBtn'),
    status: $('status'), statusText: $('statusText'),
  };

  // ---------- 모바일 화면 높이 ----------
  // 키보드를 닫은 뒤에도 화면이 밀려 있거나 높이가 어긋나 입력창이 바닥에 붙는 문제 방지:
  // 실제로 보이는 높이(visualViewport)에 맞추고, 밀린 스크롤은 되돌린다
  const vv = window.visualViewport;
  function fitViewport() {
    // 결과물을 두 손가락으로 확대하면 보이는 영역(vv.height)이 줄어든다. 확대 배율을 곱해서 실제 화면 높이는 그대로 둔다
    const zoomed = vv && vv.scale > 1.01;
    document.documentElement.style.setProperty('--app-h', `${Math.round(vv ? vv.height * (zoomed ? vv.scale : 1) : window.innerHeight)}px`);
    if (window.scrollY && !zoomed) window.scrollTo(0, 0);
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
  let draftReady = false; // 새로고침 직후 쓰던 글을 입력칸에 되살리기 전에는 임시저장을 빈 글로 덮어쓰지 않는다
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
  // 감자 앱의 "Claude 다시 로그인" 등은 ?page=claude 로 열린다 → 더보기의 그 화면으로 시작 (정해 둔 화면만)
  const linkedPage = ['ai', 'claude', 'claude-account'].includes(new URLSearchParams(location.search).get('page')) ? new URLSearchParams(location.search).get('page') : null;
  if (linked !== null) store.set('cc:project', linked);
  if (linked !== null || location.search.includes('page=')) window.history.replaceState(null, '', location.pathname);
  let project = store.get('cc:project', '');
  let sessionId = null;
  let history = [];
  let runId = null;
  let abortCtl = null;
  // 더보기의 '답이 끝나면 소리로 읽어 줘요' 스위치를 뺐다. 예전에 켜 둔 앱 기본값은 끌 방법이 없어지므로 꺼 둔다 (방별 ⋯ 메뉴 설정은 그대로)
  if (store.get('cc:tts', false)) store.set('cc:tts', false);
  let ttsOn = store.get('cc:tts', false);
  let pollTimer = null;
  let stoppingId = null; // 중지를 누른 응답의 runId (서버가 정리를 끝낼 때까지 화면에서는 끝난 것으로 본다)
  let remoteRunId = null; // 다른 기기(또는 끊긴 연결)에서 진행 중인 응답
  let liveView = null; // 그 응답을 보여주는 말풍선
  let pending = []; // 보낼 첨부 이미지 [{ blob, url }]
  // 고른 사진을 줄이는 중인 작업들. 다 끝나기 전에 전송을 누르면 sendMessage가 기다렸다가 한꺼번에 보낸다
  const attachPrep = { jobs: new Set(), count: 0, waiting: false };
  const voice = { on: false, phase: '' }; // 🗣 음성 대화 모드 상태
  // 새 글이 쓰이는 동안 화면이 따라 내려갈지. 읽던 곳을 보려고 위로 올리면 멈추고, 맨 아래로 돌아오면 다시 따라간다
  let follow = true;
  const LOCALE = window.GAMJA_I18N.locale; // 화면 언어에 맞는 지역 코드 (날짜 모양·음성 인식·읽기 언어에 쓴다)
  // 그룹 채팅: 혼자 방의 채팅방 설정에서 참여자를 초대하면 그룹 방이 된다. 일은 방장만, 나머지는 의견만 (서버 server.js의 GROUP_CHAT_ENABLED도 같이)
  const GROUP_CHAT_ENABLED = true;
  let tab = null; // 지금 보는 곳: 'crew'(크루) | 'chat'(채팅 목록) | 'more'(더보기) | null(채팅방 안)
  let lastBox = { dist: 0, ch: 0 }; // 대화 영역의 마지막으로 확인한 "맨 아래까지 남은 거리"와 보이는 높이 (키보드·입력창 높이가 바뀔 때 비교용)
  // 스크롤을 코드로 움직인 직후에 불러서 "지금 상태"를 기억해 둔다. 안 그러면 같은 순간에 높이가 바뀔 때 옛 기억과 비교해 엉뚱하게 보정한다
  function noteBox() {
    const m = els.messages;
    lastBox = { dist: m.scrollHeight - m.scrollTop - m.clientHeight, ch: m.clientHeight };
  }
  let bootId = null; // 이 화면을 받아 올 때 감자알의 켜진 시각 (/api/me)
  let loadSeq = 0;
  let historyRev = ''; // 지금 화면의 기록(history)에 해당하는 서버 기록 버전. 같은 값이면 서버가 대화 전체를 다시 보내지 않는다
  let historyRevProject = null;
  let loadedProject = null; // 화면에 그려 둔 대화의 프로젝트 (null = 아직 한 번도 안 그림)

  // ---------- 🔍 대화 글자 크기 ----------
  // 대화 영역의 내용만 커지고 위쪽 줄·입력창은 그대로다. 화면 전체 확대는 막고(viewport·touch-action),
  // 대화 위에서 두 손가락으로 벌리거나 오므리는 동작은 여기서 직접 처리한다
  // 크기는 정해진 단계로만 바뀐다: 50, 75, 100, 125, 150, 200 (%)
  const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const snapZoom = (z) => ZOOM_STEPS.reduce((best, s) => (Math.abs(Math.log(s / z)) < Math.abs(Math.log(best / z)) ? s : best), 1);
  // 더보기의 '대화 글자 크기' 앱 기본값 선택을 뺐다. 예전에 바꿔 둔 값은 되돌릴 방법이 없으므로 100%로 둔다 (방별 크기는 그대로)
  if (Number(store.get('cc:zoom', 1)) !== 1) store.set('cc:zoom', 1);
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
  // ---------- 방별 설정 (읽어주기·목소리·글자 크기) ----------
  // 더보기의 설정은 감자 전체의 기본값(이 기기에 저장), 채팅방(⋯ 메뉴)에서 바꾼 값은 그 방에만 적용되고 기본값보다 우선한다 (감자알에 저장돼 모든 기기에서 같다).
  // roomPrefs에 없는 항목은 "기본값 따르기"
  let roomPrefs = {};
  const gTts = () => !!store.get('cc:tts', false);
  const gZoom = () => snapZoom(Number(store.get('cc:zoom', 1)) || 1);
  const gVoice = () => store.get('cc:voice', '');
  const curVoiceId = () => (roomPrefs.voice !== undefined ? roomPrefs.voice : gVoice());
  // 지금 방에서 실제로 쓰는 값으로 화면을 맞춘다
  function applyPrefs() {
    ttsOn = roomPrefs.tts !== undefined ? !!roomPrefs.tts : gTts();
    const z = roomPrefs.zoom !== undefined ? snapZoom(Number(roomPrefs.zoom) || 1) : gZoom();
    if (z !== msgZoom) applyMsgZoom(z);
    renderTts(); renderVoiceBtns(); renderZoomRow();
  }
  // 이 방의 설정 하나를 바꾼다 (val이 undefined면 기본값 따르기). 감자알에 저장해서 다른 기기에서도 같게 보인다
  function setRoomPref(key, val) {
    if (val === undefined) delete roomPrefs[key]; else roomPrefs[key] = val;
    applyPrefs();
    if (isGone(project)) return; // 감자쑥쑥('')도 저장한다 (안 하면 다시 불러올 때 빈 설정으로 되돌아간다)
    api('/api/room-prefs', { room: project, prefs: roomPrefs }).catch(() => {});
  }
  // 불러온 방의 설정이 지금과 다르면 적용 (다른 방으로 옮겼거나 다른 기기에서 바꿨을 때)
  function loadRoomPrefs(p) {
    p = p && typeof p === 'object' ? p : {};
    if (JSON.stringify(p) === JSON.stringify(roomPrefs)) return;
    roomPrefs = p;
    applyPrefs();
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
  const endPinch = (e) => { if (pinch && e.touches.length < 2) { pinch = null; setRoomPref('zoom', msgZoom); } };
  els.messages.addEventListener('touchend', endPinch, { passive: true });
  els.messages.addEventListener('touchcancel', endPinch, { passive: true });
  document.addEventListener('gesturestart', (e) => { if (!document.documentElement.classList.contains('viewing')) e.preventDefault(); }); // iOS Safari: 화면 전체 확대 막기 (결과물을 보는 동안은 확대할 수 있다)

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
  function gSheet({ title = '', message = '', ok = '', cancel = '', danger = false, alertOnly = false, field = null, pre = null } = {}) {
    const T = window.GAMJA_I18N.t;
    return new Promise((resolve) => {
      if (gsOpen) gsOpen.close(false);
      const bg = document.createElement('div');
      bg.className = 'gs-bg';
      bg.innerHTML = '<div class="gs" role="dialog" aria-modal="true">' + (title ? '<h2></h2>' : '') + (message ? '<p></p>' : '') + (pre !== null ? '<pre class="gs-pre"></pre>' : '') +
        (field ? '<textarea class="gs-field" rows="2" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>' : '') +
        `<div class="gs-btns"><button class="gs-ok${danger ? ' danger' : ''}" type="button"></button>${alertOnly ? '' : '<button class="gs-cancel" type="button"></button>'}</div></div>`;
      if (title) bg.querySelector('h2').textContent = title;
      if (message) bg.querySelector('p').textContent = message;
      if (pre !== null) { const el = bg.querySelector('.gs-pre'); el.textContent = pre; setTimeout(() => { el.scrollTop = el.scrollHeight; }); }
      const input = field ? bg.querySelector('.gs-field') : null;
      if (input) {
        input.value = field.value || '';
        input.placeholder = field.placeholder || '';
        input.readOnly = !!field.readonly;
        if (field.secret) { input.style.webkitTextSecurity = 'disc'; input.inputMode = 'text'; } // 암호는 점으로 가린다
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
    if (!r.ok) { const e = new Error(data.code === 'conv-unreadable' ? window.GAMJA_I18N.t('err.convUnreadable') : data.code === 'export-running' && path !== '/api/rooms/export' ? window.GAMJA_I18N.t('export.writeWait') : (data.error || r.statusText)); e.code = data.code; e.data = data; throw e; }
    return data;
  }

  function showLogin() {
    hideTabs();
    firstOpen = true; // 다시 로그인하면 채팅 목록부터
    els.app.classList.add('hidden');
    els.login.classList.remove('hidden');
    $('loginHint').textContent = window.GAMJA_I18N.t('login.hint'); // 비밀번호를 모르면 앱의 "감자콘솔 접속하기"로 열라고 알려 준다
    setTimeout(() => els.pw.focus(), 50);
  }
  // 앱 설치(PWA) 기능은 뺐다. 잠깐 배포됐던 서비스 워커(sw.js)가 남아 있으면 지운다
  if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
  window.addEventListener('beforeinstallprompt', (e) => e.preventDefault()); // 크롬의 "앱 설치" 안내를 띄우지 않는다
  let firstOpen = true;
  let deepLink = linked !== null; // 알림을 눌러 특정 크루로 열렸는지 (한 번만)
  async function showApp() {
    // 새로고침·첫 접속이 탭 화면(채팅 목록·크루·더보기)으로 시작할 때는, 불러오는 동안 뒤에 있는 채팅방이 잠깐 보이지 않게 가려 둔다
    let startTab = null;
    try { startTab = sessionStorage.getItem('cc:tab'); } catch { /* 저장소를 못 쓰면 채팅 목록 */ }
    if (firstOpen && !deepLink && startTab !== 'room') document.body.classList.add('in-tab');
    els.login.classList.add('hidden');
    els.app.classList.remove('hidden');
    refreshAi();
    await loadProjects();
    draftReady = true;
    if (!els.input.value) { els.input.value = getDraft(project); autoGrow(); } // 새로고침해도 쓰던 글이 남아 있다
    loadConversation(); // 채팅방 내용은 미리 불러 둔다
    // 접속하면 항상 채팅 목록으로. 단, 알림을 눌러 특정 크루로 들어왔거나, 새로고침(감자알 업데이트 등)이면 있던 곳을 그대로 유지한다
    if (!firstOpen) return;
    firstOpen = false;
    api('/api/perm/migration-notice').then((n) => { // 예전 "항상 허용" 규칙을 초기화했다면 한 번만 알린다
      if (n && n.show) { alert(t('perm.resetNotice', { n: n.count })); api('/api/perm/migration-notice/ack', {}).catch(() => {}); }
    }).catch(() => {});
    let last = null;
    try { last = sessionStorage.getItem('cc:tab'); } catch { /* 저장소를 못 쓰면 채팅 목록 */ }
    if (linkedPage) goAiPage(linkedPage);
    else if (deepLink || last === 'room') { deepLink = false; showTab(null); }
    else showTab(last === 'crew' || last === 'more' ? last : 'chat');
  }

  // ---------- 🔌 AI 계정 연결 상태 ----------
  // 콘솔은 AI 계정이 없어도 다 둘러볼 수 있다. AI가 필요한 곳(채팅방 입력창·크루 탭)에서만 "더보기 → AI에서 연결하세요" 안내를 보여 준다
  let aiState = null; // { claude: bool, codex: bool } · null = 아직 모름 (모를 때는 막지 않는다)
  let clInst = null, clInstTimer = null, clCardKey = ''; // Claude Code 설치 상태 (더보기 → AI → Claude 맨 위 카드)
  const aiReady = () => !aiState || !!(aiState.claude || aiState.codex);
  async function refreshAi() {
    try { const d = await api('/api/me'); if (d.ai) { aiState = d.ai; renderAi(); } } catch {}
  }
  function aiNoticeHtml() {
    // 채팅방·채팅 목록·크루 탭 모두 같은 문구 (감자쑥쑥 채팅방 기준)
    const T = window.GAMJA_I18N.t;
    return `<div class="ai-notice-card"><b>${escapeHtml(T('ai.need.title'))}</b>` +
      `<small>${escapeHtml(T('ai.need.body'))}</small>` +
      `<button type="button" class="ai-go">${escapeHtml(T('ai.need.go'))}</button></div>`;
  }
  function renderAi() {
    const T = window.GAMJA_I18N.t;
    const ok = aiReady();
    // 채팅방: 입력창 위 안내 + 입력 막기 (방마다 입력창 상태를 정하는 applyGone이 함께 처리한다)
    applyGone();
    // 크루 탭 맨 위
    const c = $('aiNoticeCrew');
    if (c) c.innerHTML = ok ? '' : aiNoticeHtml('crew');
    if (tab === 'chat' && chats.length) { chatKey = ''; renderChats(); } // 채팅 탭 목록 아래 안내도 바로 바꾼다
    // 더보기 → AI: 연결 상태
    const cl = !!(aiState && aiState.claude);
    $('aiClaudeSub').textContent = !aiState ? '' : (cl ? T('ai.st.on') : T('ai.st.off'));
    $('aiClaudeSub').classList.toggle('ai-st-off', !!aiState && !cl);
    $('aiClaudeSub').classList.toggle('ai-st-on', cl);
    $('aiCodexSub').textContent = aiState && aiState.codexLogin ? T('ai.st.on') : '';
    $('aiCodexSub').classList.toggle('ai-st-on', !!(aiState && aiState.codexLogin));
    // 더보기 → AI → Claude: 연결 전에는 맨 위에 로그인 카드, 계정·대화 설정은 흐리게
    const off = !!aiState && !cl;
    if (aiState && !aiState.claudeInstalled && !cl) $('aiClaudeSub').textContent = T(aiState.claudeInstalling || clInst?.installing ? 'ai.claude.st.installing' : 'ai.claude.st.notInstalled');
    $('claudeConnect').classList.toggle('hidden', !off);
    $('claudeRows').classList.toggle('ai-locked', off);
    if (off) renderClaudeConnect();
  }
  // 더보기 → AI → Claude 맨 위 카드: 설치 전이면 설치, 설치 중이면 진행 상황, 설치됐으면 로그인
  function renderClaudeConnect() {
    const T = window.GAMJA_I18N.t, box = $('claudeConnect');
    const st = clInst || { installed: !!(aiState && aiState.claudeInstalled), installing: !!(aiState && aiState.claudeInstalling), installError: '', log: [] };
    const key = st.installed ? 'login' : st.installing ? 'installing:' + (st.log || []).slice(-1)[0] : 'install:' + (st.installError || '');
    if (key === clCardKey && box.firstChild) return;
    clCardKey = key;
    if (st.installed) {
      box.innerHTML = `<b>${escapeHtml(T('ai.claude.connectTitle'))}</b><small>${escapeHtml(T('ai.claude.connectBody'))}</small>` +
        `<button type="button" id="claudeConnectBtn">${escapeHtml(T('ai.claude.connectBtn'))}</button>`;
      $('claudeConnectBtn').onclick = () => startLogin();
    } else if (st.installing) {
      box.innerHTML = `<b>${escapeHtml(T('ai.claude.install.title'))}</b><small>${escapeHtml(T('ai.claude.installing'))}</small>` +
        `<code class="cx-log">${escapeHtml((st.log || []).slice(-1)[0] || '')}</code>`;
    } else {
      box.innerHTML = `<b>${escapeHtml(T('ai.claude.install.title'))}</b><small>${escapeHtml(st.installError || T('ai.claude.install.body'))}</small>` +
        `<button type="button" id="claudeInstallBtn">${escapeHtml(T('ai.claude.install.btn'))}</button>`;
      $('claudeInstallBtn').onclick = () => claudeInstallCall('install');
    }
    clearTimeout(clInstTimer);
    if (st.installing) clInstTimer = setTimeout(() => claudeInstallCall('status'), 2000);
  }
  async function claudeInstallCall(action) {
    const was = clInst && clInst.installing;
    try { clInst = await api('/api/auth/claude/install', { action }); } catch (err) { toast(err.message); return; }
    if (aiState) { aiState.claudeInstalled = clInst.installed; aiState.claudeInstalling = clInst.installing; }
    if ((was || action === 'install') && clInst.installed) { toast(window.GAMJA_I18N.t('ai.claude.installed')); brainInfo = null; }
    renderAi();
  }
  // 안내의 "AI 연결하러 가기": 더보기 → AI (page를 주면 그 화면)
  let settingsReady = Promise.resolve();
  async function goAiPage(page = 'ai') {
    showTab('more');
    await settingsReady;
    showSettingsPage(page);
  }
  document.addEventListener('click', (e) => { if (e.target.closest('.ai-go')) goAiPage('ai'); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && aiState && !aiReady()) refreshAi(); }); // 다른 곳에서 로그인하고 돌아왔을 때

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
  const ROOT_NAME = '🥔 감자쑥쑥'; // 특정 크루를 고르기 전의 기본 대화 (~/projects 전체)
  // 이름 끝의 "크루"는 화면에서 뺀다 (너무 크루크루 하지 않게). 가져온 크루의 옛 이름에도 똑같이 적용한다
  const stripCrew = (s) => String(s || '').replace(/\s*크루$/, '');
  // 🌱 감자 배지: 시험하고 다듬은 크루(templates.js의 tested)에만 붙는다. 이름 앞 떡잎 아이콘 + 한 줄 설명
  const GB_ICON = '<svg class="gb-ico" viewBox="0 0 138 136" aria-hidden="true"><path fill="#6DBE4A" d="M60,70C20,70 4,40 8,6C46,6 66,30 60,70Z"/><path fill="#58AA3A" d="M68,70C62,34 84,6 130,4C136,44 110,70 68,70Z"/><path d="M64,60L64,128" fill="none" stroke="#4E9A35" stroke-width="14" stroke-linecap="round"/></svg>';
  const gbMark = (a) => (a && a.tested ? GB_ICON : '');
  const gbNote = (a) => (a && a.tested ? `<small class="gb-note">${escapeHtml(window.GAMJA_I18N.t('badge.note'))}</small>` : '');
  // 크루별 지침 버전 정보 (감자알이 알려 준다): { 폴더: { hash, tpl: { id, ver, edited } | null, backups } }
  // 배지는 시험한 템플릿 버전으로 만들었거나 업데이트했고, 그 뒤 지침을 직접 고치지 않은 크루에만 붙는다
  let crewInfo = {};
  const hasGb = (n) => { const i = n ? crewInfo[crewOf(n)] : null; return !!(i && i.tpl && !i.tpl.edited); };
  // GitHub 크루 목록(감자알이 하루 한 번 받아 둔다)에서 온 최신 버전. 앱에 든 버전보다 높으면 그쪽을 쓰고, 못 받으면 앱에 든 버전을 쓴다
  let crewsRemote = {};
  let crewsRemoteAsked = false;
  const verNum = (v) => String(v).split('.').map(Number);
  const verNewer = (a, b) => { const x = verNum(a), y = verNum(b); for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; } return false; };
  function tplDef(id) {
    const b = AGENTS.find((a) => a.id === id && a.version);
    const r = crewsRemote[id];
    if (r && (!b || verNewer(r.latest, b.version))) return { id, version: r.latest, currentHash: r.hash, oldHashes: r.old || [], remote: true };
    return b || null;
  }
  async function loadCrewsRemote() { // 조용히 실패한다(인터넷이 없어도 화면은 그대로)
    try {
      const d = await api('/api/crew-index');
      crewsRemote = {};
      for (const c of d.crews || []) crewsRemote[c.id] = c;
      if (!$('homePanel').classList.contains('hidden') && $('crewListBox')) renderCrewList();
    } catch {}
  }
  // 새 버전이 있는지: 버전 기록이 있으면 버전을 비교하고, 기록이 없는 옛 크루는 지침이 알려진 옛 글이면 "고친 적 없음", 아니면 "직접 고침"으로 본다
  function updInfo(n) {
    const f = n ? crewOf(n) : '';
    if (!f) return null;
    const info = crewInfo[f] || {};
    const id = info.tpl ? info.tpl.id : store.get(`cc:tpl:${f}`, '');
    const def = tplDef(id);
    if (!def) return null;
    if (info.tpl) return info.tpl.ver !== def.version ? { def, edited: info.tpl.edited } : null;
    if (!info.hash || info.hash === def.currentHash) return null;
    return { def, edited: !(def.oldHashes || []).includes(info.hash) };
  }
  const gbMarkOf = (n) => (hasGb(n) ? GB_ICON : '');
  // 목록에 보이는 이름: 템플릿·가져온 크루는 "🍽️ 메뉴판·가격표", 직접 만든 폴더는 "📁 폴더이름"
  // 방이 어느 크루의 방인지. 옛 방("크루@번호")은 아이디 앞부분이 크루이고, 새 방("@번호")은 감자알이 알려 준 값을 이 기기에 기억해 둔다. 첫 방은 크루 이름 그대로
  let roomCrews = {};
  try { roomCrews = JSON.parse(localStorage.getItem('cc:roomCrew') || '{}') || {}; } catch { roomCrews = {}; }
  const rememberRoomCrew = (room, crew) => {
    if (roomCrews[room] === crew) return;
    roomCrews[room] = crew;
    try { localStorage.setItem('cc:roomCrew', JSON.stringify(roomCrews)); } catch {}
  };
  const crewOf = (n) => {
    const s = String(n || '');
    const at = s.indexOf('@');
    if (at < 0) return s;
    return at > 0 ? s.slice(0, at) : (roomCrews[s] || '');
  };
  function crewLabel(room) {
    const p = crewOf(room);
    const meta = store.get(`cc:crew:${p}`, null) || window.GAMJA_TEMPLATES.AGENTS.find((a) => a.id === store.get(`cc:tpl:${p}`, ''));
    return meta ? `${meta.icon || '📁'} ${stripCrew(meta.name || p)}` : `📁 ${p}`;
  }
  let projectList = []; // 크루(프로젝트 폴더) 이름들
  let fabApp = null; // 켜 둔 앱 버튼의 상태 (아래 renderFab · refreshFab)
  let fabRoom = '';
  // 왼쪽 위 버튼: 지금 있는 곳을 보여 준다
  function updateHomeBtn() {
    const members = roomMembers(project);
    $('homeBtn').textContent = `← ${crewParts(project).icon} ${roomText(project)}`; // 그룹 방은 방장(방의 원래 주인)의 크루 // ←를 누르면 채팅 목록으로
    if (fabRoom !== project) { fabApp = null; if ($('appFab')) { renderFab(); refreshFab(); } }
    $('madeBtn').classList.remove('hidden'); // 감자 톡톡도 결과물 폴더가 있고, 크루가 지워진 채팅방도 방에 남은 결과물을 볼 수 있다
    applyGone();
  }
  // 채팅방의 참여자(크루) 목록. 채팅 목록에서 받아 온 정보를 쓰고, 아직 모르면 그 방의 크루 한 명으로 본다
  const roomMembers = (n) => ((chats.find((c) => c.name === n) || {}).members || [crewOf(n)]);
  // 그룹 방의 참여자 [{id, crew, brain, nick, leader, locked}] (혼자 방은 null)
  const roomGroup = (n) => { const g = (chats.find((c) => c.name === n) || {}).group; return Array.isArray(g) && g.length > 1 ? g : null; };
  // 삭제된 크루의 방: 입력창과 대화 관련 메뉴를 끈다 (대화를 이어가려면 크루를 복구해야 한다)
  // 그룹 방: 입력창에 @이름 안내를 보이고, 사진 첨부와 대화 압축은 쓰지 않는다
  function applyGone() {
    const T = window.GAMJA_I18N.t;
    const gone = isGone(project);
    const group = !gone && !!roomGroup(project);
    const off = gone || (group && !GROUP_CHAT_ENABLED); // 그룹 채팅을 막아 둔 동안 이미 있던 그룹방은 입력을 끈다
    $('composerBox').classList.toggle('off', off);
    const aiOff = !aiReady(); // AI 계정이 없으면 입력창 위에 연결 안내가 뜨고 입력은 막는다
    els.input.disabled = off || aiOff;
    els.input.placeholder = gone ? T('gone.placeholder') : off ? T('room.groupOff') : aiOff ? T('ai.need.placeholder') : '메시지 입력'; // 그룹 방도 일대일 방처럼 짧게 (긴 안내는 줄바꿈돼 입력칸이 두 줄로 보였다)
    $('aiNotice').classList.toggle('hidden', !aiOff || gone);
    $('composerBox').classList.toggle('hidden', aiOff && !gone); // AI 계정이 없으면 입력창 자리를 연결 안내가 대신한다
    if (aiOff && !gone && !$('aiNotice').firstChild) $('aiNotice').innerHTML = aiNoticeHtml('room');
    if (off || aiOff) els.send.disabled = true; else updateSendState();
    for (const id of ['newBtn', 'ttsBtn', 'voiceBtn']) $(id).classList.toggle('hidden', gone);
    const noContinue = gone || group || crewOf(project) === ''; // 감자 톡톡(크루 없는 방)에서는 이어가기를 숨긴다
    $('continueBtn').classList.toggle('hidden', noContinue);
    $('roomContinueNote').classList.toggle('hidden', noContinue);
    $('exportBtn').classList.toggle('hidden', noContinue);
    $('roomExportNote').classList.toggle('hidden', noContinue);
    $('roomActions').classList.toggle('hidden', gone); // 삭제된 크루의 방에서는 대화 관리를 보여 주지 않는다
    $('attachBtn').classList.toggle('hidden', gone); // 그룹 방도 첨부할 수 있다 (방장이 일할 때 쓰고, 의견을 낼 때는 읽어 본다)
    renderMentionBar(group);
    if (!gone && !chats.some((c) => c.name === project)) refreshChats().then(() => { if (chats.some((c) => c.name === project)) applyGone(); }); // 참여자 정보를 아직 못 받았으면 받은 뒤에 다시 맞춘다
  }
  // 그룹 방: @를 누르면 @ 바로 오른쪽에 참여자 버튼(@대화명)을 펼친다(입력칸은 한 줄 위로). 다시 누르면 접힌다. 대화명을 누르면 골라 두기만 하고(입력칸에는 안 넣음), 보낼 때 말풍선 앞에 고른 순서대로 @대화명을 붙인다. 👑 방장을 부르면 방장이 일하고, 다른 참여자를 부르면 그 참여자만 의견을 낸다
  let mentionOpen = false; // @ 버튼으로 참여자 버튼 줄을 펼쳤는지
  const mentionSel = new Set(); // 골라 둔 대화명 (고른 순서)
  let mentionRoom = null;
  function renderMentionBar(on) {
    const bar = $('mentionBar');
    if (!bar) return;
    const g = on ? roomGroup(project) : null;
    const btn = $('mentionBtn');
    btn.classList.toggle('hidden', !g); // @ 버튼은 그룹 방에서만
    btn.title = window.GAMJA_I18N.t('group.mentionBtn');
    if (!g) mentionOpen = false;
    if (mentionRoom !== project) { mentionSel.clear(); mentionRoom = project; } // 방을 옮기면 골라 둔 대화명을 비운다
    bar.classList.toggle('hidden', !g || !mentionOpen); // 참여자 버튼 줄은 @를 눌렀을 때만 펼친다
    btn.classList.toggle('on', !!g && mentionOpen);
    if (!g) { bar.innerHTML = ''; return; }
    const sorted = [...g].sort((x, y) => String(x.nick || '').localeCompare(String(y.nick || ''), 'ko')); // 가나다 순, 좌우로 밀어서 본다
    for (const n of [...mentionSel]) if (!sorted.some((m) => m.nick === n)) mentionSel.delete(n); // 나간 참여자는 뺀다
    bar.innerHTML = sorted.map((m) => `<button type="button" class="mention-chip${m.leader ? ' lead' : ''}${mentionSel.has(m.nick) ? ' on' : ''}"${memberColor(m) ? ` style="--mc:${memberColor(m)}"` : ''} data-mention="${escapeHtml(m.nick)}">${m.leader ? '👑 ' : ''}@${escapeHtml(m.nick)}</button>`).join('');
  }
  // 참여자 고유 색 (서버가 준 번호 0~7). 밝은·어두운 테마 둘 다에서 보이고, 메인 노란색·두뇌 색과 겹치지 않게 골랐다
  const MEMBER_COLORS = ['#4a8fd1', '#8a6fd0', '#c95b8e', '#2f9a96', '#d4604d', '#5d6fd0', '#6f9a35', '#a5784b'];
  const memberColor = (m) => (m && Number.isInteger(m.color) ? MEMBER_COLORS[m.color % MEMBER_COLORS.length] : '');
  // 보낼 글 앞에 골라 둔 @대화명을 붙이고 고른 것을 비운다 (sendMessage에서 실제로 보내기 직전에 부른다)
  function takeMentions(text) {
    if (!mentionSel.size || !roomGroup(project)) return text;
    const tags = [...mentionSel].map((n) => '@' + n).join(' ');
    mentionSel.clear();
    mentionOpen = false;
    renderMentionBar(true);
    return text ? `${tags} ${text}` : tags;
  }
  // 누를 때 입력칸에서 포커스가 빠지지 않게 (키보드가 내려가지 않게)
  // 🎤 받아쓰기 버튼도: 키보드로 쓰던 중에 누르면 키보드를 그대로 두고 받아쓴 글을 입력칸 글 끝에 이어 붙인다
  for (const id of ['mentionBtn', 'mentionBar', 'micBtn']) $(id).addEventListener('pointerdown', (e) => { if (document.activeElement === els.input) e.preventDefault(); });
  $('mentionBtn').addEventListener('click', () => {
    mentionOpen = !mentionOpen;
    renderMentionBar(true);
    if (mentionOpen && document.activeElement !== els.input) els.input.focus(); // 펼치면 키보드도 올린다
    autoGrow();
  });
  $('mentionBar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mention]');
    if (!b) return;
    // 누르면 골라 두고, 다시 누르면 뺀다. 여러 명을 고를 수 있게 대화명 줄은 접지 않는다 (@를 다시 눌러야 접힌다)
    const n = b.dataset.mention;
    if (mentionSel.has(n)) mentionSel.delete(n); else mentionSel.add(n);
    b.classList.toggle('on', mentionSel.has(n));
    els.input.focus();
  });
  async function loadProjects() {
    const { projects, crews } = await api('/api/projects');
    projectList = projects;
    crewInfo = crews || {};
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
    if (!crewsRemoteAsked) { crewsRemoteAsked = true; loadCrewsRemote(); }
  }
  async function switchProject(name, opts = {}) {
    const prev = project;
    if (name !== prev) roomAgent = null; // 새 방의 참여자 정보는 대화를 불러오며 받는다
    project = name;
    store.set('cc:project', project);
    swapRoomInput(prev, name);
    if (tab === null && !opts.noMark) markOpened(name); // (방에 들어가는 경우만: 이름 바꾸기·삭제 뒤의 전환은 제외)
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
  const crewBlurb = (n) => (n === '' ? '무엇이든 물어보는 기본 대화' : (crewMeta(n) && crewMeta(n).blurb) || crewGroup(n).name);
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
        '<div id="aiNoticeCrew" class="ai-notice-crew"></div><div id="crewListBox"></div>';
    }
    $('aiNoticeCrew').innerHTML = aiReady() ? '' : aiNoticeHtml('crew'); // AI 계정이 없으면 맨 위에 연결 안내
    renderCrewList();
    loadTrash(); // 삭제한 크루가 있으면 맨 아래에 "삭제한 크루 복구하기"가 나온다
  }
  // "직접 만들기"와 "코드로 가져오기" 버튼: 크루 탭과 추천 크루 화면이 똑같은 모양을 쓴다
  const starSvg = () => (window.GAMJA_ICONS ? window.GAMJA_ICONS.svg('star') : '★');
  function makeButtonsHtml() {
    const T = window.GAMJA_I18N.t;
    return `<button class="fr-join fr-make" data-custom="1" type="button">${escapeHtml(T('crew.make'))}<span>${escapeHtml(T('crew.makeSub'))}</span></button>`; // '친구가 보낸 크루 추가' 버튼은 사용자 요청으로 뺐다
  }
  function renderCrewList() {
    const box = $('crewListBox');
    if (!box) return;
    const favs = getFavs();
    const rowHtml = (n) => {
      const { icon, text } = crewParts(n);
      return `<button class="fr-row${n === '' ? ' me' : ''}" data-crew="${escapeHtml(n)}"><i class="fr-av">${escapeHtml(icon)}</i>` +
        `<span class="fr-mid"><b>${gbMarkOf(n)}${escapeHtml(text)}${updInfo(n) ? `<em class="upd-pill">${escapeHtml(window.GAMJA_I18N.t('upd.pill'))}</em>` : ''}</b><small>${escapeHtml(crewBlurb(n))}</small></span></button>`;
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
      if (favs.length) html += `<div class="fr-sec"><span><i class="fr-star">${starSvg()}</i> 자주 쓰는 크루 ${favs.length}</span></div>${list(favs)}`;
      const groups = [...GROUPS, GROUP_ETC];
      const shut = getShut();
      for (const g of groups) {
        const names = projectList.filter((n) => crewGroup(n).id === g.id);
        if (!names.length) continue;
        html += `<button class="fr-grp" data-grp="${g.id}"><span>${escapeHtml(g.name)} ${names.length}</span><small>${shut[g.id] ? '▸' : '▾'}</small></button>`;
        if (!shut[g.id]) html += list(names);
      }
      // 크루 스토어 추천: 아직 안 가진 템플릿
      const rec = window.GAMJA_TEMPLATES.featuredFirst(AGENTS.filter((a) => a.id !== 'd-site' && !projectList.includes(a.folder))).slice(0, 8); // 홈페이지 개발 크루는 추천에서 뺀다 (묶음 목록에는 있음)
      if (rec.length) {
        html += '<div class="fr-sec"><span>추천 크루</span><button class="fr-more" data-store="1" type="button">전체 보기 ›</button></div><div class="fr-shelf">' +
          rec.map((a) => `<div class="fr-card"><i class="fr-av big">${escapeHtml(a.icon)}</i><b>${gbMark(a)}${escapeHtml(a.name)}</b>${gbNote(a)}<small>${escapeHtml(a.blurb)}</small>` +
            `<button class="fr-pill" data-add="${escapeHtml(a.id)}" type="button">추가</button></div>`).join('') + '</div>';
      }
      // 직접 만들기는 크루 탭에서 바로 보이게 둔다 (추천 크루에도 있다)
      html += makeButtonsHtml();
      // 삭제한 크루가 있을 때만: 30일 안에 되살리거나 완전히 지운다
    }
    box.innerHTML = html;
  }
  // ---------- 아래 메뉴(GNB) · 탭 화면: 크루 / 채팅 / 더보기, 그리고 채팅방 ----------
  const chatEl = $('chatPanel');
  const chatBody = $('chatBody');
  const gnbEl = $('gnb');
  let roomAgent = null; // 지금 방의 참여자 정보 (감자알의 conv.agent). 아직 두뇌를 안 정한 방은 null
  const BRAIN_NAME = { claude: 'Claude', codex: 'Codex' };
  const claudeMissing = () => !!(aiState && !aiState.claude && aiState.codexLogin); // Claude는 연결 안 됐고 Codex만 연결된 폰: Codex로 쓴다
  const lastBrain = () => (claudeMissing() || store.get('cc:lastBrain', 'claude') === 'codex' ? 'codex' : 'claude'); // 마지막으로 고른 두뇌 (새 방에 미리 골라 둔다)
  let brainInfo = null, brainInfoAt = 0; // 고를 수 있는 두뇌·생각 깊이와 더보기 › AI의 기본값 (잠깐 기억해 둔다)
  let chats = []; // 채팅 목록 (서버가 크루별 마지막 말·작업 중·안 읽음을 알려 준다)
  let chatTimer = 0;
  let trashDue = false; // 다음 채팅 목록 받기 때 삭제한 채팅 목록도 받는다 (채팅 탭을 열 때)
  let perfNow = null; // 걸린 시간을 재는 중인 것 (perfStart·perfEnd)
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
    navNote();
    const keepPanel = [homeEl, chatEl, settingsEl].find((el) => !el.classList.contains('hidden')); // 더보기로 갈 때 보던 탭 화면 (설정을 불러온 뒤에 바꾼다)
    // 감자알 업데이트로 새로고침을 미뤄 둔 채 채팅방에서 나가면: 쓰던 글을 임시저장하고 바로 새로고침한다
    // (붙여 둔 사진은 새로고침하면 사라지니 그때는 지금처럼 계속 미룬다)
    if (tab === null && name !== null && reloadSince) {
      saveDraft();
      if (!pending.length && !attachPrep.jobs.size && !Object.values(draftImages).some((l) => l && l.length) && !voice.on && !gsOpen && !importBusyNow) {
        try { sessionStorage.setItem('cc:tab', name); } catch { /* 새로고침 뒤 나가려던 탭으로 */ }
        reloadSince = 0;
        location.reload();
        return;
      }
    }
    if (name !== null && uvOn) { uvOn = false; setUsageView(false); } // 채팅방을 나가면 사용량 보기를 끈다
    hideTabs();
    moreLoading = false;
    els.menu.classList.add('hidden');
    tab = name;
    document.body.classList.toggle('in-tab', name !== null); // 탭 화면이 덮고 있는 동안 뒤의 채팅방은 보이지 않게 (불러오는 사이 비쳐 보이던 깜빡임 방지)
    document.documentElement.classList.toggle('pre-tab', name !== null);
    try { sessionStorage.setItem('cc:tab', name || 'room'); } catch { /* 새로고침해도 있던 곳으로 돌아오기 위한 것 */ }
    if (name === 'more' && keepPanel) { keepPanel.classList.remove('hidden'); moreLoading = true; }
    if (name === null) { markSeen(); refreshUsage(true); return; } // 채팅방으로 돌아옴: 그사이 계정을 바꿨으면 사용량 불러오는 중 표시
    if (name === 'crew') { homeEl.classList.remove('hidden'); loadProjects().catch(() => {}).then(renderHome); }
    else if (name === 'chat') { chatKey = ''; trashDue = true; perfStart('list'); chatEl.classList.remove('hidden'); }
    else if (name === 'more') settingsReady = openSettings();
    refreshChats();
    chatTimer = setInterval(refreshChats, 4000); // 아래 메뉴의 안 읽음 숫자와 채팅 목록을 따라간다
    updateGnb();
  }
  gnbEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b && b.dataset.tab !== tab) showTab(b.dataset.tab);
  });
  $('homeBtn').onclick = () => { if (!navBackTo({ t: 'chat' })) showTab('chat'); }; // 채팅방의 ← : 채팅 목록으로

  // 안 읽음: 크루마다 "마지막으로 본 답변 시각"을 이 기기에 기억해 두고, 그 뒤에 온 답변 수를 센다
  function markSeen() {
    if (document.hidden) return; // 화면이 꺼졌거나 다른 앱에 가 있으면 아직 안 본 것이다 (돌아오면 다시 불러오며 읽은 것으로 친다)
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
    // 삭제한 채팅(예전 휴지통) 목록은 채팅 탭을 열 때 한 번만 같이 받는다. 지금은 방을 지우면 바로 지워져서 4초마다 받을 필요가 없다
    const trashReq = trashDue ? api('/api/roomtrash').catch(() => null) : null;
    trashDue = false;
    try { d = await api('/api/chats'); } catch { return; }
    chats = d.chats || [];
    const tr = trashReq && await trashReq;
    if (tr) roomTrashItems = tr.items || []; // 못 받으면 이전 목록 그대로
    for (const c of chats) if (c.name.startsWith('@')) rememberRoomCrew(c.name, c.crew || ''); // 새 방이 속한 크루
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
    const key = `${roomTrashItems.length}|${JSON.stringify(chats)}|${JSON.stringify(seen)}|${JSON.stringify(store.get('cc:roomMade', {}))}|${JSON.stringify(draftRooms())}|${JSON.stringify(getRoomTitles())}|${JSON.stringify(getRoomPins())}|${aiReady()}|${new Date().getMinutes()}`;
    if (tab === 'chat' && key !== chatKey) { chatKey = key; renderChats(seen); }
    if (tab === 'chat') perfEnd('list', chats.length);
  }
  let roomTrashItems = []; // 삭제한 채팅 (채팅 탭 아래 "삭제한 채팅 복구하기")
  // 걸린 시간 기록: 누른 뒤 화면이 다 그려지기까지(ms)를 감자알의 data/perf.jsonl에 남긴다 (속도 개선이 효과가 있었는지 숫자로 보려고. 화면에는 안 보인다)
  function perfStart(kind) { perfNow = { kind, t0: performance.now() }; }
  function perfEnd(kind, n) {
    const p = perfNow;
    if (!p || !p.kind.startsWith(kind)) return;
    perfNow = null;
    requestAnimationFrame(() => setTimeout(() => { // 실제로 화면에 그려진 뒤의 시각
      const ms = Math.round(performance.now() - p.t0);
      if (ms < 60000 && !document.hidden) api('/api/perf', { kind: p.kind, ms, n: n || 0 }).catch(() => {});
    }, 0));
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
    const rooms = chats.filter((c) => !c.archived && (c.archive || c.extra || c.name === '' || c.ts || opened[c.name] || pinned.has(c.name)))
      .filter((c) => GROUP_CHAT_ENABLED || !(c.members && c.members.length > 1)); // 그룹 채팅을 막아 둔 동안은 그룹방을 목록에서 숨긴다
    const archCount = archivedRooms().length; // 보관한 방은 목록에서 빼고 맨 아래 "보관한 채팅"에서만 보인다
    const rowOf = (c) => {
      const icon = crewParts(c.members && c.members.length > 1 ? c.members[0] : c.name).icon; // 그룹 방은 첫 참여자의 아이콘
      const text = roomText(c.name);
      const unread = unreadOf(c, seen);
      const preview = c.archive ? `${window.GAMJA_I18N.t('chat.deletedCrew')} · ${plain(c.last && c.last.text)}` // 삭제된 크루의 남은 대화: 흐리게
        : c.running ? `작업 중… ${plain(c.status)}`.trim()
        : c.last ? `${c.last.role === 'user' ? '나: ' : ''}${plain(c.last.text)}` : '대화를 시작해 보세요';
      return `<button class="cl-row${c.archive ? ' gone' : ''}${!c.archive && !(c.members && c.members.length > 1) && crewOf(c.name) === '' ? ' root' : ''}" data-go="${escapeHtml(c.name)}"${c.archive ? ` data-archive="${escapeHtml(c.archive)}"` : ''}><i class="cl-av">${escapeHtml(icon)}</i>` +
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
    if (pinRooms.length) html += `<div class="cl-hd first"><span><i class="fr-star">${starSvg()}</i> 고정${pinRooms.length}</span></div><div class="cl-list">${pinRooms.map(rowOf).join('')}</div>`;
    if (restRooms.length) html += `<div class="cl-hd${pinRooms.length ? '' : ' first'}"><span>최근 ${restRooms.length}</span></div><div class="cl-list">${restRooms.map(rowOf).join('')}</div>`;
    chatBody.innerHTML = '<div class="tab-head"><h1 class="ui-title">채팅</h1>' +
      '<div class="tab-acts"><button id="chatNewBtn" type="button" aria-label="새 채팅">＋</button></div></div>' + (html || '<p class="empty">아직 대화가 없어요.<br>오른쪽 위 ＋를 눌러 새 채팅을 시작해 보세요.</p>') +
      // AI 계정을 아직 연결하지 않았으면 목록 아래에 연결 안내
      (aiReady() ? '' : `<div class="ai-notice-crew ai-notice-chat">${aiNoticeHtml('chat')}</div>`) +
      // 보관한 채팅이 있을 때만: 꺼내거나 삭제한다
      (archCount ? `<button class="fr-join" data-rarch="1" type="button">${escapeHtml(window.GAMJA_I18N.t('arch.row'))}<span>${archCount} ›</span></button>` : '') +
      // 예전(삭제가 휴지통이던 때)에 지운 채팅이 남아 있을 때만: 30일 안에 되살리거나 완전히 지운다
      (roomTrashItems.length ? `<button class="fr-join" data-rtrash="1" type="button">${escapeHtml(window.GAMJA_I18N.t('rtrash.row'))}<span>${roomTrashItems.length} ›</span></button>` : '');
  }
  // 채팅방 이름: 직접 정한 이름이 있으면 그것, 없으면 크루 이름 (이 기기에 저장)
  const getRoomTitles = () => store.get('cc:roomTitle', {});
  const roomText = (n) => {
    const t = getRoomTitles();
    if (t[n]) return t[n];
    if (isGone(n)) { // 삭제된 크루의 방: 지워지기 전 방 번호로 정해 둔 이름을 찾는다 (새 방은 "@번호"로 정해 뒀다)
      const g = goneName(n);
      const at = g.indexOf('@');
      if (t[g] || (at > 0 && t[g.slice(at)])) return t[g] || t[g.slice(at)];
    }
    return crewParts(n).text;
  }; // 삭제된 크루의 방은 지워지기 전 방 번호로 정해 둔 이름도 찾는다
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
    if (e.target.closest('[data-rtrash]')) return openRoomTrash();
    if (e.target.closest('[data-rarch]')) return openArchived();
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
    navNote();
    if (!navRestoring) navDeadRooms.delete(name); // 직접 다시 연 방은 기록에서 다시 오갈 수 있다
    // 다른 방으로 옮길 때: 작업 중이어도 막지 않는다 (사진을 올리는 중일 때만 잠깐 기다린다)
    if (name !== project && runId === 'pending') return alert('사진을 올리는 중이에요. 올리기가 끝난 뒤에 옮겨 주세요.');
    if (name !== project && (runId || remoteRunId)) detachRun();
    perfStart(name === project ? 'room-same' : 'room');
    if (name !== project) { olderQueue = []; roomAgent = null; showLoading(); } // 다른 방으로 갈 때 이전 방의 대화가 비치지 않게 먼저 비우고 "불러오는 중" 표시를 보여 준다 (새 방의 대화는 곧 불러와서 그린다)
    showTab(null); // 채팅방으로 들어간다 (아래 메뉴는 사라진다)
    markOpened(name);
    // 보관한 방에 다시 들어가면 보관을 풀어 채팅 목록으로 돌아온다
    const ent = chats.find((c) => c.name === name);
    if (ent && ent.archived) { ent.archived = false; setArchived(name, false).catch(() => {}); }
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
    if (t('[data-import]')) return openAgents('__import', true); // 크루 탭에서 바로 연 화면: 뒤로 가면 크루 탭으로 돌아온다
    if (t('[data-custom]')) { customIcon = '🙋'; return openAgents('__custom', true); }
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
    $('shName').innerHTML = gbMarkOf(name) + escapeHtml(text);
    $('shUpd').classList.toggle('hidden', !updInfo(name));
    $('shUpd').textContent = window.GAMJA_I18N.t('upd.sheetBtn');
    $('shBlurb').textContent = crewBlurb(name);
    $('shGroup').textContent = name === '' ? '기본 대화' : g.name;
    const fav = getFavs().includes(name);
    $('shFav').innerHTML = `<span class="gi-lead">${window.GAMJA_ICONS.svg(fav ? 'star' : 'starline')}</span>${fav ? '자주 쓰는 크루' : '자주 쓰는 크루에 추가'}`;
    $('shFav').classList.toggle('on', fav);
    $('shShare').classList.toggle('hidden', !name); // 홈 대화는 공유할 크루가 아니다
    sheetEl.classList.remove('hidden');
  }
  const closeSheet = () => sheetEl.classList.add('hidden');
  sheetEl.addEventListener('click', (e) => { if (e.target === sheetEl) closeSheet(); });
  $('shUpd').onclick = () => { const n = sheetTarget; closeSheet(); doCrewUpdate(n); };
  $('shChat').onclick = () => { const n = sheetTarget; closeSheet(); openNewChat(n); }; // 채팅 시작 화면이 열리고, 고른 크루가 참여자에 들어가 있다
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
  let madeShow = 20, madeOld = false, madeShowOld = 20; // 처음엔 20개만 그리고 [더 보기]로 이어 그린다. 3일 지난 결과물은 접어 둔다
  const fileExt = (p) => (p.match(/\.[^./]+$/) || [''])[0].toLowerCase();
  const OFFICE_EXT = ['.docx', '.xlsx', '.pptx'];
  async function openMade() {
    els.menu.classList.add('hidden');
    let d;
    try { d = await api('/api/preview-files' + q()); } catch (err) { return alert(err.message); }
    // 다른 기기에서 열 주소: 이 폰 안(127.0.0.1)에서 보고 있으면 같은 와이파이 주소를 알려 준다
    const local = ['127.0.0.1', 'localhost'].includes(location.hostname);
    madeData = { files: d.files, base: `/preview/${d.token}/${encodeURIComponent(d.project)}/`, origin: local ? (d.lan[0] || '') : location.origin };
    if (madeKind !== 'all' && !d.files.some((f) => f.kind === madeKind)) madeKind = 'all';
    madeShow = 20; madeOld = false; madeShowOld = 20;
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
    const T = window.GAMJA_I18N.t;
    const shown = files.map((f, i) => ({ f, i })).filter(({ f }) => madeKind === 'all' || f.kind === madeKind);
    const cut = Date.now() - 3 * 86400000;
    const recent = shown.filter(({ f }) => f.mtime >= cut), old = shown.filter(({ f }) => f.mtime < cut);
    const items = (arr) => (madeKind === 'image'
      ? '<div class="made-grid">' + arr.map(({ f, i }) =>
        `<button type="button" data-i="${i}" aria-label="${escapeHtml(f.path)}"><img loading="lazy" decoding="async" alt="" src="${escapeHtml(madeUrl(f))}"></button>`).join('') + '</div>'
      : arr.map(({ f, i }) =>
        `<button class="pick-card" data-i="${i}"><span class="pick-icon">${KIND_ICON[f.kind]}</span><span><b>${escapeHtml(f.path)}</b><small>${KIND_NAME[f.kind]} · ${ago(f.mtime)} · ${kb(f.size)}</small></span></button>`).join(''));
    const moreBtn = (n, which) => (n > 0 ? `<button type="button" class="made-more" data-more="${which}">${escapeHtml(T('made.more', { n }))}</button>` : '');
    let body;
    if (!files.length) {
      body = '<p class="empty">아직 만든 결과물이 없어요.<br>크루에게 "홈페이지 만들어 줘", "로고 이미지 만들어 줘", "보고서 만들어 줘"라고 말해 보세요.</p>';
    } else {
      body = (recent.length ? items(recent.slice(0, madeShow)) + moreBtn(recent.length - madeShow, 'recent') : `<p class="made-note">${escapeHtml(T('made.noRecent'))}</p>`);
      if (old.length) {
        body += `<button type="button" class="made-old${madeOld ? ' open' : ''}" data-old="1">${escapeHtml(T('made.old', { n: old.length }))}<span>${madeOld ? '▴' : '▾'}</span></button>`;
        if (madeOld) body += items(old.slice(0, madeShowOld)) + moreBtn(old.length - madeShowOld, 'old');
      }
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
      if (tab) { madeKind = tab.dataset.kind; madeShow = 20; madeShowOld = 20; return renderMade(); }
      const more = e.target.closest('[data-more]');
      if (more) { // 지금 보던 자리를 그대로 두고 아래에 20개를 더 그린다
        const top = madeBody.scrollTop;
        if (more.dataset.more === 'old') madeShowOld += 20; else madeShow += 20;
        renderMade(); madeBody.scrollTop = top; return;
      }
      if (e.target.closest('[data-old]')) { const top = madeBody.scrollTop; madeOld = !madeOld; renderMade(); madeBody.scrollTop = top; return; }
      const item = e.target.closest('[data-i]');
      if (item) return openResult(madeData.files[Number(item.dataset.i)]);
      if (e.target.id === 'madeCopy') {
        const text = origin + base;
        navigator.clipboard.writeText(text).then(() => toast('📋 주소를 복사했어요'), () => gCopy('이 주소를 복사하세요', text));
      }
    };
  }
  // 🟢 켜 둔 앱 손잡이 (크루가 gamja-make app start로 켠 웹 서버): 상단바 아래 화면 오른쪽 끝에 반원으로 걸려 있다. 앱이 있는 방에서만 보인다.
  // 누르면 왼쪽으로 띠가 펼쳐져 상태와 버튼(열기 · 기록 · 다시 켜기 · 끄기)이 나오고, › 나 바깥을 누르면 다시 반원으로 들어간다. 상태는 10초마다 새로 받아 온다
  const fabEl = $('appFab');
  const fabMenu = $('appFabMenu');
  const fabOn = (a) => a && (a.state === 'running' || a.state === 'starting');
  const fabClose = () => $('appFab').classList.remove('open');
  function renderFab() {
    const T = window.GAMJA_I18N.t;
    const fabEl = $('appFab'), fabMenu = $('appFabMenu');
    const a = fabApp && fabApp.state !== 'stopped' ? fabApp : null; // 끈 앱은 손잡이를 감춘다 (화면을 가리지 않게)
    fabEl.classList.toggle('hidden', !a);
    if (!a) { fabClose(); return; }
    const st = ['running', 'starting', 'crashed'].includes(a.state) ? a.state : 'stopped';
    fabEl.dataset.state = st;
    $('appFabBtn').setAttribute('aria-label', T(`app.fab.${st}`));
    const on = fabOn(a);
    const sub = !on && a.note ? a.note : `:${a.port} · ${a.cmd}`;
    const act = (k, icon, cls = '') => `<button type="button" class="app-fab-act${cls}" data-app="${k}" title="${escapeHtml(T('app.' + k))}" aria-label="${escapeHtml(T('app.' + k))}">${icon}</button>`;
    fabMenu.innerHTML = `<div class="app-fab-info"><b>${escapeHtml(T(`app.fab.${st}`))}</b><small>${escapeHtml(sub)}</small></div>` +
      (on ? act('open', '↗') : '') + act('log', '≡') + act('restart', '↻') + (on ? act('stop', '■', ' danger') : '') +
      `<button type="button" class="app-fab-close" data-app="close" aria-label="close">›</button>`;
  }
  async function refreshFab() {
    const room = project;
    if (!room || els.app.classList.contains('hidden')) return;
    let a = null;
    try { a = (await api('/api/apps?project=' + encodeURIComponent(room))).app || null; } catch { return; }
    if (room !== project) return;
    if (fabRoom !== room) fabClose();
    fabRoom = room;
    fabApp = a;
    renderFab();
  }
  setInterval(() => { if (document.visibilityState === 'visible') refreshFab(); }, 10000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshFab(); });
  $('appFabBtn').onclick = (e) => { e.stopPropagation(); fabEl.classList.toggle('open'); };
  document.addEventListener('click', (e) => { if (!fabEl.contains(e.target)) fabClose(); });
  fabMenu.onclick = (e) => { const b = e.target.closest('[data-app]'); if (!b) return; if (b.dataset.app === 'close') fabClose(); else appAction(b.dataset.app); };
  async function appAction(k) {
    const T = window.GAMJA_I18N.t;
    const a = fabApp;
    if (!a) return;
    fabClose();
    if (k === 'open') {
      const url = `http://localhost:${a.port}`;
      const app = window.GamjaApp;
      if (app && typeof app.openExternal !== 'undefined') return app.openExternal(url);
      return window.open(url, '_blank');
    }
    if (k === 'log') {
      let log = '';
      try { log = (await api('/api/apps?project=' + encodeURIComponent(project) + '&log=1')).log || ''; } catch (err) { return alert(err.message); }
      return gSheet({ title: T('app.log'), pre: log || T('app.logEmpty'), alertOnly: true });
    }
    if (k === 'stop' && !(await gSheet({ title: T('app.stop'), message: T('app.stopConfirm'), ok: T('app.stop'), danger: true }))) return;
    fabApp = { ...a, state: 'starting' };
    if (k === 'restart') renderFab();
    toast(T('app.busy'));
    try {
      const r = await api('/api/apps/action', { project, action: k });
      if (r.error) alert(r.error);
      else toast(T(k === 'stop' ? 'app.stoppedToast' : 'app.restartedToast'));
    } catch (err) { alert(err.message); }
    await refreshFab();
  }
  // 이미지 보기 안에서 도는 확대·이동 기능: 두 손가락으로 확대·축소(손가락 사이 지점 기준), 확대하면 한 손가락으로 이동, 두 번 두드리면 확대/원래대로.
  // 감자 화면 전체가 아니라 사진만 커져서 위쪽 줄은 그대로 있다
  const IMG_ZOOM_JS = [
    '(function(){var img=document.querySelector("img");if(!img)return;',
    'var s=1,x=0,y=0,m=null,last=0,MAX=6;',
    'function ap(){img.style.transform="translate("+x+"px,"+y+"px) scale("+s+")";}',
    'function dist(t){return Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);}',
    'function mid(t){return t.length>1?{x:(t[0].clientX+t[1].clientX)/2,y:(t[0].clientY+t[1].clientY)/2}:{x:t[0].clientX,y:t[0].clientY};}',
    'function limit(){if(s<=1){s=1;x=0;y=0;return;}var mx=img.offsetWidth*(s-1)/2+40,my=img.offsetHeight*(s-1)/2+40;x=Math.max(-mx,Math.min(mx,x));y=Math.max(-my,Math.min(my,y));}',
    'function begin(t){var r=img.getBoundingClientRect(),p=mid(t),cx=r.left+r.width/2,cy=r.top+r.height/2;',
    'm={d:t.length>1?dist(t):0,s:s,n:t.length,cx:cx-x,cy:cy-y,qx:(p.x-cx)/s,qy:(p.y-cy)/s};}',
    'document.addEventListener("touchstart",function(e){',
    'if(e.touches.length===1){var n=Date.now();if(n-last<300){s=s>1?1:2.5;if(s===1){x=0;y=0;}limit();ap();}last=n;}',
    'begin(e.touches);},{passive:false});',
    'document.addEventListener("touchmove",function(e){e.preventDefault();if(!m||!e.touches.length)return;',
    'if(e.touches.length!==m.n){begin(e.touches);return;}',
    'if(m.n>1)s=Math.max(1,Math.min(MAX,m.s*dist(e.touches)/m.d));',
    'else if(s<=1)return;',
    'var p=mid(e.touches);x=p.x-m.cx-s*m.qx;y=p.y-m.cy-s*m.qy;limit();ap();},{passive:false});',
    'function end(e){if(e.touches.length){begin(e.touches);}else{m=null;if(s<1.03){s=1;x=0;y=0;}limit();ap();}}',
    'document.addEventListener("touchend",end,{passive:false});document.addEventListener("touchcancel",end,{passive:false});})();',
  ].join('');
  // 웹페이지·글 안에서 도는 두 손가락 확대·축소 (한 손가락 스크롤은 그대로)
  const PAGE_ZOOM_JS = '(function(){var z=1,m=null,h=document.documentElement;h.style.touchAction="pan-x pan-y";' +
    'function d(t){return Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);}' +
    'addEventListener("touchstart",function(e){if(e.touches.length===2)m={d:d(e.touches),z:z};},{passive:true});' +
    'addEventListener("touchmove",function(e){if(m&&e.touches.length===2){e.preventDefault();z=Math.max(.5,Math.min(4,m.z*d(e.touches)/m.d));h.style.zoom=z;}},{passive:false});' +
    'addEventListener("touchend",function(e){if(e.touches.length<2)m=null;},{passive:true});})();';
  // 파일 하나 열기: 종류마다 보는 방법이 다르다
  let viewDl = null; // 지금 보고 있는 결과물의 내려받기 정보 { url, name }
  function openResult(f) {
    const url = madeUrl(f);
    viewDl = { url, name: f.path.split('/').pop() };
    const abs = location.origin + url;
    const ext = fileExt(f.path);
    const page = (inner, zoom) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>` +
      'html,body{margin:0;height:100%;background:#111;color:#eee;font:15px sans-serif}' +
      'body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:12px;box-sizing:border-box}' +
      'img,video{max-width:100%;max-height:100%;border-radius:8px}audio{width:100%;max-width:480px}.n{opacity:.7;word-break:break-all;text-align:center}' +
      (zoom ? 'html,body{overflow:hidden;touch-action:none}img{touch-action:none;user-select:none;-webkit-user-select:none;-webkit-user-drag:none}' : '') +
      '</style>' + inner + (zoom ? `<script>${IMG_ZOOM_JS}</script>` : '');
    if (f.kind === 'image') return openViewer({ doc: page(`<img src="${escapeHtml(abs)}" alt="">`, true) }, f.path);
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
    if (ext === '.html' || ext === '.htm') return openViewer({ src: url }, f.path); // 웹페이지 (감자알이 확대 기능을 덧붙여 보낸다)
    // 글(txt·md·csv): 내용을 받아 와서 확대 기능이 있는 화면에 담아 연다
    fetch(url).then((r) => r.text()).then((txt) => openViewer({ doc: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:14px;font:15px/1.6 sans-serif;white-space:pre-wrap;word-break:break-word;background:#fff;color:#111}</style>${escapeHtml(txt)}<script>${PAGE_ZOOM_JS}</script>` }, f.path))
      .catch(() => toast('파일을 열지 못했어요'));
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
  // 사진 크게 보기: 채팅 화면을 벗어나지 않고 그 위에 바로 띄운다 (두 손가락 확대, 확대 중 끌어서 옮기기, 두 번 톡 확대/원래대로, ← 나 뒤로 가기로 닫기)
  let photoEl = null;
  const photoOpen = () => !!photoEl && !photoEl.classList.contains('hidden');
  function closePhoto() { if (photoEl) { photoEl.classList.add('hidden'); photoEl.querySelector('img').removeAttribute('src'); } }
  function openPhoto(src) {
    if (!src) return;
    if (!photoEl) {
      photoEl = document.createElement('div');
      photoEl.className = 'photo-view hidden';
      photoEl.innerHTML = '<button type="button" class="photo-back" data-no-i18n>←</button><img alt="" draggable="false">';
      document.body.appendChild(photoEl);
      const img = photoEl.querySelector('img');
      const back = photoEl.querySelector('button');
      back.title = window.GAMJA_I18N.t('photo.close');
      back.onclick = closePhoto;
      let s = 1, x = 0, y = 0, g = null, lastTap = 0;
      const ap = () => { img.style.transform = `translate(${x}px,${y}px) scale(${s})`; };
      const lim = () => {
        const mx = Math.max(0, (img.offsetWidth * s - photoEl.clientWidth) / 2);
        const my = Math.max(0, (img.offsetHeight * s - photoEl.clientHeight) / 2);
        x = Math.max(-mx, Math.min(mx, x));
        y = Math.max(-my, Math.min(my, y));
      };
      const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
      const mid = (t) => (t.length > 1 ? { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 } : { x: t[0].clientX, y: t[0].clientY });
      const begin = (t, moved) => { const p = mid(t); g = { n: t.length, s, x, y, px: p.x, py: p.y, d: t.length > 1 ? dist(t) : 0, moved }; };
      photoEl._reset = () => { s = 1; x = 0; y = 0; g = null; ap(); };
      photoEl.addEventListener('touchstart', (e) => { if (!e.target.closest('button')) begin(e.touches, !!g); }, { passive: true });
      photoEl.addEventListener('touchmove', (e) => {
        if (!g) return;
        e.preventDefault();
        if (e.touches.length !== g.n) { begin(e.touches, true); return; }
        const p = mid(e.touches);
        if (Math.abs(p.x - g.px) + Math.abs(p.y - g.py) > 8 || g.n > 1) g.moved = true;
        if (g.n > 1) { // 손가락 사이의 점이 그대로 손가락 밑에 있도록 확대한다
          const ns = Math.max(1, Math.min(5, g.s * dist(e.touches) / g.d));
          const cx = photoEl.clientWidth / 2, cy = photoEl.clientHeight / 2;
          x = p.x - cx - ns * (g.px - cx - g.x) / g.s;
          y = p.y - cy - ns * (g.py - cy - g.y) / g.s;
          s = ns;
        } else if (s > 1) {
          x = g.x + p.x - g.px;
          y = g.y + p.y - g.py;
        } else return;
        lim();
        ap();
      }, { passive: false });
      const end = (e) => {
        if (e.touches.length) { begin(e.touches, true); return; }
        if (g && !g.moved && g.n === 1 && !e.target.closest('button')) { // 두 번 톡: 확대 ↔ 원래대로
          const now = Date.now();
          if (now - lastTap < 300) { s = s > 1 ? 1 : 2.5; x = 0; y = 0; lastTap = 0; } else lastTap = now;
        }
        g = null;
        if (s < 1.03) { s = 1; x = 0; y = 0; }
        lim();
        ap();
      };
      photoEl.addEventListener('touchend', end);
      photoEl.addEventListener('touchcancel', end);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && photoOpen()) closePhoto(); });
    }
    photoEl._reset();
    photoEl.querySelector('img').src = src;
    photoEl.classList.remove('hidden');
  }
  $('viewDownload').onclick = () => {
    if (!viewDl) return;
    const a = document.createElement('a');
    a.href = viewDl.url;
    a.download = viewDl.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  $('viewBack').onclick = () => { viewEl.classList.add('hidden'); const fr = $('viewFrame'); fr.removeAttribute('srcdoc'); fr.src = 'about:blank'; };
  $('madeBtn').onclick = openMade;
  $('madeBack').onclick = () => { madeEl.classList.add('hidden'); madeBody.textContent = ''; }; // 닫으면 비워서 그림들이 쓰던 메모리를 돌려준다

  // ---------- 👥 크루 고르기 (회사·가게·나만의 크루) ----------
  // 크루 = 프로젝트 + 그 일에 맞는 지침(CLAUDE.md). 고르면 프로젝트가 만들어지고 바로 그 방으로 간다
  const { GROUPS, AGENTS, custom: customInstructions } = window.GAMJA_TEMPLATES;
  const agentEl = $('agentPicker');
  const agentBody = $('agentBody');
  let agentView = null; // null = 분야 고르기, 분야 id = 그 분야의 크루 목록
  const t = window.GAMJA_I18N.t; // 새 화면의 글은 i18n.js에 키로 적고 t('키')로 꺼내 쓴다 (다국어 준비)
  // 직접 만들기 화면에서 고를 수 있는 아이콘 (감자 전용 아이콘으로 바뀌어 보인다)
  const CUSTOM_ICONS = ['🙋', '💬', '🌐', '📄', '📅', '📚', '✍️', '💰', '🧾', '🔎', '📣', '🧳', '🍽️', '🏪', '🏢', '📊',
    '💻', '🧑‍💻', '🚀', '🎓', '⭐', '🎟️', '🔮', '🃏', '☯️', '🗣️', '🎤'];
  let customIcon = '🙋';
  // 크루 입력 양식: "직접 만들기"(p='cf')와 "크루 설정"(p='ps')이 똑같은 모양을 쓴다.
  // v = { icon, name, blurb, group, job }. withInfo=false면 아이콘·이름·소개·묶음은 빼고 맡은 일만 (감자 톡톡 등)
  const noVs = (s) => String(s).replace(/️/g, '');
  function crewFormHtml(p, v, { withInfo = true, jobRows = 4 } = {}) {
    const icons = !v.icon || CUSTOM_ICONS.some((ic) => noVs(ic) === noVs(v.icon)) ? CUSTOM_ICONS : [v.icon, ...CUSTOM_ICONS];
    const info = !withInfo ? '' :
      `<h3>${escapeHtml(t('cf.icon'))}</h3><div class="cf-icons">` +
      icons.map((ic) => `<button type="button" data-ic="${ic}"${noVs(ic) === noVs(v.icon) ? ' class="on"' : ''}>${ic}</button>`).join('') + '</div>' +
      `<label>${escapeHtml(t('cf.name'))}<input id="${p}Name" maxlength="30" value="${escapeHtml(v.name)}" placeholder="${escapeHtml(t('cf.namePh'))}" autocomplete="off"></label>` +
      `<label>${escapeHtml(t('cf.blurb'))}<input id="${p}Blurb" maxlength="40" value="${escapeHtml(v.blurb)}" placeholder="${escapeHtml(t('cf.blurbPh'))}" autocomplete="off"></label>` +
      `<h3>${escapeHtml(t('cf.group'))}</h3>` +
      `<button type="button" class="cf-group" data-grpsel="${p}"><span>${escapeHtml((GROUPS.find((g) => g.id === v.group) || { name: t('cf.groupPick') }).name)}</span><i>›</i></button>` +
      `<input type="hidden" id="${p}Group" value="${escapeHtml(v.group || '')}">`;
    return info + `<label>${escapeHtml(t('cf.job'))}<textarea id="${p}Job" rows="${jobRows}" placeholder="${escapeHtml(t('cf.jobPh'))}">${escapeHtml(v.job || '')}</textarea></label>`;
  }
  // 양식에서 값을 읽는다 (아이콘은 눌려 있는 버튼, 묶음은 고른 칸)
  function readCrewForm(root, p) {
    const on = root.querySelector('.cf-icons .on');
    return {
      icon: on ? on.dataset.ic : null,
      name: root.querySelector(`#${p}Name`) ? root.querySelector(`#${p}Name`).value.trim() : null,
      blurb: root.querySelector(`#${p}Blurb`) ? root.querySelector(`#${p}Blurb`).value.trim() : null,
      group: (root.querySelector(`#${p}Group`) || {}).value || null,
      job: root.querySelector(`#${p}Job`).value,
    };
  }
  function renderAgents() {
    if (agentView === '__custom') {
      $('agentTitle').textContent = t('cf.title');
      agentBody.innerHTML = `<p class="settings-note">${escapeHtml(t('cf.intro'))}</p>` +
        crewFormHtml('cf', { icon: '', name: '', blurb: '', group: '', job: '' }) + // 아이콘·묶음은 직접 고르게 비워 둔다
        `<button id="cfMake" class="settings-save" type="button" disabled>${escapeHtml(t('cf.make'))}</button>`;
      agentBody.scrollTop = 0;
      return;
    }
    if (!agentView) {
      $('agentTitle').textContent = '추천 크루';
      agentBody.innerHTML = (clipCrew
        ? `<button class="pick-card pick-hot" data-clip="1"><span class="pick-icon">📥</span><span><b>복사한 크루 가져오기</b><small>${escapeHtml(clipCrew.icon)} ${escapeHtml(clipCrew.name)}</small></span></button>`
        : '') +
        '<h3>🙋 나는 어떤 사람이에요?</h3><p class="settings-note">고르면 그 사람에게 맞는 크루를 모아서 보여 드려요.</p>' +
        window.GAMJA_TEMPLATES.PERSONAS.map((x) =>
          `<button class="pick-card" data-persona="${x.id}"><span class="pick-icon">${x.icon}</span><span><b>${escapeHtml(x.name)}</b><small>${escapeHtml(x.desc)}</small></span></button>`).join('') +
        '<h3>⭐ 깊게 도와주는 전문가 크루</h3>' +
        window.GAMJA_TEMPLATES.featuredFirst(AGENTS.filter((a) => a.featured)).map((a) =>
          `<button class="pick-card" data-agent="${a.id}"><span class="pick-icon">${a.icon}</span><span><b>${gbMark(a)}${a.name}</b><small>${a.blurb}</small></span></button>`).join('') +
        '<h3>분야별로 보기</h3>' + GROUPS.map((g) =>
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
    } else if (String(agentView).startsWith('persona:')) {
      const ps = window.GAMJA_TEMPLATES.PERSONAS.find((x) => x.id === agentView.slice(8));
      if (!ps) { agentView = null; return renderAgents(); }
      $('agentTitle').textContent = `${ps.icon} ${ps.name}`;
      agentBody.innerHTML = `<p class="settings-note">${escapeHtml(ps.desc)}. 위에 있을수록 먼저 써 보시길 권해요.</p>` +
        ps.agents.map((id) => AGENTS.find((a) => a.id === id)).filter(Boolean).map((a) =>
          `<button class="pick-card" data-agent="${a.id}"><span class="pick-icon">${a.icon}</span><span><b>${gbMark(a)}${a.name}</b><small>${a.blurb}</small></span></button>`).join('');
    } else {
      const g = GROUPS.find((x) => x.id === agentView);
      $('agentTitle').textContent = `${g.icon} ${g.name}`;
      agentBody.innerHTML = AGENTS.filter((a) => a.group === agentView).map((a) =>
        `<button class="pick-card" data-agent="${a.id}"><span class="pick-icon">${a.icon}</span><span><b>${gbMark(a)}${a.name}</b><small>${a.blurb}</small></span></button>`).join('');
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
  }
  $('agentBack').onclick = () => {
    if (agentView && !agentDirect) { agentView = null; renderAgents(); } else { agentDirect = false; agentView = null; agentEl.classList.add('hidden'); }
  };
  // go: 만든 뒤 그 크루 방으로 갈지. 크루는 지침이고 채팅방은 따로 만들므로, 크루를 만들면 크루 탭의 내 크루 목록으로 돌아간다
  async function createAgent({ folder, instructions, tpl, meta, go = false }) {
    if (go && runId === 'pending') return alert('사진을 올리는 중이에요. 올리기가 끝난 뒤에 만들 수 있어요.');
    if (go && runId) detachRun(); // 보던 방의 작업은 감자알에서 계속된다
    let created = true;
    // 크루를 만들어도 채팅방은 생기지 않는다. 지운 크루를 같은 이름으로 다시 추가해도 옛 대화는 되살리지 않는다
    try { await api('/api/projects', { name: folder }); }
    catch (err) {
      if (!/이미 있어요/.test(err.message)) return alert(err.message);
      created = false; // 이미 있는 크루면 지침을 덮어쓰지 않고 그 방으로만 간다
    }
    if (created) {
      const def = tpl ? AGENTS.find((x) => x.id === tpl && x.version) : null; // 시험한 템플릿이면 어떤 버전으로 만들었는지 기록한다
      try { await api('/api/project-settings', { project: folder, instructions, ...(def ? { tpl: { id: def.id, ver: def.version } } : {}) }); }
      catch (err) { return alert(err.message); }
    }
    if (created) window.gaTrack('crew_create', { kind: tpl ? 'agent' : 'crew' });
    if (tpl && created) store.set(`cc:tpl:${folder}`, tpl);
    if (created) { try { await loadProjects(); } catch { /* 목록은 곧 다시 받는다 */ } } // 버전 기록(배지)을 바로 반영
    if (meta && created) store.set(`cc:crew:${folder}`, meta); // 가져온 크루의 이름·아이콘·예시 문장 (빈 방에서 보여 줌)
    clipCrew = null;
    agentEl.classList.add('hidden');
    if (!go) {
      if (tab !== 'crew') showTab('crew'); // 채팅방 ⋯ 메뉴 등에서 만들었어도 내 크루 목록에서 보이게
      await loadProjects();
      renderHome();
      return toast(created ? '✅ 크루를 추가했어요. 위의 내 크루에서 찾을 수 있어요' : '이미 있는 크루예요');
    }
    showTab(null); // 크루 탭에서 크루를 추가했으면 그 크루 방으로 바로 간다 (첫 메시지를 보내기 전까지는 채팅 목록에 없다)
    await switchProject(folder, { noMark: created });
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
    return createAgent({
      folder: newCrewFolder(), instructions: customInstructions(name, job), tpl: 'custom',
      meta: { name, icon: customIcon, blurb, group, examples: [] },
    });
  }
  // 이름·맡은 일을 적고 아이콘·묶음을 골라야 만들 수 있다
  const cfReady = () => {
    const b = $('cfMake');
    if (b) b.disabled = !($('cfName').value.trim() && $('cfJob').value.trim() && agentBody.querySelector('.cf-icons .on') && $('cfGroup').value);
  };
  agentBody.addEventListener('input', (e) => { if (e.target.id === 'cfName' || e.target.id === 'cfJob') cfReady(); });
  agentBody.addEventListener('change', (e) => { if (e.target.id === 'cfGroup') cfReady(); });
  // 묶음 고르기: 양식의 "묶음" 줄을 누르면 아래에서 올라오는 시트로 고른다 (두 양식 공통)
  const groupSheetEl = $('groupSheet');
  let groupTarget = null; // 지금 고르는 양식의 숨은 칸
  const closeGroupSheet = () => { groupSheetEl.classList.add('hidden'); groupTarget = null; };
  function openGroupSheet(btn) {
    const input = $(`${btn.dataset.grpsel}Group`);
    if (!input) return;
    groupTarget = { input, btn };
    $('gpTitle').textContent = t('cf.group');
    $('gpList').innerHTML = GROUPS.map((g) =>
      `<button type="button" class="gp-item${g.id === input.value ? ' on' : ''}" data-gp="${g.id}"><i class="pick-icon">${g.icon}</i>` +
      `<span><b>${escapeHtml(g.name)}</b><small>${escapeHtml(g.desc)}</small></span><em>${g.id === input.value ? '✅' : ''}</em></button>`).join('');
    groupSheetEl.classList.remove('hidden');
  }
  groupSheetEl.addEventListener('click', (e) => {
    const it = e.target.closest('[data-gp]');
    if (it && groupTarget) {
      const g = GROUPS.find((x) => x.id === it.dataset.gp);
      groupTarget.input.value = g.id;
      groupTarget.btn.querySelector('span').textContent = g.name;
      groupTarget.input.dispatchEvent(new Event('change', { bubbles: true })); // 크루 설정 화면은 고르는 순간 저장된다
      return closeGroupSheet();
    }
    if (e.target === groupSheetEl) closeGroupSheet();
  });
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-grpsel]'); if (b) openGroupSheet(b); });
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
  // 새 크루의 폴더 이름: 크루 이름과 상관없는 고유 아이디(crew-a1b2c3). 화면에 보이는 이름은 감자알의 크루 정보에 따로 저장된다
  function newCrewFolder() {
    const existing = new Set(projectList.map((n) => n.toLowerCase()));
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789'; // 헷갈리는 글자(0 o 1 l i)는 뺀다
    for (;;) {
      let id = 'crew-';
      for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
      if (!existing.has(id)) return id;
    }
  }
  async function addCrew() {
    const c = pendingCrew;
    if (!c) return;
    if (runId) return alert('응답이 끝난 뒤에 크루를 추가할 수 있어요.');
    pendingCrew = null;
    await createAgent({
      folder: newCrewFolder(), instructions: c.instructions, tpl: 'crew',
      meta: { name: c.name, icon: c.icon, blurb: c.blurb, author: c.author, examples: c.examples },
    });
  }
  // 짧게 떴다 사라지는 알림 (확인창 대신)
  let toastTimer = 0;
  function toast(text, sub) { // sub: 아래에 작게 붙는 둘째 줄
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = text;
    if (sub) { const s = document.createElement('small'); s.textContent = sub; t.append(s); }
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
      `<label class="share-check"><span>${window.GAMJA_I18N.t('share.privacyCheck')}</span><input id="shareOk" type="checkbox"></label>` +
      `<p class="settings-note">${window.GAMJA_I18N.t('share.allInCode')}</p>` +
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

  // 복사한 크루 코드는 "친구가 보낸 크루 추가" 화면의 붙여넣기 버튼을 누를 때만 읽는다
  // (추천 크루 화면을 열 때 몰래 읽으면 브라우저가 "클립보드 확인" 허용 창을 띄운다)
  let clipCrew = null;

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
    if (btn && btn.dataset.ic) { pickIcon(btn); return cfReady(); }
    if (btn && btn.id === 'crewCancel') { pendingCrew = null; agentView = null; return renderAgents(); }
    // 직접 만들기·코드로 가져오기 (크루 탭과 같은 모양의 버튼)
    if (btn && btn.dataset.custom) { customIcon = '🙋'; agentView = '__custom'; return renderAgents(); }
    if (btn && btn.dataset.import) { agentView = '__import'; return renderAgents(); }
    const b = e.target.closest('.pick-card');
    if (!b) return;
    if (b.dataset.persona) { agentView = 'persona:' + b.dataset.persona; renderAgents(); }
    else if (b.dataset.group) { agentView = b.dataset.group; renderAgents(); }
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
  let importBusyNow = false; // 이사오기 올리기·설치 중
  let lastTypeAt = 0; // 입력칸에 마지막으로 글자를 친 시각
  // 사람이 쓰는 중이거나 크루가 답하는 중인지: 이때 새로고침하면 쓰던 글(조합 중인 한글)·붙여 둔 사진·답하는 화면이 사라진다
  const composeBusy = () => !!(runId || remoteRunId || pending.length || attachPrep.jobs.size ||
    Date.now() - lastTypeAt < 30000 || (document.activeElement === els.input && els.input.value.trim()));
  // user: 사용자가 직접 새로고침을 당겼을 때 (그때는 글쓰기 확인은 건너뛴다)
  function requestReload(user = false) {
    // 알림창이 열려 있거나 이사오기를 올리는 중이면 닫을 때까지 미룬다 (알림창이 뜨자마자 사라지지 않게)
    if (voice.on || speaking() || gsOpen || importBusyNow || (!user && composeBusy())) { if (!reloadSince) reloadSince = Date.now(); return false; }
    location.reload();
    return true;
  }
  // 미뤄 둔 새로고침만 1초마다 다시 확인한다 (화면 안의 값만 보고, 감자알에는 묻지 않는다)
  setInterval(() => {
    if (!reloadSince || composeBusy()) return;
    if (voice.on || (speaking() && Date.now() - reloadSince < 90000)) return;
    if ((gsOpen || importBusyNow) && Date.now() - reloadSince < 600000) return; // 알림창·이사오기 중에는 최대 10분까지 미룬다
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
      if (isGone(project)) data = await api('/api/history?archive=' + encodeURIComponent(project.slice(1)));
      else {
        // 화면에 그려 둔 기록의 rev를 보내면, 기록이 그대로일 때 서버가 대화 전체 대신 "같음"만 알려 준다
        const sendRev = loadedProject === project && historyRev && historyRevProject === project;
        // 긴 방은 처음에 최근 대화만 받고(tail), 위로 올려 오래된 대화가 필요해지면 그때 전체를 받는다 (fetchHiddenOlder)
        data = await api('/api/history' + q() + (sendRev ? `&rev=${encodeURIComponent(historyRev)}` : '') + (fullFor.has(project) ? '' : `&tail=${TAIL}`));
        if (data.same) data.messages = history;
        data = await migrateLocal(data);
      }
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
    loadRoomPrefs(data.prefs); // 이 방만의 설정(읽어주기·목소리·글자 크기) 적용
    roomAgent = data.agent || null; // 이 방 참여자의 두뇌·생각 깊이·대화명
    // 같은 대화를 다시 불러올 때(답이 끝났을 때 포함)는 화면을 절대 움직이지 않는다. 어느 곳을 보고 있었든 그 자리를 그대로 둔다.
    // 맨 아래로 가는 건: 내가 글을 보냈을 때, 다른 프로젝트·새 대화로 바뀌었을 때뿐. 페이지를 새로 열었으면 저장해 둔 위치로 돌아간다
    const sameConv = loadedProject === project && data.messages.length >= history.length;
    const saved = loadedProject === null ? store.get('cc:scroll', null) : null;
    const keepTop = sameConv ? els.messages.scrollTop
      : saved && saved.project === project && !saved.bottom ? saved.top : null;
    loadedProject = project;
    // 다시 그리면 전체 높이가 달라질 수 있으니(막 시작한 답 말풍선 등) "맨 아래까지 남은 거리"를 기억해 둔다
    const distBottom = els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight;
    const stayBottom = sameConv && distBottom <= 160;
    // 기록이 그대로면 다시 그리지 않는다 (위치·선택 영역 유지)
    if (sameConv && !data.running && !liveView && !awaitingRestart && data.messages.length === history.length &&
      data.messages.at(-1)?.ts === history.at(-1)?.ts && els.messages.children.length && !els.messages.querySelector('.loading')) {
      sessionId = data.sessionId;
      setRunning(false);
      // 기록이 그대로여도 읽음 처리는 한다 (화면이 꺼진 사이 받은 답은 그때 읽음 처리를 건너뛰었으므로, 돌아와 다시 불러올 때 여기서 처리)
      if (tab === null) markSeen();
      perfEnd('room', history.length);
      return;
    }
    // 폴링 중 기록이 그대로면 진행 중인 말풍선만 갱신 (긴 대화를 매번 다시 그리지 않도록)
    if (data.running && liveView && data.messages.length === history.length && data.runId === remoteRunId) {
      const live = { role: 'bot', text: data.live.text, tools: data.live.tools, by: data.live.by || undefined, summary: data.live.summary };
      if ((live.by || '') !== (liveView.by || '')) { liveView.by = live.by; labelRow(liveView.row, live); }
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
    historyRev = data.rev || '';
    historyRevProject = project;
    if (!data.same) serverHidden = data.partial ? data.hiddenCount || 0 : 0;
    els.messages.innerHTML = '';
    if (!history.length && !data.running && !data.archived) showEmpty();
    // 큰 방은 맨 아래로 열 때 가장 최근 대화부터 그려서 바로 보여 주고, 오래된 대화는 위로 올려 읽을 때 조금씩 위에 붙인다 (화면이 얼지 않게)
    // 이미 일부만 그려 둔 방을 다시 그릴 때는 같은 만큼만 위쪽을 비워 둔다 (읽던 위치 keepTop이 그대로 맞도록)
    const partial = sameConv && olderQueue.length > 0 && olderQueue.length < history.length;
    const lazy = partial || (keepTop === null && history.length > FIRST_PAINT * 1.5);
    const older = partial ? history.slice(0, olderQueue.length) : lazy ? history.slice(0, history.length - FIRST_PAINT) : [];
    for (const m of lazy ? history.slice(older.length) : history) addMessage(m);
    if (data.archived) addGoneNote();

    // 진행 중인 응답이 있으면 (다른 기기에서 보냈거나, 화면이 꺼져 연결이 끊긴 경우) 따라가며 보여준다
    // 사용자가 중지를 누른 응답은 서버가 정리하는 동안에도 화면에서 바로 끝난 것으로 보여 준다
    const stoppedLocal = !!(data.running && stoppingId && (stoppingId === '*' || stoppingId === data.runId));
    if (!data.running) stoppingId = null;
    remoteRunId = data.running && !stoppedLocal ? data.runId : null;
    if (stoppedLocal) {
      addMessage({ role: 'error', text: '⏹ 중지했습니다.', ts: Date.now() }); // 서버 기록이 오기 전에 먼저 보여 준다 (서버 기록으로 다시 그려지면 바뀐다)
      setRunning(false);
      pollTimer = setTimeout(loadConversation, 700);
    } else if (data.running) {
      const live = { role: 'bot', text: data.live.text, tools: data.live.tools, by: data.live.by || undefined, summary: data.live.summary };
      liveView = addMessage(live);
      liveView.by = live.by;
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
    if (keepTop === null || stayBottom) scrollBottom(true); // 맨 아래를 보고 있었으면 계속 맨 아래 (따라가기도 유지)
    else {
      const m = els.messages;
      m.scrollTop = sameConv ? m.scrollHeight - m.clientHeight - distBottom : keepTop; // 위로 올려 읽던 중이면 맨 아래 기준 거리를 유지
      follow = false; noteBox();
    } // 읽던 곳을 그대로 두고, 자동으로 따라 내려가지 않는다
    if (tab === null) markSeen(); // 채팅방 안에서 받은 답은 읽은 것으로 친다 (채팅 목록의 안 읽음 숫자용)
    olderQueue = older; // 오래된 대화는 위로 올려 읽을 때 조금씩 붙인다
    perfEnd('room', history.length);
  }
  let olderQueue = []; // 아직 그리지 않은 오래된 대화 (오래된 것부터)
  const FIRST_PAINT = 40; // 큰 방을 열 때 먼저 그리는 최근 대화 수
  const OLDER_CHUNK = 30; // 위로 올릴 때 한 번에 위에 붙이는 오래된 대화 수
  // 위로 올려 읽다가 맨 위 가까이 오면 오래된 대화를 한 조각 위에 붙인다 (카톡처럼). 맨 아래만 보는 동안에는 화면을 건드리지 않는다.
  // 붙일 때는 보던 말풍선의 실제 화면 위치를 재서 그대로 지킨다 (높이 차이를 정수로 더하면 조금씩 어긋난다)
  const TAIL = 150; // 긴 방을 열 때 서버에서 먼저 받는 최근 대화 수
  const fullFor = new Set(); // 전체 기록을 이미 받은 방
  let serverHidden = 0; // 서버가 아직 안 보낸 오래된 대화 수
  let fetchingOlder = false;
  // 받아 둔 오래된 대화를 다 올려 읽었는데 서버에 더 있으면, 그때 전체를 한 번 받아서 오래된 쪽에 이어 붙인다
  async function fetchHiddenOlder() {
    if (fetchingOlder || !serverHidden || runId || remoteRunId) return;
    fetchingOlder = true;
    const proj = project;
    try {
      const d = await api('/api/history' + q());
      if (proj !== project || !d.messages) return;
      const extra = d.messages.slice(0, Math.max(0, d.messages.length - history.length));
      olderQueue = [...extra, ...olderQueue];
      history = d.messages;
      historyRev = d.rev || '';
      historyRevProject = project;
      fullFor.add(project);
      serverHidden = 0;
      loadOlder();
    } catch { /* 다음에 위로 올릴 때 다시 시도한다 */ } finally { fetchingOlder = false; }
  }
  function loadOlder() {
    const m = els.messages;
    if (m.scrollTop > 800) return;
    if (!olderQueue.length) { if (serverHidden) fetchHiddenOlder(); return; }
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
  async function restoreArchived(archiveId, go, opts = {}) {
    const T = window.GAMJA_I18N.t;
    const old = `~${archiveId}`;
    const oldCrew = crewOf(goneName(old));
    let newName = '';
    let r;
    for (;;) { // 같은 이름의 크루가 이미 있으면 새 이름을 물어서 다시 시도한다
      try { r = await api('/api/archive/restore', { id: archiveId, ...(newName ? { newName } : {}), ...(opts.roomsOnly ? { roomsOnly: true } : {}) }); break; } catch (err) {
        if (opts.roomsOnly) throw err;
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
    if (!opts.quiet) toast(T('gone.restored'));
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
        `<small>${escapeHtml(it.damaged ? T('trash.damaged', { when }) : T('trash.meta', { when, left, n: it.messages }))}</small></div>` +
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
  // ---------- 🗑 삭제한 채팅 복구하기 (채팅 탭) ----------
  const rtrashEl = $('rtrashPanel');
  // 같은 화면을 "보관한 채팅"(rtMode 'arch')과 예전 "삭제한 채팅"(휴지통) 두 가지로 쓴다
  let rtMode = 'trash';
  const archivedRooms = () => chats.filter((c) => c.archived && (GROUP_CHAT_ENABLED || !(c.members && c.members.length > 1)));
  function renderArchived() {
    const T = window.GAMJA_I18N.t;
    $('rtrashBar').textContent = T('arch.title');
    $('rtrashH').textContent = T('arch.title');
    $('rtrashNote').textContent = T('arch.note');
    const list = archivedRooms().sort((a, b) => (b.ts || 0) - (a.ts || 0));
    $('rtrashList').innerHTML = list.length ? list.map((c) => {
      const name = roomText(c.name);
      const icon = crewParts(c.members && c.members.length > 1 ? c.members[0] : c.name).icon;
      return `<div class="tool-card"><i class="fr-av">${escapeHtml(icon)}</i><div class="tool-mid"><b>${escapeHtml(name)}</b>` +
        `<small>${escapeHtml(c.ts ? chatTime(c.ts) : '')}</small>` +
        (c.last ? `<small>${escapeHtml(plain(c.last.text).slice(0, 60))}</small>` : '') + `</div>` +
        `<div class="trash-btns"><button class="tool-btn" type="button" data-aopen="${escapeHtml(c.name)}">${escapeHtml(T('arch.open'))}</button>` +
        `<button class="tool-btn danger" type="button" data-adel="${escapeHtml(c.name)}" data-name="${escapeHtml(name)}">${escapeHtml(T('room.deleteOk'))}</button></div></div>`;
    }).join('') : `<p class="empty">${escapeHtml(T('arch.empty'))}</p>`;
  }
  async function openArchived() {
    rtMode = 'arch';
    await refreshChats();
    renderArchived();
    rtrashEl.classList.remove('hidden');
  }
  // 채팅방 보관·꺼내기 (감자알에 표시만 바꾼다)
  async function setArchived(name, on) {
    await api('/api/rooms/archive', { room: name, on });
    chatKey = '';
    await refreshChats();
  }
  // 채팅방 삭제: 대화와 결과물을 바로 지운다 (복구할 수 없다)
  async function deleteRoomNow(name) {
    await api('/api/rooms/delete', { room: name });
    navDeadRooms.add(name); // 뒤로 가기로 이 방에 다시 들어가지 않게
    forgetRoom(name);
    if (project === name) { project = ''; store.set('cc:project', ''); swapRoomInput(name, ''); updateHomeBtn(); } // 없어진 방에서는 감자 톡톡으로 나간다
    await refreshChats();
  }
  function renderRoomTrash() {
    const T = window.GAMJA_I18N.t;
    if (rtMode === 'arch') return renderArchived();
    $('rtrashBar').textContent = T('rtrash.title');
    $('rtrashH').textContent = T('rtrash.title');
    $('rtrashNote').textContent = T('rtrash.note');
    const DAY = 86400e3;
    $('rtrashList').innerHTML = roomTrashItems.length ? roomTrashItems.map((it) => {
      const days = Math.max(0, Math.floor((Date.now() - it.deletedAt) / DAY));
      const left = Math.max(0, 30 - days);
      const when = days === 0 ? T('trash.today') : T('trash.ago', { d: days });
      const name = roomText(it.room);
      return `<div class="tool-card"><i class="fr-av">${escapeHtml(crewParts(it.crew).icon)}</i><div class="tool-mid"><b>${escapeHtml(name)}</b>` +
        `<small>${escapeHtml(it.damaged ? T('trash.damaged', { when }) : T('rtrash.meta', { when, left, n: it.messages }))}</small>` +
        (it.last ? `<small>${escapeHtml(plain(it.last).slice(0, 60))}</small>` : '') + `</div>` +
        `<div class="trash-btns"><button class="tool-btn" type="button" data-rrestore="${escapeHtml(it.id)}">${escapeHtml(T('trash.restore'))}</button>` +
        `<button class="tool-btn danger" type="button" data-rpurge="${escapeHtml(it.id)}" data-room="${escapeHtml(it.room)}" data-name="${escapeHtml(name)}">${escapeHtml(T('trash.purge'))}</button></div></div>`;
    }).join('') : `<p class="empty">${escapeHtml(T('rtrash.empty'))}</p>`;
  }
  async function loadRoomTrash() {
    try { roomTrashItems = (await api('/api/roomtrash')).items || []; } catch { return; }
    chatKey = '';
    renderRoomTrash();
    if (tab === 'chat') refreshChats();
  }
  async function openRoomTrash() {
    rtMode = 'trash';
    await loadRoomTrash();
    rtrashEl.classList.remove('hidden');
  }
  $('rtrashBack').onclick = () => rtrashEl.classList.add('hidden');
  rtrashEl.addEventListener('click', async (e) => {
    const T = window.GAMJA_I18N.t;
    const re = e.target.closest('[data-rrestore]');
    const pu = e.target.closest('[data-rpurge]');
    const ao = e.target.closest('[data-aopen]');
    const ad = e.target.closest('[data-adel]');
    if (ao) { // 꺼내기: 채팅 목록으로 돌아오고 그 방으로 들어간다
      ao.disabled = true;
      try { await setArchived(ao.dataset.aopen, false); } catch (err) { ao.disabled = false; return alert(err.message); }
      toast(T('arch.opened'));
      rtrashEl.classList.add('hidden');
      selectProject(ao.dataset.aopen);
    } else if (ad) {
      if (!(await gSheet({ title: T('room.deleteTitle'), message: T('room.deleteConfirm', { name: ad.dataset.name }), ok: T('room.deleteOk'), danger: true }))) return;
      try { await deleteRoomNow(ad.dataset.adel); } catch (err) { return alert(err.message); }
      renderArchived();
    } else if (re) {
      re.disabled = true;
      try { await api('/api/roomtrash/restore', { id: re.dataset.rrestore }); window.gaTrack('room_trash_restore'); toast(T('rtrash.restored')); } catch (err) { alert(err.message); }
      await loadRoomTrash();
    } else if (pu) {
      if (!(await gSheet({ title: T('trash.purgeTitle'), message: T('rtrash.purgeMsg', { name: pu.dataset.name }), ok: T('trash.purgeOk'), danger: true }))) return;
      try { await api('/api/roomtrash/purge', { id: pu.dataset.rpurge }); } catch (err) { return alert(err.message); }
      forgetRoom(pu.dataset.room); // 이제 이름·고정 같은 기록도 비운다
      await loadRoomTrash();
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
      if (s.boot && bootId && s.boot !== bootId) { // 쓰는 중·답하는 중이면 requestReload가 미뤘다가 끝나면 한다
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
        // 만든 곳: 웹감자 홈페이지·문의 (버튼 모양 링크)
        `<div class="welcome-brand"><b>${escapeHtml(window.GAMJA_I18N.t('welcome.brand'))}</b>` +
        '<div class="welcome-links">' +
        `<a class="welcome-link" href="https://webgamja.com" target="_blank" rel="noopener"><span class="gi-lead">${window.GAMJA_ICONS.svg('globe')}</span>webgamja.com</a>` +
        `<a class="welcome-link" href="mailto:help@webgamja.com"><span class="gi-lead">${window.GAMJA_ICONS.svg('mail')}</span>help@webgamja.com</a></div>` +
        `<p class="welcome-zoom">${window.GAMJA_I18N.t('welcome.zoom')}</p></div></div>`;
      return;
    }
    // 크루 방: 무엇을 시킬지 막막하지 않게 예시 문장을 보여 준다 (누르면 입력창에 들어감)
    const tpl = crewMeta(project);
    const chips = tpl && tpl.examples && tpl.examples.length
      ? `<p class="welcome-ask">${tpl.icon} ${escapeHtml(stripCrew(tpl.name))}에게 이렇게 시켜 보세요</p>` +
        tpl.examples.map((t) => `<button class="chip" data-example="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')
      : '';
    els.messages.innerHTML = `<div class="empty">✳︎<br><b>${escapeHtml(roomText(project))}</b>에서 새 대화를 시작하세요.<br>파일 수정은 자동 승인(acceptEdits)됩니다.<div id="brainPickBox"></div>${chips}</div>`;
    renderBrainPick(); // 아직 대화를 시작하지 않은 방이면 두뇌를 고른다
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
  // 최근 감자알 업데이트: 줄을 누르면 그 버전에서 바뀐 내용을 아래 시트로 보여 준다
  let updateList = [];
  $('updateHistory').addEventListener('click', (e) => {
    const b = e.target.closest('[data-upd]');
    const u = b && updateList[+b.dataset.upd];
    if (!u) return;
    const T = window.GAMJA_I18N.t;
    const en = window.GAMJA_I18N.lang === 'en';
    const items = (u.notes || []).flatMap((n) => (en && n.en && n.en.length ? n.en : n.ko) || []);
    gSheet({ title: T('upd.title', { v: u.version }), message: items.length ? items.map((x) => '• ' + x).join('\n') : T('upd.none'), alertOnly: true });
  });
  async function openSettings() {
    els.menu.classList.add('hidden');
    let d;
    try { d = await api('/api/settings' + q()); } catch (err) { moreLoading = false; updateGnb(); return alert(err.message); }
    showSettingsPage(null); // 항상 설정 목록부터
    $('acctGamja').textContent = d.info.local ? '✅ 로그인됨 · 이 폰' : '✅ 로그인됨 · 다른 기기';
    // 감자 앱 안에서 열었을 때만 "감자 앱" 칸을 보여 준다
    $('appGroup').classList.toggle('hidden', !window.GamjaApp);
    loadAccounts();
    $('infoAppRow').classList.toggle('hidden', !window.GamjaApp);
    // 감자알 로그는 일반 사용자에게 필요 없어서 숨겨 둔다. 나중에 프로(개발자) 모드를 켰을 때만 보여 준다 (앱에서만)
    proUi = !!d.info.pro; // 개발자 모드 (Termux 설치 명령 등을 보여 줄지)
    $('installRowTitle').textContent = window.GAMJA_I18N.t('install.row');
    $('installRowSub').textContent = window.GAMJA_I18N.t('install.rowSub');
    $('extRowTitle').textContent = window.GAMJA_I18N.t('ext.rowTitle');
    $('extRowSub').textContent = window.GAMJA_I18N.t('ext.rowSub');
    if (window.GamjaApp) $('infoApp').textContent = window.GamjaApp.appVersion();
    for (const r of settingsEl.querySelectorAll('input[name=theme]')) r.checked = r.value === theme;
    for (const r of settingsEl.querySelectorAll('input[name=lang]')) r.checked = r.value === window.GAMJA_I18N.pref;
    for (const r of settingsEl.querySelectorAll('input[name=textSize]')) r.checked = Number(r.value) === gZoom();
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
    const limit = { '100k': 100000, '150k': 150000, '200k': 200000, '400k': 400000 }[d.settings.autocompact];
    $('ctxSize').textContent = d.context === null ? '아직 모름 (메시지를 보내면 표시돼요)'
      : d.context === 0 ? '방금 압축했어요'
        : `약 ${Math.round(d.context / 1000)}천 토큰${limit ? ` (압축 시점의 ${Math.min(100, Math.round(d.context / limit * 100))}%)` : ''}`;
    $('infoGamja').textContent = d.info.build ? `0.1.${d.info.build}` : `v${d.info.gamjaVersion} (개발용)`;
    // 자동 업데이트 스위치: 개발용 감자알(빌드 번호 없음)은 원래 자동 업데이트가 없어서 끈 채로 잠가 둔다
    const auto = $('autoUpdateToggle');
    auto.disabled = !d.info.build;
    auto.checked = !!d.info.build && d.settings.autoUpdate !== false;
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
    const ups = (d.info.updates || []).slice(0, 3); // 최근 3개만. 감자알이 이미 새것이 먼저 오게 보내 준다
    updateList = ups;
    $('updateHistory').innerHTML = ups.length
      ? ups.map((u, i) => `<button type="button" class="settings-row upd-row" data-upd="${i}"><span>${escapeHtml(u.version)}</span><b>${escapeHtml(new Date(u.ts).toLocaleString(LOCALE, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</b><i>›</i></button>`).join('')
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
    const group = gone ? null : roomGroup(project);
    const count = group ? group.length : 1;
    const canInvite = !gone && project.startsWith('@') && !!crewOf(project); // 크루가 있는 새 방에서만 (대화 중인 방도 된다. 그 크루가 방장)
    $('roomTitleH').textContent = T('room.title');
    // 대화 관리: 새 대화와 대화 압축은 ⋯ 메뉴가 아니라 여기서 한다
    $('roomManageH').textContent = T('room.manage');
    $('newBtn').textContent = T('room.new');
    $('roomNewNote').textContent = T('room.newNote');
    if (!busyOn('continueBtn')) $('continueBtn').textContent = T('room.continue');
    $('roomContinueNote').textContent = T('room.continueNote');
    if (!busyOn('exportBtn')) $('exportBtn').textContent = T('room.export'); // 짐 싸는 중에는 돌아가는 글을 그대로 둔다
    $('roomExportNote').textContent = T('room.exportNote');
    $('roomForm').innerHTML =
      `<h3>${escapeHtml(T('room.name'))}</h3><input id="roomName" maxlength="40" placeholder="${escapeHtml(p.text)}" value="${escapeHtml(getRoomTitles()[project] || '')}" autocomplete="off">` +
      `<p class="settings-note">${escapeHtml(T('room.nameNote'))}</p>` +
      `<label class="share-check"><input id="roomPin" type="checkbox"${getRoomPins()[project] ? ' checked' : ''}><span>${escapeHtml(T('room.pin'))}</span></label>` +
      `<h3>${escapeHtml(T('room.members'))} ${count}</h3><div class="fr-list">` +
      (gone
        ? `<button id="roomRestore" class="fr-row" type="button"><i class="fr-av">${escapeHtml(p.icon)}</i><span class="fr-mid"><b>${escapeHtml(p.text)}</b><small>${escapeHtml(blurb)}</small></span><span class="fr-pill">${escapeHtml(T('gone.restoreShort'))}</span></button>`
        : group
          ? group.map((m) => { // 그룹 방: "대화명 (크루 · 두뇌)", 방장은 👑
            const mp = crewParts(m.crew);
            return `<button class="fr-row" data-member="${escapeHtml(m.crew)}" data-gmember="${escapeHtml(m.id)}" type="button"><i class="fr-av">${escapeHtml(mp.icon)}</i><span class="fr-mid"><b>${m.leader ? '👑 ' : ''}${gbMarkOf(m.crew)}${escapeHtml(agentNick(m.crew, m))}</b><small>${escapeHtml(agentSub(m.crew, m))}</small><small class="nc-tag">${escapeHtml(m.leader ? T('group.leaderNote') : T('group.memberNote'))}</small></span><span>›</span></button>`;
          }).join('')
          : members.slice(0, 1).map((m) => { // 혼자 방: 누르면 대화명·두뇌·생각 깊이
            const mp = crewParts(m);
            return `<button class="fr-row" data-member="${escapeHtml(m)}" type="button"><i class="fr-av">${escapeHtml(mp.icon)}</i><span class="fr-mid"><b>${gbMarkOf(m)}${escapeHtml(agentNick(m, roomAgent))}</b><small>${escapeHtml(agentSub(m, roomAgent))}</small></span><span>›</span></button>`;
          }).join('')) +
      '</div>' +
      (gone || !GROUP_CHAT_ENABLED ? '' : canInvite && count < MAX_ROOM_MEMBERS
        ? `<button id="roomInvite" class="fr-join" type="button">${escapeHtml(T('room.invite'))}<span>›</span></button>`
        : `<button class="fr-join" type="button" disabled>${escapeHtml(T('room.invite'))}<span>${escapeHtml(T(canInvite ? 'room.inviteFull' : 'room.inviteFirst', { max: MAX_ROOM_MEMBERS }))}</span></button>`) +
      `<p class="settings-note">${escapeHtml(T(gone ? 'room.memberNoteGone' : group ? 'group.roomNote' : 'room.memberNote'))}</p>`;
    $('roomDeleteNote').textContent = T(gone ? 'room.deleteNoteGone' : 'room.deleteNote');
    $('roomDelete').textContent = T('room.delete');
    // 감자 톡톡(기본 대화방)은 지울 수 없다: 처음 접속한 이용자에게 늘 있어야 하는 방이라 삭제 버튼과 설명을 숨긴다 (대화만 지우려면 "대화 모두 지우기")
    const rootRoom = project === '';
    $('roomDelete').classList.toggle('hidden', rootRoom);
    $('roomDeleteNote').classList.toggle('hidden', rootRoom);
    // 보관: 목록에서만 빠지고 대화와 결과물은 그대로 (감자 톡톡과 옛 보관 방은 보관할 수 없다)
    $('roomArchive').textContent = T('room.archive');
    $('roomArchiveNote').textContent = T('room.archiveNote');
    $('roomArchive').classList.toggle('hidden', rootRoom || gone);
    $('roomArchiveNote').classList.toggle('hidden', rootRoom || gone);
    roomEl.classList.remove('hidden');
  }
  $('settingsBtn').onclick = openRoomSettings;
  // 채팅 탭의 ＋: "채팅방 만들기" 화면 (채팅방 이름 + 참여자 고르기). 같은 크루와도 일마다 대화를 따로 나눌 수 있다
  // 참여자를 둘 이상 고르면 그룹 채팅: 크루들이 차례로 자기 분야 의견을 낸다 (서버의 handleGroupChat)
  const MAX_ROOM_MEMBERS = 4; // 서버의 한도와 같게 둔다
  const ROOM_CREATE_ENABLED = true; // 크루 한 명의 새 채팅방은 열려 있다
  const NEWCHAT_MULTI = false; // 새 채팅은 크루 한 명으로 만든다. 그룹 방은 방 설정의 "참여자 초대"로 만든다 (처음 크루가 방장)
  const newChatEl = $('newChat');
  let ncMembers = []; // 고른 참여자(크루 이름)
  let ncName = ''; // 적어 둔 채팅방 이름
  function renderNewChat() {
    const T = window.GAMJA_I18N.t;
    if (!NEWCHAT_MULTI) return renderNcForm();
    const rows = ['', ...projectList].map((n) => {
      const { icon, text } = crewParts(n);
      const on = ncMembers.includes(n);
      return `<button class="fr-row${on ? ' sel' : ''}" data-pick="${escapeHtml(n)}" type="button"><i class="fr-av">${escapeHtml(icon)}</i>` +
        `<span class="fr-mid"><b>${gbMarkOf(n)}${escapeHtml(text)}</b><small>${escapeHtml(crewBlurb(n))}</small></span><span class="nc-check">${on ? '✓' : ''}</span></button>`;
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
      // 두뇌는 그 참여자(크루)의 것이라 참여자 카드 안에 붙여 보여 준다
      `</button><div class="nc-brain">` +
      brainChipsHtml(ncBrain, ncCodexOk, 'data-nc-brain') + `</div></div>` +
      `<p class="settings-note">${escapeHtml(T('agent.newNote'))}</p>` +
      `<p class="settings-note">${escapeHtml(T('newchat.pickNote'))}</p>`;
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
        `<span class="fr-mid"><b>${gbMarkOf(n)}${escapeHtml(text)}</b><small>${escapeHtml(crewBlurb(n))}</small></span><span class="nc-go">${isSel(n) ? '✓' : '›'}</span></button>`;
    };
    const list = (names) => `<div class="fr-list">${names.map(rowHtml).join('')}</div>`;
    const shelf = (agents) => '<div class="fr-shelf">' + agents.map((a) =>
      `<div class="fr-card"><i class="fr-av big">${escapeHtml(a.icon)}</i><b>${gbMark(a)}${escapeHtml(stripCrew(a.name))}</b>${gbNote(a)}<small>${escapeHtml(a.blurb)}</small>` +
      `<button class="fr-pill" data-pick-agent="${escapeHtml(a.id)}" type="button">${escapeHtml(T('newchat.choose'))}</button></div>`).join('') + '</div>';
    const rec = window.GAMJA_TEMPLATES.featuredFirst(AGENTS.filter((a) => !projectList.includes(a.folder)));
    const q = ncQuery.trim().toLowerCase();
    if (ncAll) { // 추천 크루 전체 보기: 묶음별로 모두 보여 준다 (고르면 크루 탭에 추가될 크루로 정해진다)
      const agentRow = (a) => `<button class="fr-row" data-pick-agent="${escapeHtml(a.id)}" type="button"><i class="fr-av">${escapeHtml(a.icon)}</i>` +
        `<span class="fr-mid"><b>${gbMark(a)}${escapeHtml(stripCrew(a.name))}</b><small>${escapeHtml(a.blurb)}</small></span><span class="nc-go">›</span></button>`;
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
      if (favs.length) html += `<div class="fr-sec"><span><i class="fr-star">${starSvg()}</i> ${escapeHtml(T('newchat.favs'))} ${favs.length}</span></div>${list(favs)}`;
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
  let ncBrain = 'claude', ncCodexOk = false; // 새 채팅방의 두뇌 (마지막으로 고른 두뇌를 미리 골라 둔다)
  function openNewChat(crew) { // crew: 크루 탭에서 "채팅하기"로 왔을 때 처음부터 참여자로 넣어 둘 크루
    const T = window.GAMJA_I18N.t;
    ncBrain = lastBrain();
    ncCodexOk = !!(brainInfo && brainInfo.codex && brainInfo.codex.ready);
    loadBrainInfo('').then((d) => { ncCodexOk = !!d.codex.ready; if (!ncCodexOk && ncBrain === 'codex') ncBrain = 'claude'; if (!newChatEl.classList.contains('hidden')) renderNcForm(); }).catch(() => {});
    ncMembers = [];
    ncSel = typeof crew === 'string' ? { kind: 'crew', name: crew } : null;
    ncName = '';
    $('newChatH').textContent = T(NEWCHAT_MULTI ? 'newchat.title' : 'newchat.titleOne');
    $('newChatNote').textContent = T(NEWCHAT_MULTI ? 'newchat.note' : 'newchat.noteOne');
    $('newChatGo').textContent = T(NEWCHAT_MULTI ? 'newchat.go' : 'newchat.start');
    $('importH').textContent = T('import.title');
    $('importNote').textContent = T('import.note');
    $('importBtn').textContent = T('import.btn');
    renderNewChat();
    newChatEl.classList.remove('hidden');
  }
  function defaultRoomTitle(crew) { // "크루이름(YYMMDDhhmm)"
    const d = new Date(), pad = (x) => String(x).padStart(2, '0');
    return `${crewParts(crew).text}(${pad(d.getFullYear() % 100)}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())})`;
  }
  async function startNewChat() {
    let crews = ncMembers.slice();
    if (!NEWCHAT_MULTI) {
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
    try { r = await api('/api/rooms', { crews, brain: ncBrain }); } catch (err) { return alert(err.message); }
    store.set('cc:lastBrain', ncBrain);
    window.gaTrack('new_chat', { kind: crews.length > 1 ? 'group' : 'crew' });
    if (r.room.startsWith('@')) rememberRoomCrew(r.room, crews.length === 1 ? crews[0] : '');
    const titles = getRoomTitles();
    // 이름을 안 적으면 같은 크루의 방끼리 구분되게 시각을 붙인다 (채팅방 설정에서 바꿀 수 있다)
    titles[r.room] = ncName.trim() || (crews.length > 1 ? crews.map((c) => crewParts(c).text).join(', ') : defaultRoomTitle(crews[0]));
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
    const nb = e.target.closest('[data-nc-brain]');
    if (nb) { if (!nb.disabled) { ncBrain = nb.dataset.ncBrain; renderNcForm(); } return; }
    if (!NEWCHAT_MULTI && e.target.closest('[data-nc-open]')) return openNcPick();
    const row = e.target.closest('[data-pick]');
    if (!row) return;
    const n = row.dataset.pick;
    if (ncMembers.includes(n)) ncMembers = ncMembers.filter((x) => x !== n);
    else ncMembers = [...ncMembers, n].slice(-MAX_ROOM_MEMBERS); // 한도를 넘으면 먼저 고른 쪽이 빠진다 (지금은 한 명이라 바꿔 고르기)
    renderNewChat();
  });
  // ---------- 🧠 채팅방 참여자: 크루(지침) + 두뇌(AI) + 생각 깊이 + 대화명 ----------
  // 크루는 지침만 갖는다. 두뇌는 방을 만들 때(또는 첫 메시지 전에) 고르고, 첫 메시지부터 그 방에서는 바뀌지 않는다
  // 표시: "대화명 (크루 · 두뇌)". 대화명이 없거나 크루 이름과 같으면 "크루 · 두뇌"
  function agentLabel(crew, agent) {
    const ct = crewParts(crew).text;
    const b = BRAIN_NAME[(agent && agent.brain) || lastBrain()];
    const nick = agent && agent.nick;
    return nick && nick !== ct ? `${nick} (${ct} · ${b})` : `${ct} · ${b}`;
  }
  // 목록·참여자 정보에서는 두 줄로 보여 준다: 첫 줄 대화명(없으면 크루 이름), 둘째 줄 "크루 이름 · 두뇌"
  const agentNick = (crew, agent) => (agent && agent.nick) || crewParts(crew).text;
  const agentSub = (crew, agent) => `${crewParts(crew).text} · ${BRAIN_NAME[(agent && agent.brain) || lastBrain()]}`;
  const effName = (e) => { const k = 'brain.eff.' + e, l = window.GAMJA_I18N.t(k); return l === k ? e : l; };
  async function loadBrainInfo(room, force) {
    if (!force && brainInfo && brainInfo.room === room && Date.now() - brainInfoAt < 30000) return brainInfo;
    const d = await api('/api/room-agent?room=' + encodeURIComponent(room));
    brainInfo = { ...d, room };
    brainInfoAt = Date.now();
    return brainInfo;
  }
  function brainChipsHtml(cur, codexOk, attr) {
    const T = window.GAMJA_I18N.t;
    return '<div class="brain-pick">' + ['claude', 'codex'].map((b) =>
      `<button type="button" class="brain-btn${b === cur ? ' on' : ''}" ${attr}="${b}"${(b === 'codex' && !codexOk && cur !== 'codex') || (b === 'claude' && claudeMissing() && cur !== 'claude') ? ' disabled' : ''}>${BRAIN_NAME[b]}</button>`).join('') + '</div>' +
      (codexOk ? '' : `<p class="settings-note">${escapeHtml(T('agent.codexOff'))}</p>`) +
      (claudeMissing() ? `<p class="settings-note">${escapeHtml(T('agent.claudeOff'))}</p>` : '');
  }
  // 대화를 시작하기 전의 방: 빈 화면에 두뇌 고르기를 보여 준다
  async function renderBrainPick() {
    const T = window.GAMJA_I18N.t;
    const box = document.getElementById('brainPickBox');
    if (!box) return;
    // 새 채팅 화면에서 두뇌를 고르고 만든 방(두뇌가 이미 적힌 방)은 다시 묻지 않는다. 첫 메시지 전에는 채팅방 설정 → 참여자에서 바꿀 수 있다
    if (roomAgent && (roomAgent.locked || roomAgent.brain)) { box.innerHTML = ''; return; }
    const room = project;
    let info;
    try { info = await loadBrainInfo(room); } catch { return; }
    if (room !== project || !document.getElementById('brainPickBox')) return;
    const cur = (roomAgent && roomAgent.brain) || lastBrain();
    document.getElementById('brainPickBox').innerHTML = `<p class="welcome-ask">${escapeHtml(T('agent.pickHead'))}</p>` + brainChipsHtml(cur, info.codex.ready, 'data-brain') +
      `<p class="settings-note">${escapeHtml(T('agent.pickNote'))}</p>`;
  }
  els.messages.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-brain]');
    if (!b || b.disabled) return;
    store.set('cc:lastBrain', b.dataset.brain);
    if (roomAgent) { // 이미 두뇌가 적힌 방(새 채팅 화면에서 만든 방)은 감자알에도 바꿔 둔다
      try { roomAgent = (await api('/api/room-agent', { room: project, brain: b.dataset.brain })).agent; } catch (err) { return alert(err.message); }
    }
    renderBrainPick();
  });
  // 이번 메시지와 함께 보낼 두뇌: 아직 고정되지 않은 방만 (감자알이 첫 메시지에서 고정한다)
  const brainForSend = () => (roomAgent && roomAgent.locked ? undefined : (roomAgent && roomAgent.brain) || lastBrain());

  // 참여자 정보: 대화명·두뇌·생각 깊이, 크루 설정 열기, (그룹 방에서) 방장 정하기·내보내기
  const memberEl = $('memberInfo');
  let memberTarget = ''; // 크루 이름
  let memberId = ''; // 그룹 방의 참여자 id (혼자 방은 '')
  const namesOf = (list) => Object.fromEntries(list.map((c) => [c, crewParts(c).text])); // 서버가 대화명·알림에 쓸 화면용 이름
  async function openMemberInfo(crew, gid) {
    const T = window.GAMJA_I18N.t;
    memberTarget = crew;
    memberId = gid || '';
    const p = crewParts(crew);
    let info;
    try {
      info = memberId ? await api(`/api/room-agent?room=${encodeURIComponent(project)}&member=${encodeURIComponent(memberId)}`) : await loadBrainInfo(project, true);
    } catch (err) { return alert(err.message); }
    if (memberId && !info.member) { memberEl.classList.add('hidden'); return refreshChats(); } // 그새 나간 참여자
    if (!memberId) roomAgent = info.agent;
    const ag = info.agent;
    const mem = info.member; // 그룹 방에서만
    const radio = (name, value, cur, label, sub) => `<label><input type="radio" name="${name}" value="${escapeHtml(value)}"${value === cur ? ' checked' : ''}> ${escapeHtml(label)} <span>${escapeHtml(sub)}</span></label>`;
    let h = `<div class="member-hero"><i class="fr-av">${escapeHtml(p.icon)}</i><h1 class="ui-title">${mem && mem.leader ? '👑 ' : ''}${escapeHtml(agentNick(crew, ag))}</h1><p class="member-sub">${escapeHtml(agentSub(crew, ag))}</p><p class="settings-note">${escapeHtml(mem ? T(mem.leader ? 'group.leaderNote' : 'group.memberNote') : crewBlurb(crew))}</p></div>`;
    const brain = (ag && ag.brain) || lastBrain();
    h += `<h3>${escapeHtml(T('agent.nick'))}</h3><input id="agNick" maxlength="30" placeholder="${escapeHtml(p.text.replace(/[\s@]/g, ''))}" value="${escapeHtml((ag && ag.nick) || '')}" autocomplete="off">` +
      `<p class="settings-note">${escapeHtml(T(mem ? 'group.nickNote' : 'agent.nickNote'))}</p>`;
    h += `<h3>${escapeHtml(T('agent.brainHead'))}</h3>`;
    let modelName;
    if (brain === 'codex') {
      const id = (ag && ag.model) || info.codex.model || (info.codex.defaults || {}).model || '';
      const m = (info.codex.models || []).find((x) => x.id === id);
      modelName = m ? m.name : id || T('agent.modelDefault');
    } else {
      const id = (ag && ag.model) || info.claude.model;
      modelName = id ? id.charAt(0).toUpperCase() + id.slice(1) : T('agent.modelDefault');
    }
    if (ag && ag.locked) h += `<p class="agent-brain"><b>${BRAIN_NAME[brain]}</b> · ${escapeHtml(modelName)}</p><p class="settings-note">${escapeHtml(T('agent.brainLocked'))}</p>`;
    else h += brainChipsHtml(brain, info.codex.ready, 'data-ag-brain') + `<p class="settings-note">${escapeHtml(T('agent.brainOpen'))}</p>`;
    // 생각 깊이 (대화 깊이): 언제든 바꿀 수 있다. 기본값은 더보기 › AI의 그 두뇌 설정
    let efforts, defEff;
    if (brain === 'codex') {
      const mid = (ag && ag.model) || info.codex.model || (info.codex.defaults || {}).model;
      const m = (info.codex.models || []).find((x) => x.id === mid);
      efforts = m ? m.efforts : [...new Set((info.codex.models || []).flatMap((x) => x.efforts))];
      defEff = info.codex.effort || (m && m.defEffort) || (info.codex.defaults || {}).effort || '';
    } else { efforts = info.claude.efforts; defEff = info.claude.effort; }
    const cur = (ag && ag.effort) || '';
    h += `<h3>${escapeHtml(T('agent.effort'))}</h3><div class="radio-list">` +
      radio('agEffort', '', cur, T('agent.effortDefault'), defEff ? effName(defEff) : T('agent.effortAuto')) +
      efforts.map((e) => radio('agEffort', e, cur, effName(e), e)).join('') + '</div>' +
      `<p class="settings-note">${escapeHtml(T('agent.effortNote'))}</p>`;
    if (mem && !mem.leader) {
      h += `<button id="memberLead" class="settings-ghost" type="button">👑 ${escapeHtml(T('group.makeLeader'))}</button>` +
        `<p class="settings-note">${escapeHtml(T('group.makeLeaderNote'))}</p>`;
    }
    // 크루 지침은 채팅방에서는 읽기만 한다 (고치는 곳은 크루 탭의 ⚙️ 크루 설정)
    h += `<h3>${escapeHtml(T('member.job'))}</h3><pre id="memberJob" class="crew-pre member-job">…</pre>` +
      `<p class="settings-note">${escapeHtml(T('member.jobNote'))}</p>`;
    if (mem) {
      h += `<p class="settings-note">${escapeHtml(T(mem.leader ? 'group.kickNoLeader' : 'member.kickNote'))}</p>` +
        `<button id="memberKick" class="settings-danger" type="button"${mem.leader ? ' disabled' : ''}>${escapeHtml(T('member.kick'))}</button>`;
    }
    $('memberBody').innerHTML = h;
    memberEl.classList.remove('hidden');
    api('/api/project-settings?project=' + encodeURIComponent(crew)).then((d) => {
      const el = document.getElementById('memberJob');
      if (el && memberTarget === crew) el.textContent = (d.instructions || '').trim() || T('member.jobEmpty');
    }).catch(() => { const el = document.getElementById('memberJob'); if (el) el.textContent = T('member.jobEmpty'); });
  }
  // 참여자 정보를 바꾸고 화면(참여자 정보·채팅방 설정·채팅 목록)을 새로 그린다
  async function saveAgent(change, reopen) {
    let r;
    try { r = await api('/api/room-agent', { room: project, ...(memberId ? { member: memberId, names: namesOf([memberTarget]) } : {}), ...change }); } catch (err) { alert(err.message); return openMemberInfo(memberTarget, memberId); }
    if (!memberId || (r.member && r.member.leader)) { roomAgent = memberId ? { ...(roomAgent || {}), ...r.agent } : r.agent; if (brainInfo) brainInfo.agent = roomAgent; }
    chatKey = '';
    toast(window.GAMJA_I18N.t('agent.saved'));
    if (reopen || memberId) openMemberInfo(memberTarget, memberId); // 그룹에서는 겹치는 대화명을 감자알이 고쳐 줄 수 있어서 다시 그린다
    else {
      $('memberBody').querySelector('.ui-title').textContent = agentNick(memberTarget, roomAgent);
      const sub = $('memberBody').querySelector('.member-sub');
      if (sub) sub.textContent = agentSub(memberTarget, roomAgent);
    }
    await refreshChats();
    if (!roomEl.classList.contains('hidden')) openRoomSettings();
    applyGone();
  }
  // 참여자 바꾸기(초대·내보내기·방장)를 마친 뒤: 목록·입력창 위 버튼·방에 남은 알림을 새로 그린다
  async function afterMembers() {
    chatKey = '';
    await refreshChats();
    updateHomeBtn();
    if (!roomEl.classList.contains('hidden')) openRoomSettings();
    loadConversation();
  }
  $('memberBack').onclick = () => memberEl.classList.add('hidden');
  memberEl.addEventListener('change', (e) => {
    if (e.target.id === 'agNick') return saveAgent({ nick: e.target.value });
    if (e.target.name === 'agEffort') return saveAgent({ effort: e.target.value });
  });
  memberEl.addEventListener('click', async (e) => {
    const T = window.GAMJA_I18N.t;
    const ab = e.target.closest('[data-ag-brain]');
    if (ab && !ab.disabled) { store.set('cc:lastBrain', ab.dataset.agBrain); return saveAgent({ brain: ab.dataset.agBrain }, true); }
    const name = (memberEl.querySelector('#agNick') || {}).value || crewParts(memberTarget).text;
    if (e.target.closest('#memberLead')) {
      if (runId || remoteRunId) return alert(T('group.busy'));
      if (!(await gSheet({ title: T('group.makeLeader'), message: T('group.makeLeaderConfirm', { name }), ok: T('group.makeLeader') }))) return;
      try { await api('/api/rooms/members', { room: project, leader: memberId, names: namesOf(roomMembers(project)) }); } catch (err) { return alert(err.message); }
      memberEl.classList.add('hidden');
      return afterMembers();
    }
    if (!e.target.closest('#memberKick') || e.target.closest('#memberKick').disabled) return;
    if (runId || remoteRunId) return alert(T('group.busy'));
    if (!(await gSheet({ title: T('member.kick'), message: T('member.kickConfirm', { name }), ok: T('member.kick'), danger: true }))) return;
    try { await api('/api/rooms/members', { room: project, remove: memberId, names: namesOf(roomMembers(project)) }); } catch (err) { return alert(err.message); }
    memberEl.classList.add('hidden');
    afterMembers();
  });
  // 참여자 초대: 크루 하나 + 두뇌를 골라 넣는다. 같은 크루를 다른 두뇌로 또 넣을 수도 있다. 처음 초대하면 이 방의 크루가 방장이 된다
  const inviteEl = $('invitePanel');
  let invPick = '';
  let invBrain = 'claude';
  let invCodex = false;
  function renderInvite() {
    const T = window.GAMJA_I18N.t;
    const g = roomGroup(project);
    const slots = MAX_ROOM_MEMBERS - (g ? g.length : 1);
    const list = projectList.filter((n) => !isGone(n));
    $('inviteList').innerHTML = (list.length ? list.map((n) => {
      const { icon, text } = crewParts(n);
      const on = invPick === n;
      // 크루는 한 줄로. 고른 크루 바로 아래에만 두뇌(Claude·Codex)를 펼쳐 고르게 한다 (선택을 빼면 다시 접힌다)
      return `<button class="fr-row inv-row${on ? ' sel' : ''}" data-ipick="${escapeHtml(n)}" type="button"><i class="fr-av">${escapeHtml(icon)}</i>` +
        `<span class="fr-mid"><b>${gbMarkOf(n)}${escapeHtml(text)}</b></span><span class="nc-check">${on ? '✓' : ''}</span></button>` +
        (on ? `<div class="nc-brain">${brainChipsHtml(invBrain, invCodex, 'data-ibrain')}</div>` : '');
    }).join('') : `<p class="settings-note">${escapeHtml(T('invite.none'))}</p>`);
    $('inviteNote').textContent = T(g ? 'invite.note' : 'invite.noteFirst', { slots });
    $('inviteGo').disabled = !invPick || slots < 1;
  }
  async function openInvite() {
    const T = window.GAMJA_I18N.t;
    invPick = '';
    invBrain = lastBrain();
    try { invCodex = !!(await loadBrainInfo(project)).codex.ready; } catch { invCodex = false; }
    $('inviteH').textContent = T('invite.title');
    $('inviteGo').textContent = T('invite.go');
    renderInvite();
    inviteEl.classList.remove('hidden');
  }
  $('inviteBack').onclick = () => inviteEl.classList.add('hidden');
  inviteEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ibrain]');
    if (b && !b.disabled) { invBrain = b.dataset.ibrain; return renderInvite(); }
    const row = e.target.closest('[data-ipick]');
    if (!row) return;
    invPick = invPick === row.dataset.ipick ? '' : row.dataset.ipick;
    if (invPick) invBrain = invCodex || claudeMissing() ? lastBrain() : 'claude'; // 크루를 고를 때마다 마지막에 쓴 두뇌를 미리 골라 둔다
    renderInvite();
  });
  $('inviteGo').onclick = async () => {
    if (!invPick) return;
    if (runId || remoteRunId) return alert(window.GAMJA_I18N.t('group.busy'));
    try { await api('/api/rooms/members', { room: project, add: { crew: invPick, brain: invBrain }, names: namesOf([...new Set([...roomMembers(project), invPick])]) }); } catch (err) { return alert(err.message); }
    inviteEl.classList.add('hidden');
    afterMembers(); // 방에 남은 "참여했어요" 알림도 보여 준다
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
    if (member) openMemberInfo(member.dataset.member, member.dataset.gmember); // 대화명·두뇌·생각 깊이 (그룹 방은 방장 정하기·내보내기도)
    if (e.target.closest('#roomInvite')) openInvite();
    if (e.target.closest('#roomRestore')) restoreGoneCrew();
  });
  $('roomArchive').onclick = async () => {
    const T = window.GAMJA_I18N.t;
    if (runId || remoteRunId) return alert(T('chat.eraseBusy'));
    const name = project;
    try { await api('/api/rooms/archive', { room: name, on: true }); } catch (err) { return alert(err.message); }
    project = ''; store.set('cc:project', ''); swapRoomInput(name, ''); updateHomeBtn(); // 보관한 방에서는 감자 톡톡으로 나간다
    chatKey = '';
    roomEl.classList.add('hidden');
    showTab('chat');
    toast(T('room.archived'));
  };
  $('roomDelete').onclick = async () => {
    const T = window.GAMJA_I18N.t;
    if (!(await gSheet({ title: T('room.deleteTitle'), message: T(isGone(project) ? 'room.deleteConfirmGone' : 'room.deleteConfirm', { name: roomText(project) }), ok: T('room.deleteOk'), danger: true }))) return;
    if (runId || remoteRunId) return alert(T('chat.eraseBusy'));
    const name = project;
    try {
      if (isGone(name)) {
        await api('/api/archive/delete', { id: name.slice(1) });
        navDeadRooms.add(name); forgetRoom(name);
        project = ''; store.set('cc:project', ''); swapRoomInput(name, ''); updateHomeBtn();
      } else await deleteRoomNow(name); // 대화와 결과물을 바로 지운다. 복구할 수 없다
    } catch (err) { return alert(err.message); }
    roomEl.classList.add('hidden');
    showTab('chat');
  };
  const UPDATE_BTN_COOLDOWN = 1000; // 버전 옆 🔄 버튼을 누른 뒤 다시 누를 수 있기까지 (밀리초)

  // 저장된 Claude 계정 목록: 누르면 그 계정으로 바꾼다
  let acctDelMode = false, acctCache = [], acctUsage = {};
  // 오른쪽 사용량: D = 5시간 한도(사용률 · 초기화 시각), W = 주간 한도(사용률 · 초기화 날짜와 시각)
  function acctUsageLine(label, u, withDate) {
    if (!u) return '';
    const d = new Date(u.resetsAt), p2 = (n) => String(n).padStart(2, '0');
    const when = isNaN(d) ? '' : (withDate ? `${d.getMonth() + 1}/${d.getDate()} ` : '') + `${p2(d.getHours())}:${p2(d.getMinutes())}`;
    return `${label} ${u.pct}%${when ? ' ' + when : ''}`;
  }
  function renderAccounts(list) {
    acctCache = list || acctCache;
    const box = $('acctList');
    box.textContent = '';
    for (const a of acctCache) {
      const row = document.createElement('div');
      row.className = 'set-row' + (a.active ? ' on' : '');
      const info = document.createElement('span');
      const name = document.createElement('b');
      name.textContent = a.email + (a.plan ? ' · ' + a.plan : '');
      const sub = document.createElement('small');
      sub.textContent = a.active ? '✅ 사용 중' : (acctDelMode ? '🗑 눌러서 지우기' : '눌러서 이 계정으로 전환');
      info.append(name, sub);
      info.className = 'acct-info';
      row.append(info);
      const u = acctUsage[a.id];
      if (u && (u.d || u.w)) {
        const t = window.GAMJA_I18N.t, use = document.createElement('span');
        use.className = 'acct-usage';
        for (const line of [acctUsageLine(t('acct.usage.d'), u.d, false), acctUsageLine(t('acct.usage.w'), u.w, true)]) {
          if (!line) continue;
          const el = document.createElement('small'); el.textContent = line; use.append(el);
        }
        row.append(use);
      }
      if (!a.active) {
        row.style.cursor = 'pointer';
        row.onclick = async () => {
          try {
            if (acctDelMode) {
              if (!confirm(a.email + ' 계정을 목록에서 지울까요?')) return;
              renderAccounts((await api('/api/auth/claude/accounts', { action: 'remove', id: a.id })).accounts);
            } else {
              renderAccounts((await api('/api/auth/claude/accounts', { action: 'switch', id: a.id })).accounts);
              toast('계정을 바꿨어요');
            }
          } catch (err) { toast(err.message); }
        };
      }
      box.append(row);
    }
  }
  // Codex 계정 설정: 설치 → 로그인(기기 코드: 주소와 코드를 보여 주고 사용자가 브라우저에서 넣는다) → 연결됨
  let cxTimer = null, cxSt = null, cxWasIn = null, cxBusyWas = false;
  function cxBtn(text, onclick, cls) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = onclick; if (cls) b.className = cls; return b;
  }
  async function cxCall(action, extra = {}) {
    let ok = true;
    try { cxSt = await api('/api/auth/codex', { action, ...extra }); } catch (err) { ok = false; toast(err.message); }
    renderCodex();
    return ok;
  }
  // 저장된 Codex 계정 목록 (Claude 계정 목록과 같은 모양): 누르면 그 계정으로 바뀌고, 삭제 모드에서는 지운다
  let cxDelMode = false, cxUsage = {};
  function renderCodexAccounts() {
    const t = window.GAMJA_I18N.t, list = $('cxAcctList');
    list.textContent = '';
    for (const a of (cxSt && cxSt.accounts) || []) {
      const row = document.createElement('div');
      row.className = 'set-row' + (a.active ? ' on' : '');
      const info = document.createElement('span'), name = document.createElement('b'), sub = document.createElement('small');
      name.textContent = a.email + (a.plan ? ' · ' + a.plan : '');
      sub.textContent = a.active ? t('cx.acct.active') : (cxDelMode ? t('cx.acct.tapDel') : t('cx.acct.tapSwitch'));
      info.append(name, sub); info.className = 'acct-info'; row.append(info);
      const u = cxUsage[a.id];
      if (u && (u.d || u.w)) {
        const use = document.createElement('span'); use.className = 'acct-usage';
        for (const line of [acctUsageLine(t('acct.usage.d'), u.d, false), acctUsageLine(t('acct.usage.w'), u.w, true)]) {
          if (!line) continue;
          const el = document.createElement('small'); el.textContent = line; use.append(el);
        }
        row.append(use);
      }
      if (!a.active) {
        row.style.cursor = 'pointer';
        row.onclick = async () => {
          if (cxDelMode) {
            if (!(await gSheet({ title: t('cx.del.title'), message: t('cx.del.confirm', { name: a.email }), ok: t('cx.del.ok'), danger: true }))) return;
            await cxCall('remove', { id: a.id });
          } else if (await cxCall('switch', { id: a.id })) { toast(t('cx.switched')); refreshAi(); }
        };
      }
      list.append(row);
    }
  }
  async function loadCodexUsage() {
    try { cxUsage = (await api('/api/auth/codex', { action: 'usage' })).usage || {}; renderCodexAccounts(); } catch {}
  }
  function setRowText(id, title, sub) { const b = $(id); b.querySelector('b').textContent = title; b.querySelector('small').textContent = sub; }
  $('cxAdd').onclick = () => cxCall('login');
  $('cxRelogin').onclick = () => cxCall('login');
  $('cxDelToggle').onclick = () => { cxDelMode = !cxDelMode; renderCodex(); };
  function renderCodex() {
    const t = window.GAMJA_I18N.t, st = cxSt, box = $('cxBox');
    $('cxHead').textContent = t('cx.head');
    $('cxHint').textContent = cxDelMode ? t('cx.hint.del') : t('cx.hint');
    $('cxMgmtHead').textContent = t('cx.mgmt'); $('cxTroubleHead').textContent = t('cx.trouble');
    setRowText('cxAdd', t('cx.add'), t('cx.add.sub'));
    setRowText('cxDelToggle', cxDelMode ? t('cx.del.end') : t('cx.del'), t('cx.del.sub'));
    setRowText('cxRelogin', t('cx.relogin'), t('cx.relogin.sub'));
    box.textContent = '';
    $('cxMain').classList.toggle('hidden', !st || !st.installed || !(st.accounts || []).length);
    if (!st) return;
    renderCodexAccounts();
    const wasIn = cxWasIn;
    if (wasIn === false && st.loggedIn) { toast(t('cx.done')); refreshAi(); }
    if (wasIn === true && !st.loggedIn) refreshAi();
    cxWasIn = st.loggedIn;
    const card = (title, body) => {
      const c = document.createElement('div'); c.className = 'ai-connect cx-card';
      if (title) { const b = document.createElement('b'); b.textContent = title; c.append(b); }
      if (body) { const m = document.createElement('small'); m.textContent = body; c.append(m); }
      box.append(c); return c;
    };
    const l = st.login;
    const busyLogin = l && (l.stage === 'STARTING' || l.stage === 'CODE' || l.stage === 'ERROR');
    if (st.loggedIn && !busyLogin) {
      // 연결돼 있으면 위의 목록·계정 관리만 보여 준다 (Claude 계정 설정과 같은 모양)
    } else if (st.installing) {
      card(t('cx.install.title'), t('cx.installing')).append(Object.assign(document.createElement('code'), { className: 'cx-log', textContent: (st.log || []).slice(-1)[0] || '' }));
    } else if (!st.installed) {
      card(t('cx.install.title'), st.installError || t('cx.install.body')).append(cxBtn(t('cx.install.btn'), () => cxCall('install')));
    } else if (l && l.stage === 'STARTING') {
      card(t('cx.login.title'), t('cx.starting'));
    } else if (l && l.stage === 'CODE') {
      const c = card(t('cx.login.title'), '');
      const s1 = document.createElement('small'); s1.textContent = t('cx.step1'); c.append(s1, cxBtn(t('cx.open'), () => window.open(l.url, '_blank', 'noopener')));
      const s2 = document.createElement('small'); s2.textContent = t('cx.step2');
      const code = document.createElement('div'); code.className = 'cx-code'; code.textContent = l.code;
      c.append(s2, code, cxBtn(t('cx.copy'), async () => {
        try { await navigator.clipboard.writeText(l.code); toast(t('cx.copied')); } catch { gCopy(t('cx.copy'), l.code); }
      }, 'cx-sub'));
      const left = Math.max(0, Math.round((l.expiresAt - Date.now()) / 1000));
      const lt = document.createElement('small'); lt.textContent = t('cx.left', { t: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` });
      c.append(lt, cxBtn(t('cx.cancel'), () => cxCall('stop'), 'cx-sub'));
    } else {
      const c = card(t('cx.login.title'), l && l.stage === 'ERROR' ? l.error : t('cx.login.body'));
      c.append(cxBtn(l && l.stage === 'ERROR' ? t('cx.retry') : t('cx.login.btn'), () => cxCall('login')));
      if (st.loggedIn) c.append(cxBtn(t('cx.cancel'), () => cxCall('stop'), 'cx-sub')); // 계정 추가·다시 로그인이 안 됐을 때: 지금 계정은 그대로
    }
    clearTimeout(cxTimer);
    const busy = st.installing || (l && (l.stage === 'STARTING' || l.stage === 'CODE'));
    if (cxBusyWas && !busy && l && l.stage === 'SUCCESS') { if (wasIn) toast(t('cx.done')); loadCodexUsage(); refreshAi(); }
    cxBusyWas = !!busy;
    if (busy && settingsPage === 'codex-account') cxTimer = setTimeout(() => cxCall('status'), 1500);
  }
  // 더보기 › AI › Codex 대화 설정: 기본값이 실제로 무엇인지(Codex 자체 설정에서 읽은 값)를 같이 보여 준다
  let cxBrain = null;
  async function loadCxBrain(save) {
    try { cxBrain = await api('/api/codex/settings' + q(), save || undefined); } catch (err) { if (save) toast(err.message); }
    renderCxBrain();
  }
  function renderCxBrain() {
    const T = window.GAMJA_I18N.t, d = cxBrain, box = $('cxBrainBox');
    if (!d) { box.innerHTML = ''; return; }
    const radio = (name, value, cur, label, sub) => `<label><input type="radio" name="${name}" value="${escapeHtml(value)}"${value === cur ? ' checked' : ''}> ${escapeHtml(label)} <span>${escapeHtml(sub)}</span></label>`;
    const effName = (e) => { const k = 'brain.eff.' + e, l = T(k); return l === k ? e : l; };
    const df = d.defaults || {}, models = d.models || [];
    const mName = (id) => (models.find((m) => m.id === id) || {}).name || id;
    const curModel = d.cxModel || df.model;
    const m = models.find((x) => x.id === curModel);
    const curEffort = d.cxEffort && (!m || !m.efforts.length || m.efforts.includes(d.cxEffort)) ? d.cxEffort : (d.cxModel ? (m && m.defEffort) || '' : df.effort);
    const src = (yes) => T(yes ? 'cxb.fromConfig' : 'cxb.fromCodex');
    let h = `<h3>${escapeHtml(T('cxb.model'))}</h3>`
      + `<p class="settings-note">${escapeHtml(T('cxb.using'))} <b>${escapeHtml(curModel ? mName(curModel) : '-')}</b>${curEffort ? ` · ${escapeHtml(effName(curEffort))}` : ''}</p><div class="radio-list">`
      + radio('cxbModel', '', d.cxModel, T('brain.cxDefault'), df.model ? `${mName(df.model)} · ${src(df.fromConfig && df.fromConfig.model)}` : T('cxb.codexDefault'))
      + models.map((x) => radio('cxbModel', x.id, d.cxModel, x.name, x.desc)).join('') + '</div>';
    const efforts = m ? m.efforts : [...new Set(models.flatMap((x) => x.efforts))];
    const defEff = d.cxModel ? (m && m.defEffort) || '' : df.effort;
    h += `<h3>${escapeHtml(T('cxb.effort'))}</h3><p class="settings-note">${escapeHtml(T('cxb.effortNote'))}</p><div class="radio-list">`
      + radio('cxbEffort', '', d.cxEffort, T('brain.cxDefault'), defEff ? `${effName(defEff)} · ${d.cxModel ? T('cxb.fromModel') : src(df.fromConfig && df.fromConfig.effort)}` : T('cxb.codexDefault'))
      + efforts.map((e) => radio('cxbEffort', e, d.cxEffort, effName(e), e)).join('') + '</div>';
    const c = d.context;
    const limit = { '100k': 100000, '150k': 150000, '200k': 200000, '400k': 400000 }[d.cxCompact];
    const ctx = !d.codexRoom ? T('cxb.ctxNotCodex') : !c ? T('cxb.ctxUnknown')
      : T('cxb.ctxSize', { k: Math.round(c.tokens / 1000) }) + (limit ? T('cxb.ctxPct', { p: Math.min(100, Math.round(c.tokens / limit * 100)) }) : c.window ? T('cxb.ctxWin', { p: Math.min(100, Math.round(c.tokens / c.window * 100)) }) : '');
    h += `<h3>${escapeHtml(T('cxb.compact'))}</h3><p class="settings-row"><span>${escapeHtml(T('cxb.ctxNow'))}</span><b>${escapeHtml(ctx)}</b></p>`
      + `<p class="settings-note">${escapeHtml(T('cxb.compactNote'))}</p><div class="radio-list">`
      + ['200k', '150k', '100k', '400k', ''].map((v) => radio('cxbCompact', v, d.cxCompact, T('cxb.cp.' + (v || 'def')), T('cxb.cp.' + (v || 'def') + '.sub'))).join('') + '</div>';
    h += `<p class="settings-note">${escapeHtml(T('cxb.foot'))}</p>`;
    box.innerHTML = h;
  }
  $('cxBrainBox').addEventListener('change', (e) => {
    const r = e.target;
    if (!cxBrain || !r || r.type !== 'radio') return;
    const next = { cxModel: cxBrain.cxModel, cxEffort: cxBrain.cxEffort, cxCompact: cxBrain.cxCompact };
    if (r.name === 'cxbModel') {
      next.cxModel = r.value;
      const m = (cxBrain.models || []).find((x) => x.id === (r.value || (cxBrain.defaults || {}).model));
      if (m && next.cxEffort && !m.efforts.includes(next.cxEffort)) next.cxEffort = ''; // 새 모델이 못 쓰는 생각 깊이는 기본으로
    } else if (r.name === 'cxbEffort') next.cxEffort = r.value;
    else if (r.name === 'cxbCompact') next.cxCompact = r.value;
    else return;
    loadCxBrain(next);
  });
  async function loadAccounts() {
    try { renderAccounts((await api('/api/auth/claude/accounts', { action: 'list' })).accounts); } catch {}
    try { acctUsage = (await api('/api/auth/claude/accounts', { action: 'usage' })).usage || {}; renderAccounts(); } catch {}
  }
  // Claude 로그인 (웹에서도 된다): 감자알이 로그인 명령을 대신 실행하고, 사용자는 주소를 열어 로그인한 뒤 코드를 붙여넣는다
  // 로그인 화면: 감자 앱의 로그인 화면과 같은 단계 안내 (공식 Claude Code 화면을 아래에 그대로 보여 준다)
  let loTimer = null, loStage = '', loUrl = '', loOpened = false, loLast = null;
  const LO_GUIDE = {
    STARTING: ['준비 중', 'Claude Code를 여는 중...', '잠시만 기다려 주세요. 아래 검은 화면이 Claude 공식 화면이에요.'],
    TRUST: ['준비 중', '폴더 믿기', '아래 검은 화면에 이 폴더를 믿을지 묻고 있어요. "Yes, I trust this folder"가 골라져 있는지 보고 버튼을 눌러 넘어가세요.', '다음'],
    THEME: ['로그인 1/4', '화면 스타일 고르기', '아래 검은 화면에 글자 스타일(테마)을 고르는 목록이 보여요. 어느 것이든 괜찮아요. 그대로 두고 아래 버튼을 눌러 넘어가세요.', '다음'],
    METHOD: ['로그인 2/4', '로그인 방법 고르기', "아래 검은 화면의 목록에서 'Claude account with subscription'(Claude 구독 계정) 줄 앞에 ❯ 표시가 있는지 보세요. 다른 줄에 있으면 키 줄의 ↑ ↓ 로 옮긴 뒤 버튼을 누르세요.", '구독 계정으로 로그인'],
    BROWSER: ['로그인 3/4', '브라우저에서 로그인', '버튼을 눌러 Claude 공식 페이지에서 로그인하세요. 끝나면 코드가 나와요. 그 코드를 복사하고 이 화면으로 돌아오세요.', '브라우저에서 로그인'],
    PASTE: ['로그인 4/4', '코드 붙여넣기', '브라우저에서 받은 코드를 복사해 아래 칸에 붙여넣고 "코드 붙여넣고 완료하기"를 누르세요. 로그인 페이지를 다시 열려면 위 버튼을 누르세요.', '로그인 페이지 다시 열기'],
    SUCCESS: ['완료', '로그인 완료!', '계정 설정으로 돌아가요...'],
    READY: ['완료', '이미 로그인돼 있어요', '다른 계정으로 바꾸려면 계정 설정에서 "계정 추가"를 누르세요.', '완료'],
  };
  function loRender(st) {
    // 브라우저 단계: 로그인 페이지를 연 뒤에는 '코드 붙여넣기' 단계로 보여 준다. 짧은 흐름(바로 브라우저부터)은 1/2 → 2/2
    const web = st.stage === 'CODE' || st.stage === 'BROWSER';
    const g = LO_GUIDE[web ? (loOpened ? 'PASTE' : 'BROWSER') : st.stage] || LO_GUIDE.STARTING;
    const step = web && st.flow === 'short' ? (loOpened ? '로그인 2/2' : '로그인 1/2') : g[0];
    $('loStep').textContent = step; $('loTitle').textContent = g[1]; $('loText').textContent = g[2];
    const btn = $('loBtn');
    btn.classList.toggle('hidden', !g[3]);
    btn.textContent = g[3] || '';
    loUrl = st.url || loUrl;
    $('loCodeRow').classList.toggle('hidden', st.stage !== 'CODE' && st.stage !== 'BROWSER');
    const term = $('loTerm'), atEnd = term.scrollTop + term.clientHeight >= term.scrollHeight - 30;
    term.textContent = st.screen || '';
    if (atEnd) term.scrollTop = term.scrollHeight;
    loStage = st.stage; loLast = st;
  }
  async function loPoll() {
    try {
      const st = await api('/api/auth/claude/cli', { action: 'poll' });
      loRender(st);
      if (st.stage === 'SUCCESS') { loClose(true); return; }
    } catch {}
    loTimer = setTimeout(loPoll, 800);
  }
  async function loClose(done) {
    clearTimeout(loTimer);
    $('loginOv').classList.add('hidden');
    try { await api('/api/auth/claude/cli', { action: 'stop' }); } catch {}
    const wasOff = aiState && !aiState.claude;
    if (done) {
      toast(wasOff ? window.GAMJA_I18N.t('ai.claude.done') : '로그인됐어요');
    }
    loadAccounts();
    await refreshAi(); // 연결 상태를 다시 받아 안내를 걷어 낸다
    if (done && wasOff && /^claude-/.test(settingsPage || '')) showSettingsPage('ai'); // 처음 연결했으면 AI 화면으로 돌아가 "연결됨"을 보여 준다
  }
  const loKey = (k, text, submit) => api('/api/auth/claude/cli', { action: 'key', k, text, submit }).catch(() => {});
  async function startLogin() {
    acctDelMode = false; renderAccounts();
    loStage = ''; loUrl = ''; loOpened = false;
    $('loCode').value = '';
    $('loTerm').textContent = '';
    loRender({ stage: 'STARTING' });
    $('loginOv').classList.remove('hidden');
    try { loRender(await api('/api/auth/claude/cli', { action: 'start', relogin: true })); }
    catch (err) { toast(err.message); $('loginOv').classList.add('hidden'); return; }
    clearTimeout(loTimer); loTimer = setTimeout(loPoll, 800);
  }
  $('loExit').onclick = () => loClose(false);
  $('loBtn').onclick = () => {
    if (loStage === 'READY') return loClose(false);
    if (loStage === 'BROWSER' || loStage === 'CODE') {
      if (!loUrl) return toast('아직 화면에 로그인 주소가 없어요');
      window.open(loUrl, '_blank', 'noopener');
      if (!loOpened) { loOpened = true; if (loLast) loRender(loLast); } // 바로 2단계 안내로 바꾼다
      return;
    }
    loKey('enter');
  };
  $('loginOv').querySelectorAll('.lo-keys [data-k]').forEach((b) => { b.onclick = () => loKey(b.dataset.k); });
  async function loPasteText() {
    try { const t = (await navigator.clipboard.readText()).trim(); if (t) { $('loCode').value = t; return t; } } catch {}
    return $('loCode').value.trim();
  }
  $('loPaste').onclick = async () => { const t = await loPasteText(); if (t) loKey('text', t, false); else toast('복사한 글이 없어요. 코드 칸에 직접 붙여넣어 주세요'); };
  $('loCodeBtn').onclick = async () => {
    const t = $('loCode').value.trim() || await loPasteText();
    if (!t) return toast('코드를 붙여넣어 주세요');
    loKey('text', t, true);
    $('loTitle').textContent = '로그인 확인 중...';
  };
  $('appLogin').onclick = () => startLogin();
  $('acctAdd').onclick = () => startLogin();
  $('acctDelToggle').onclick = () => {
    acctDelMode = !acctDelMode;
    $('acctDelToggle').querySelector('b').textContent = acctDelMode ? '삭제 끝내기' : '계정 삭제';
    $('acctHint').textContent = acctDelMode ? 'ⓘ 지울 계정을 누르세요. 지금 쓰는 계정은 지울 수 없어요.' : 'ⓘ 계정을 누르면 그 계정으로 바뀌어요. 대화 기록과 기억은 그대로예요.';
    renderAccounts();
  };
  // 감자 앱 기능 (앱 안에서만): 앱이 안드로이드 화면을 띄워 준다
  for (const [id, fn] of [['appUpdate', 'checkUpdate'],
    ['appBattery', 'batterySettings'], ['appLicense', 'showLicenses']]) {
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
    if (closeOverlay()) return true;
    // 탭 화면: 더보기 하위 화면 → 더보기 목록 → 채팅 목록. 채팅방 → 채팅 목록. 채팅 목록에서는 앱이 알아서 처리(나가기)
    if (tab === 'more') {
      if ($('setList').classList.contains('hidden')) showSettingsPage(SET_PARENT[settingsPage] || null); else showTab('chat');
      return true;
    }
    if (tab === 'crew') { showTab('chat'); return true; }
    if (tab === null) { showTab('chat'); return true; }
    return false;
  };
  // 화면 위에 잠깐 떠 있는 창(사진·시트·패널·메뉴)을 맨 위 것 하나만 닫는다 (닫았으면 true)
  function closeOverlay() {
    if (photoOpen()) { closePhoto(); return true; } // 사진 크게 보기가 맨 위에 뜬다
    if (gsOpen) { gsOpen.close(false); return true; } // 확인 시트가 열려 있으면 그것부터 닫는다
    if (!groupSheetEl.classList.contains('hidden')) { closeGroupSheet(); return true; }
    if (!sheetEl.classList.contains('hidden')) { closeSheet(); return true; }
    for (const [panel, back] of [['viewPanel', 'viewBack'], ['sharePanel', 'shareBack'], ['ghPanel', 'ghBack'], ['ncPick', 'ncPickBack'], ['installPanel', 'installBack'], ['trashPanel', 'trashBack'], ['rtrashPanel', 'rtrashBack'], ['invitePanel', 'inviteBack'], ['newChat', 'newChatBack'], ['projSettings', 'projBack'], ['memberInfo', 'memberBack'], ['roomSettings', 'roomBack'], ['tunnelPanel', 'tunnelBack'],
      ['agentPicker', 'agentBack'], ['madePanel', 'madeBack']]) {
      if (!$(panel).classList.contains('hidden')) { $(back).click(); return true; }
    }
    if (!els.menu.classList.contains('hidden')) { els.menu.classList.add('hidden'); return true; }
    return false;
  }
  // ---------- 브라우저의 뒤로·앞으로 가기 ----------
  // 화면(탭·채팅방·더보기 하위 화면)이 바뀔 때마다 브라우저 기록에 한 칸씩 남기고, 뒤로·앞으로 가면 그 화면을 다시 띄운다.
  // 잠깐 뜨는 창(사진·시트·패널·메뉴)은 기록하지 않는다: 뒤로 가기를 누르면 그 창만 닫힌다.
  // 맨 처음 칸 아래에 "지킴이" 칸을 하나 두어, 첫 화면에서 뒤로 가면 채팅 목록으로 → 거기서 2초 안에 두 번 누르면 나간다.
  // (주의: 이 안에서 history는 대화 기록 배열이라 브라우저 기록은 window.history로 쓴다)
  const BH = window.history;
  let navStack = []; // 브라우저 기록 칸마다의 화면 열쇠 (안쪽 ← 버튼이 "뒤로 가기"로 돌아갈 수 있는지 볼 때 쓴다)
  let navIdx = 0;
  let navRestoring = false; // 뒤로·앞으로 가기로 화면을 되돌리는 중 (이때는 새 칸을 만들지 않는다)
  let navQueued = false;
  let backArmed = 0;
  const navDeadRooms = new Set(); // 이 화면에서 삭제한 채팅방 (뒤로·앞으로 가기로 다시 열지 않는다)
  const navKey = (scr) => JSON.stringify(scr);
  function navScreen() {
    if (tab === null) return { t: 'room', p: project };
    if (tab === 'more') return { t: 'more', s: !moreLoading && $('setList').classList.contains('hidden') ? settingsPage : null };
    return { t: tab };
  }
  function navSave() { try { sessionStorage.setItem('cc:nav', JSON.stringify(navStack)); } catch {} }
  // 화면을 바꾸는 함수들이 부른다. 바꾸기가 다 끝난 뒤(같은 차례의 끝)에 한 번만 기록한다
  function navNote() {
    if (navQueued) return;
    navQueued = true;
    queueMicrotask(() => {
      navQueued = false;
      if (els.app.classList.contains('hidden')) return; // 로그인 전
      const key = navKey(navScreen());
      const st = BH.state;
      if (st && st.gamja === 2 && st.k === key) { navRestoring = false; return; }
      if (navRestoring) { // 되돌린 화면이 기록과 다르면(지워진 방 등) 그 칸을 지금 화면으로 고친다
        navRestoring = false;
        try { BH.replaceState({ gamja: 2, k: key, i: navIdx }, ''); } catch {}
        navStack[navIdx] = key;
      } else {
        navIdx += 1;
        navStack.length = navIdx;
        navStack.push(key);
        try { BH.pushState({ gamja: 2, k: key, i: navIdx }, ''); } catch {}
      }
      navSave();
    });
  }
  // 안쪽 ← 버튼: 바로 앞 칸이 가려는 화면이면 브라우저 뒤로 가기로 간다 (기록이 앞뒤로 꼬이지 않게)
  function navBackTo(scr) {
    if (navIdx > 0 && navStack[navIdx - 1] === navKey(scr)) { BH.back(); return true; }
    return false;
  }
  (function navInit() {
    const st = BH.state;
    if (st && st.gamja === 2) { // 새로고침: 있던 기록을 이어 쓴다
      navIdx = st.i || 0;
      try { navStack = JSON.parse(sessionStorage.getItem('cc:nav')) || []; } catch { navStack = []; }
      if (!st.guard) navRestoring = true; // 첫 화면은 이 칸에 그대로 맞춘다
      return;
    }
    navIdx = 0;
    navStack = ['guard'];
    try { BH.replaceState({ gamja: 2, guard: 1, i: 0 }, ''); } catch {}
    navSave();
  })();
  window.addEventListener('popstate', (e) => {
    const st = e.state;
    if (!st || st.gamja !== 2) return;
    const fromIdx = navIdx;
    navIdx = st.i || 0;
    // 떠 있는 창이 있으면 그것만 닫고, 보던 화면을 다시 기록해 둔다
    if (closeOverlay()) { navNote(); return; }
    if (st.guard) { // 첫 화면에서 뒤로: 채팅 목록으로, 채팅 목록이면 두 번 눌러 나가기
      if (tab !== 'chat') { showTab('chat'); return; }
      if (Date.now() - backArmed < 2000) { BH.back(); return; }
      backArmed = Date.now();
      toast(window.GAMJA_I18N.t('back.exitHint'));
      navNote();
      return;
    }
    backArmed = 0;
    let scr;
    try { scr = JSON.parse(st.k); } catch { return; }
    if (navKey(navScreen()) === st.k) return;
    // 그 사이 삭제한 채팅방 칸은 건너뛴다 (되돌리면 빈 방이 다시 만들어진다)
    if (scr.t === 'room' && navDeadRooms.has(scr.p)) { if (navIdx < fromIdx) BH.back(); else BH.forward(); return; }
    navRestoring = true;
    if (scr.t === 'room') {
      if (scr.p === '' || projectList.includes(scr.p)) selectProject(scr.p); else showTab('chat');
    } else if (scr.t === 'more') {
      if (tab === 'more' && !moreLoading) showSettingsPage(scr.s || null);
      else {
        showTab('more');
        if (scr.s) Promise.resolve(settingsReady).then(() => { if (tab === 'more') { navRestoring = true; showSettingsPage(scr.s); } });
      }
    } else showTab(['crew', 'chat'].includes(scr.t) ? scr.t : 'chat');
    navNote();
  });
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
    try { await api('/api/tools/install', { kit: b.dataset.kit }); window.gaTrack('tool_install', { kit: b.dataset.kit }); toast(window.GAMJA_I18N.t('tools.started')); }
    catch (err) { toast(err.message); }
    renderTools();
  });
  let settingsPage = null;
  const SET_PARENT = { perm: 'ai', 'claude-account': 'ai', 'claude-brain': 'ai', 'codex-account': 'ai', 'codex-brain': 'ai' }; // 뒤로 가기는 한 단계씩
  function showSettingsPage(page) {
    if (page === 'claude' || page === 'codex') page = 'ai'; // 예전 화면(AI → Claude/Codex)은 AI 화면으로 합쳤다. 감자 앱 링크·뒤로 가기 기록 호환
    navNote();
    settingsPage = page;
    if (page === 'tools') renderTools();
    if (page === 'perm') renderPerm();
    if (page === 'codex-account') { cxDelMode = false; renderCodex(); cxCall('status').then(loadCodexUsage); } else clearTimeout(cxTimer);
    if (page === 'codex-brain') loadCxBrain();
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
  for (const id of ['page-ai']) $(id).addEventListener('click', (e) => { // AI 모델 안의 하위 화면 이동
    const b = e.target.closest('.set-row[data-page]');
    if (b) showSettingsPage(b.dataset.page);
  });
  $('settingsBack').onclick = () => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); // 쓰던 글칸이 있으면 먼저 저장되게
    if ($('setList').classList.contains('hidden')) {
      const up = SET_PARENT[settingsPage] || null;
      if (!navBackTo({ t: 'more', s: up })) showSettingsPage(up);
    } else if (!navBackTo({ t: 'chat' })) showTab('chat');
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
      store.set('cc:zoom', snapZoom(Number(r.value))); // 더보기의 값은 앱 기본값. 방에서 따로 정한 방은 그 방의 값이 우선한다
      applyPrefs();
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

  // 새 채팅으로 이어가기: 서버가 대화를 요약하고 결과물을 복사한 새 방을 만들면, 그 방을 연다
  $('continueBtn').onclick = async () => {
    const T = window.GAMJA_I18N.t;
    els.menu.classList.add('hidden');
    if (runId || remoteRunId) return alert('응답이 끝난 뒤에 해 주세요.');
    if (!history.length) return alert('아직 이어갈 대화가 없어요.');
    let legacy = false;
    try { legacy = !!(await api('/api/rooms/continue', { room: project, check: true })).legacy; } catch (err) { return alert(err.message); }
    if (!(await gSheet({ title: T('room.continue'), message: T(legacy ? 'room.continueConfirmLegacy' : 'room.continueConfirm'), ok: T('room.continueOk') }))) return;
    const stopBusy = busyStart('continueBtn', 'room.continue'); // 짐 싸는 동안 돌아가는 동그라미와 바뀌는 글
    let r;
    try { r = await api('/api/rooms/continue', { room: project }); } catch (err) { return alert(err.message); } finally { stopBusy(); }
    window.gaTrack('chat_continue');
    const crew = r.members && r.members[0];
    if (r.room.startsWith('@')) rememberRoomCrew(r.room, crew || '');
    const titles = getRoomTitles();
    const oldName = titles[project] || crewParts(project).text;
    titles[r.room] = movedTitle(oldName);
    store.set('cc:roomTitle', titles);
    roomEl.classList.add('hidden');
    if (r.skippedBig) alert(T('room.continueSkippedBig'));
    selectProject(r.room);
  };

  // 채팅 내보내기: 대화·결과물·크루 지침을 zip으로 내려받는다
  const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(n >= 1.07e8 ? 0 : 1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
  // 이사가기 짐을 싸는 동안: 돌아가는 동그라미 + 재밌는 글이 2.5초마다 바뀐다. 방을 나갔다 들어와도 이어서 보인다
  const busyTimers = {}; // 버튼 id → 글자를 바꾸는 타이머
  const busyOn = (id) => !!busyTimers[id];
  function busyStart(id, labelKey) {
    const T = window.GAMJA_I18N.t;
    const btn = $(id);
    let i = Math.floor(Math.random() * 8);
    const show = () => { btn.textContent = T('room.exportFun' + (i++ % 8 + 1)); };
    btn.disabled = true;
    btn.classList.add('busy');
    clearInterval(busyTimers[id]);
    show();
    busyTimers[id] = setInterval(show, 2500);
    return () => { // 끝내기
      clearInterval(busyTimers[id]);
      delete busyTimers[id];
      btn.disabled = false;
      btn.classList.remove('busy');
      btn.textContent = window.GAMJA_I18N.t(labelKey);
    };
  }
  const exportBusyStart = () => { exportBusyStop = busyStart('exportBtn', 'room.export'); };
  let exportBusyStop = () => {};
  $('exportBtn').onclick = async () => {
    const T = window.GAMJA_I18N.t;
    els.menu.classList.add('hidden');
    if (runId || remoteRunId) return alert('응답이 끝난 뒤에 해 주세요.');
    if (!history.length) return alert('아직 내보낼 대화가 없어요.');
    const q = `room=${encodeURIComponent(project)}`;
    let info;
    const exportErr = (err) => {
      const key = err.code && `export.err.${err.code}`;
      const d = err.data || {};
      const msg = key && T(key) !== key ? T(key, { max: fmtSize(d.max || 0), size: fmtSize(d.size || 0), file: d.file || '' }) : (err.message || T('export.err.export-failed'));
      // 이유를 알 수 없는 실패(export-failed)는 감자알이 남긴 최근 기록을 함께 보여 준다 (화면을 캡처해서 알려 주세요)
      if (err.code !== 'export-failed') return alert(msg);
      fetch('/api/rooms/import/debug', { credentials: 'same-origin' }).then((g) => g.json()).then((j) => alert(`${msg}\n\nNode ${j.node}\n${(j.lines || []).join('\n')}`)).catch(() => alert(msg));
    };
    try { info = await api(`/api/rooms/export?${q}&check=1`); } catch (err) { return exportErr(err); }
    if (!(await gSheet({ title: T('room.export'), message: T('room.exportConfirm', { files: info.files, size: fmtSize(info.bytes) }), ok: T('room.exportOk') }))) return;
    // 이름·아이콘은 직접 만든 크루(cc:crew)에도, 템플릿으로 만든 크루(cc:tpl)에도 있다: 둘 다 찾아서 담는다
    const cm = crewMeta(project);
    const meta = cm ? { name: stripCrew(cm.name || ''), icon: cm.icon || '', blurb: cm.blurb || cm.desc || '', examples: cm.examples || [] } : null;
    const title = getRoomTitles()[project] || '';
    // 먼저 감자알이 zip을 끝까지 만들고 확인한 뒤에 내려받는다: 도중에 문제가 생기면 이유를 알려 줄 수 있다
    // 짐을 싸는 동안(10~30초) 버튼에 돌아가는 동그라미와 안내 글을 보여 주고, 다시 누르지 못하게 한다
    exportBusyStart();
    toast(T('room.exportPreparing'));
    let made;
    try { made = await api(`/api/rooms/export?${q}&prepare=1&title=${encodeURIComponent(title)}&meta=${encodeURIComponent(JSON.stringify(meta || null))}`); }
    catch (err) { return exportErr(err); }
    finally { exportBusyStop(); }
    const a = document.createElement('a');
    a.href = `/api/rooms/export/file?token=${encodeURIComponent(made.token)}`;
    a.download = '';
    window.gaTrack('chat_export');
    document.body.appendChild(a);
    a.click();
    a.remove();
    alert(T('room.exportStarted'));
  };
  // 채팅 가져오기 (2단계): 검사 → 미리보기 → 설치. 항상 새 크루로 설치한다. 미리보기의 글은 모두 textContent로만 넣는다
  const IMPORT_PENDING = 'gamja.importPending';
  const impErr = (r, fallback) => {
    const T = window.GAMJA_I18N.t;
    const k = 'import.err.' + (r && r.code);
    return r && r.code && T(k) !== k ? T(k) : (r && r.error) || fallback || '';
  };
  async function importCall(path, opt = {}) {
    let resp = await fetch(path, { credentials: 'same-origin', ...opt });
    // 감자알이 복구 중(503)이거나 마무리 중(409 busy)이면 몇 번 기다렸다가 다시 보낸다 (본문이 없는 요청이나 작은 요청만)
    for (let i = 0; i < 5 && (resp.status === 503 || (resp.status === 409 && opt.method !== 'POST')) && typeof opt.body !== 'object' && !(opt.body && opt.body.size > 1e6); i++) {
      await new Promise((r) => setTimeout(r, 2000));
      resp = await fetch(path, { credentials: 'same-origin', ...opt });
    }
    if (resp.status === 401) { showLogin(); return { status: 401, r: {} }; }
    return { status: resp.status, r: await resp.json().catch(() => ({})) };
  }
  const importPost = (what, id) => importCall('/api/rooms/import/' + what, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ importId: id }) });
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  // 설치가 끝난 뒤: 새 크루의 이름·아이콘은 감자알이 정한 것을 쓰고, 폴더 이름은 보이지 않는다
  // 이사 온 방 이름 규칙 (다른 밭으로 이사오기·같은 밭으로 이사가기 공통): "[이사] 이름(년월일시분)", 최대 40자
  function movedTitle(name) {
    const MOVE = window.GAMJA_I18N.t('import.tag');
    const d = new Date();
    const pad2 = (x) => String(x).padStart(2, '0');
    const stamp = `${pad2(d.getFullYear() % 100)}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}`;
    const base = String(name).replace(/^\[이사\]\s*|^\[Moved\]\s*/, '').replace(/\(\d{10}\)$/, '').trim();
    return `${MOVE} ${base.slice(0, 40 - MOVE.length - 13)}(${stamp})`;
  }
  async function finishImport(r) {
    const T = window.GAMJA_I18N.t;
    sessionStorage.removeItem(IMPORT_PENDING);
    window.gaTrack('chat_import');
    // 추천 크루와 구분되게 크루·방 이름 앞에 [이사]를 붙이고, 방 이름 뒤에는 이사 온 시각(년월일시분)을 붙인다
    const MOVE = T('import.tag');
    const tagged = (n) => (String(n).startsWith(MOVE) ? String(n) : `${MOVE} ${n}`);
    store.set(`cc:crew:${r.crewFolder}`, { ...(r.meta || {}), icon: (r.meta && r.meta.icon) || '📁', name: tagged(r.displayName) });
    rememberRoomCrew(r.roomId, r.crewFolder);
    const titles = getRoomTitles();
    const base = r.title || T('import.title.room');
    titles[r.roomId] = movedTitle(base);
    store.set('cc:roomTitle', titles);
    newChatEl.classList.add('hidden');
    roomEl.classList.add('hidden');
    await loadProjects();
    await refreshChats();
    selectProject(r.roomId);
    toast(T('import.done'));
  }
  // 연결이 끊긴 뒤에는 다시 설치하지 않고 먼저 상태를 물어본다 (설치 중이면 끝날 때까지 기다린다).
  // 결과가 분명할 때만 done/failed로 답한다. 시간이 다 되도록 알 수 없으면 실패로 단정하지 않고 { unclear: true }
  // (final: 감자알이 "설치는 끝났지만 지금 상태는 확인 못 함"이라고 확정해서 알려 준 경우)
  async function importWaitResult(id, tries = 40) {
    for (let i = 0; i < tries; i++) {
      let s;
      try { s = await importCall('/api/rooms/import/status?id=' + id); } catch { s = null; }
      if (s && s.r.status === 'done') return s.r;
      if (s && s.r.status === 'unclear') return { unclear: true, final: true };
      if (s && (s.r.status === 'failed' || s.status === 410 || s.status === 403)) return { failed: true, ...s.r };
      await new Promise((ok) => setTimeout(ok, 3000));
    }
    return { unclear: true, final: false };
  }
  // 결과가 불분명할 때: 실패라고 말하지 않고, 기록을 남겨 둔 채 감자가 천천히 계속 확인한다 (15초마다 최대 10분)
  let importBg = false;
  async function importUnclear(id, final) {
    const T = window.GAMJA_I18N.t;
    if (final) {
      sessionStorage.removeItem(IMPORT_PENDING);
      alert(T('import.err.unclear'));
      await loadProjects();
      await refreshChats();
      return;
    }
    alert(T('import.pending'));
    if (importBg) return;
    importBg = true;
    try {
      for (let i = 0; i < 40 && sessionStorage.getItem(IMPORT_PENDING) === id; i++) {
        await new Promise((ok) => setTimeout(ok, 15000));
        const r = await importWaitResult(id, 1);
        if (r.unclear && !r.final) continue;
        if (r.unclear) { await importUnclear(id, true); break; }
        if (r.failed) { sessionStorage.removeItem(IMPORT_PENDING); alert(impErr(r, T('import.err.install-failed'))); break; }
        await finishImport(r);
        break;
      }
    } finally { importBg = false; }
  }
  // 미리보기 시트: 확인 체크를 해야 설치 버튼이 켜진다. 결과는 true(설치)/false(취소)
  let importPvClose = () => {};
  function importPreview(info) {
    const T = window.GAMJA_I18N.t;
    return new Promise((resolve) => {
      const dim = mk('div', 'sheet-dim ui import-dim');
      const card = mk('div', 'sheet-card import-pv');
      const done = (v) => {
        if (!v) { dim.remove(); return resolve(false); }
        // 이사 시작: 창을 닫지 않고 진행 안내로 바꿔 둔다 (끝나면 importPvClose가 닫는다)
        card.innerHTML = '';
        card.classList.add('moving');
        card.appendChild(mk('div', 'import-spin'));
        card.appendChild(mk('h4', '', T('import.moving')));
        card.appendChild(mk('p', '', T('import.installing')));
        importPvClose = () => { dim.remove(); importPvClose = () => {}; };
        resolve(true);
      };
      card.appendChild(mk('div', 'sheet-grab'));
      card.appendChild(mk('h4', '', T('import.pv.title')));
      const body = mk('div', 'import-pv-body');
      const line = (cls, text) => body.appendChild(mk('p', cls, text));
      line('import-pv-main', `${info.icon ? info.icon + ' ' : ''}${T('import.pv.newcrew', { name: info.displayName })}`);
      line('', T('import.pv.newcrewNote'));
      if (info.sameNameExists) line('import-pv-warn', T('import.pv.sameName'));
      line('', T('import.pv.stats', { msgs: info.messageCount, files: info.filesTotal, size: fmtSize(info.bytes) }));
      if (info.title) line('', T('import.pv.chatTitle', { title: info.title }));
      const w = info.warnings || {};
      if (w.terms && w.terms.length) line('import-pv-warn', T('import.pv.warnTerms', { list: w.terms.join(', ') }));
      if (w.keyLike && w.keyLike.length) line('import-pv-warn', T('import.pv.warnKeys', { list: w.keyLike.join(', ') }));
      if (w.urls && w.urls.length) line('import-pv-warn', T('import.pv.warnUrls', { list: w.urls.join(', ') }));
      if (info.hiddenRemoved) line('import-pv-warn', T('import.pv.warnHidden', { n: info.hiddenRemoved }));
      if (info.handoff) { // 보낸 감자가 담은 인계 노트: 설치하면 새 방의 첫 대화에 맥락으로 들어간다
        body.appendChild(mk('h5', '', T('import.pv.handoff')));
        body.appendChild(mk('pre', 'import-pv-pre', info.handoff));
      }
      body.appendChild(mk('h5', '', T('import.pv.instr')));
      body.appendChild(mk('pre', 'import-pv-pre', info.crewMd === null ? T('import.pv.noInstr') : info.crewMd));
      body.appendChild(mk('h5', '', T('import.pv.files')));
      const ul = mk('ul', 'import-pv-files');
      for (const f of info.files) {
        const li = mk('li', f.flag ? 'flag-' + f.flag : '', `${f.path} (${fmtSize(f.size)})`);
        if (f.flag) li.appendChild(mk('small', '', ' · ' + T('import.pv.flag.' + f.flag)));
        ul.appendChild(li);
      }
      if (info.filesTotal > info.files.length) ul.appendChild(mk('li', '', T('import.pv.more', { n: info.filesTotal - info.files.length })));
      body.appendChild(ul);
      if (info.skipped && info.skipped.length) {
        body.appendChild(mk('h5', '', T('import.pv.skippedTitle', { n: info.skipped.length })));
        const sk = mk('ul', 'import-pv-files');
        for (const f of info.skipped.slice(0, 50)) {
          const rk = 'import.pv.reason.' + f.reason;
          sk.appendChild(mk('li', 'flag-skipped', `${f.path} · ${T(rk) !== rk ? T(rk) : T('import.pv.flag.skipped')}`));
        }
        body.appendChild(sk);
      }
      if (info.preview && info.preview.length) {
        body.appendChild(mk('h5', '', T('import.pv.talk')));
        for (const m of info.preview) body.appendChild(mk('p', 'import-pv-talk', `${m.role === 'user' ? '🙂' : '🥔'} ${m.text}`));
      }
      line('import-pv-sha', T('import.pv.sha', { sha: info.sha256 }));
      line('import-pv-sha', T('import.pv.shaNote'));
      line('import-pv-warn', T('import.pv.claudeNote'));
      card.appendChild(body);
      const lab = mk('label', 'import-pv-trust');
      const cb = mk('input');
      cb.type = 'checkbox';
      lab.appendChild(cb);
      lab.appendChild(mk('span', '', ' ' + T('import.pv.trust')));
      card.appendChild(lab);
      const row = mk('div', 'import-pv-btns');
      const no = mk('button', 'sheet-sub-btn', T('import.pv.cancel'));
      const yes = mk('button', 'sheet-main', T('import.pv.install'));
      no.type = 'button';
      yes.type = 'button';
      yes.disabled = true;
      cb.onchange = () => { yes.disabled = !cb.checked; };
      no.onclick = () => done(false);
      yes.onclick = () => { if (cb.checked) done(true); };
      dim.onclick = (e) => { if (e.target === dim) done(false); };
      row.appendChild(no);
      row.appendChild(yes);
      card.appendChild(row);
      dim.appendChild(card);
      document.body.appendChild(dim);
    });
  }
  $('importBtn').onclick = () => { $('importFile').value = ''; $('importFile').click(); };
  $('importFile').onchange = async () => {
    const T = window.GAMJA_I18N.t;
    const f = $('importFile').files[0];
    if (!f) return;
    if (f.size > 400 * 1024 * 1024) return alert(T('import.tooBig'));
    const btn = $('importBtn');
    const label = btn.textContent;
    const busy = (text) => { btn.disabled = true; btn.classList.add('busy'); btn.textContent = text; };
    const idle = () => { btn.disabled = false; btn.classList.remove('busy'); btn.textContent = label; };
    importBusyNow = true;
    try { await importRun(); } finally { importBusyNow = false; }
    async function importRun() {
    busy(T('import.inspecting'));
    let ins;
    // 고른 파일을 먼저 폰 안(메모리)으로 읽어 둔다: 폰에 내려받지 않은 파일(드라이브·카톡 등)이나 고른 뒤 바뀐 파일은 여기서 걸러져 이유를 알려 줄 수 있고,
    // 올리는 도중 파일이 바뀌어 끊기는 일도 없다
    let data;
    try { data = await f.arrayBuffer(); }
    catch { idle(); return alert(T('import.err.unreadable')); }
    const boot0 = bootId;
    try {
      ins = await importCall('/api/rooms/import/inspect', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: data });
    } catch (err) {
      // 끊긴 이유를 가리려고, 감자알이 살아 있는지·그 사이 다시 켜졌는지 확인해서 함께 보여 준다 (화면을 캡처해서 알려 주세요)
      let alive = false, reboot = false;
      for (let i = 0; i < 4 && !alive; i++) {
        await new Promise((ok) => setTimeout(ok, 1500));
        try { const m = await fetch('/api/me', { credentials: 'same-origin' }); if (m.ok) { alive = true; const j = await m.json(); reboot = !!(boot0 && j.boot && j.boot !== boot0); } } catch { /* 아직 안 됨 */ }
      }
      let dbg = '';
      if (alive) { try { const g = await fetch('/api/rooms/import/debug', { credentials: 'same-origin' }); if (g.ok) { const j = await g.json(); dbg = `\n\nNode ${j.node}\n` + (j.lines || []).join('\n'); } } catch { /* 없으면 생략 */ } }
      idle();
      const yn = (b) => T(b ? 'import.diag.yes' : 'import.diag.no');
      const diag = T('import.diag', { err: `${(err && err.name) || 'Error'}: ${(err && err.message) || ''}`, size: fmtSize(f.size), alive: yn(alive), reboot: yn(reboot) });
      return alert((err && err.name === 'TypeError' ? T('import.err.network') : (err && err.message) || T('import.err.network')) + '\n\n' + diag + dbg);
    }
    data = null;
    if (ins.status === 401) return idle();
    if (ins.status !== 200) { idle(); return alert(impErr(ins.r, 'HTTP ' + ins.status)); }
    idle();
    const id = ins.r.importId;
    if (!(await importPreview(ins.r))) { importPost('cancel', id).catch(() => {}); return; }
    busy(T('import.installing'));
    sessionStorage.setItem(IMPORT_PENDING, id);
    let res;
    try {
      const c = await importPost('commit', id);
      if (c.status === 401) { importPvClose(); return idle(); }
      res = c.status === 200 && c.r.status === 'done' ? c.r
        : c.status === 200 && c.r.status === 'unclear' ? { unclear: true, final: true }
        : c.r && c.r.code === 'committing' ? { unclear: true, final: false } // 이미 설치 중: 실패가 아니다
        : { failed: true, ...c.r };
    } catch {
      btn.textContent = T('import.checking');
      res = await importWaitResult(id); // 연결이 끊겼으면 다시 설치하지 않고 결과부터 확인
    }
    idle();
    importPvClose();
    if (res.unclear) return importUnclear(id, res.final);
    if (res.failed) { sessionStorage.removeItem(IMPORT_PENDING); return alert(impErr(res, T('import.err.install-failed'))); }
    await finishImport(res);
    }
  };
  // 설치 도중 화면이 새로고침됐다면, 감자알에 결과를 물어서 이어 마무리한다
  setTimeout(async () => {
    const id = sessionStorage.getItem(IMPORT_PENDING);
    if (!id) return;
    const res = await importWaitResult(id);
    if (res.unclear) await importUnclear(id, res.final);
    else if (res.failed) sessionStorage.removeItem(IMPORT_PENDING);
    else await finishImport(res);
  }, 3000);

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
  function openTunnelPanel(ssl) {
    const T = window.GAMJA_I18N.t;
    for (const [id, key] of [['extTitle', 'ext.title'], ['lanH', 'ext.lanH'], ['lanLabel', 'ext.lanLabel'], ['lanNote', 'ext.lanNote'],
      ['lanShowApp', 'ext.lanShowApp'], ['lanPwNote', 'ext.lanPwNote'], ['lanQrHint', 'ext.qrHint'], ['lanCopy', 'ext.copy'], ['proH', 'ext.proH'], ['proLockedTitle', 'ext.proTitle'], ['proLockedNote', 'ext.proNote']]) $(id).textContent = T(key);
    $('lanPart').classList.toggle('hidden', ssl); // 외부 접속은 같은 와이파이만, SSL Connect는 https 주소만 보여 준다
    $('sslPart').classList.toggle('hidden', !ssl);
    if (ssl) $('extTitle').textContent = '🔒 SSL Connect';
    els.menu.classList.add('hidden');
    tunnelEl.classList.remove('hidden');
    if (!ssl) refreshLan();
    refreshTunnel();
  }
  $('tunnelBtn').onclick = () => openTunnelPanel(false);
  $('sslBtn').onclick = async () => { // 눌러서 암호를 통과해야 열린다
    const pin = await gSheet({ title: '암호를 입력해 주세요', ok: '확인', field: { value: '', placeholder: '암호', secret: true } });
    if (!pin) return;
    try { await api('/api/tunnel/auth', { pin }); } catch (err) { return alert(err.message); }
    openTunnelPanel(true);
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
  const ghCodeHtml = (s) => '<p class="settings-note">GitHub에서 아래 코드를 입력해 승인해 주세요. 승인되면 이 화면이 자동으로 바뀌어요.</p>' +
    `<div class="gh-code">${escapeHtml(s.pending.user_code)}</div>` +
    `<a class="settings-save ghlink" href="${escapeHtml(s.pending.verification_uri)}" target="_blank" rel="noopener">GitHub 열어서 코드 입력하기</a>` +
    '<button id="ghCopy" class="settings-ghost" type="button">📋 코드 복사</button>' +
    '<p class="settings-note">GitHub 화면에서 <b>Authorize</b>를 누르면 끝나요. 승인 화면에 "private 저장소" 권한이 보이는 건, 비공개 저장소(gamja-workspace)를 만들고 쓰기 위해서예요.</p>';
  async function renderGh() {
    let s;
    try { s = await api('/api/github/status'); } catch { return; }
    if (ghEl.classList.contains('hidden')) return;
    let html;
    if (s.connected && ghView === 'repos') return renderGhRepos(s);
    if (s.connected) {
      const T = window.GAMJA_I18N.t;
      const g = s.git;
      const on = (id, v) => `<input id="${id}" type="checkbox"${v ? ' checked' : ''}>`;
      const gitTool = g.installed ? `<b class="gh-ok">${escapeHtml(T('tools.installed'))}</b>`
        : g.installing ? `<b>${escapeHtml(T('tools.installing'))}</b>`
        : `<button id="ghGitInstall" class="tool-btn" type="button">${escapeHtml(T('tools.install'))}</button>`;
      const reauth = !s.authBad ? ''
        : s.pending && !s.pending.error ? ghCodeHtml(s)
        : (s.pending && s.pending.error ? `<p class="settings-note err">⚠️ ${escapeHtml(s.pending.error)}</p>` : '') +
          `<div class="gh-reauth"><b>⚠️ ${escapeHtml(T('gh.authBad'))}</b><span>${escapeHtml(T('gh.authBadSub'))}</span>` +
          `<button id="ghConnect" class="settings-save" type="button">${escapeHtml(T('gh.reconnect'))}</button></div>`;
      html = reauth + `<div class="share-card"><div class="share-icon">🐙</div><b>@${escapeHtml(s.login)}</b>` +
        (s.authBad ? `<small class="gh-bad">● ${escapeHtml(T('gh.authBadShort'))}</small></div>` : `<small class="gh-ok">● ${escapeHtml(T('gh.connected'))}</small></div>`) +
        `<h3>${escapeHtml(T('gh.gitHead'))}</h3>` +
        `<label class="share-check"><span>${escapeHtml(T('gh.gitOn'))}<small class="gh-sub">${escapeHtml(T('gh.gitOnSub'))}</small></span>${on('ghGitOn', g.on)}</label>` +
        (g.on
          ? `<button id="ghReposBtn" class="settings-row gh-row" type="button"><span>${escapeHtml(T('gh.repos'))}</span><b>${escapeHtml(g.mode === 'all' ? T('gh.reposAll') : T('gh.reposN', { n: g.repos.length }))} ›</b></button>` +
            `<p class="settings-row"><span>${escapeHtml(T('gh.name'))}</span><b>${escapeHtml(g.name)}</b></p>` +
            `<p class="settings-row"><span>${escapeHtml(T('gh.email'))}</span><b class="gh-small">${escapeHtml(g.email)}</b></p>` +
            `<label class="share-check"><span>${escapeHtml(T('gh.askPublic'))}<small class="gh-sub">${escapeHtml(T('gh.askPublicSub'))}</small></span>${on('ghAskPublic', g.askPublic)}</label>` +
            `<div class="settings-row gh-row"><span>${escapeHtml(T('gh.tool'))}</span>${gitTool}</div>` +
            (!g.installed && g.installError ? `<p class="settings-note err">⚠️ ${escapeHtml(g.installError)}</p>` : '') +
            (g.mode === 'pick' && !g.repos.length ? `<p class="settings-note">ⓘ ${escapeHtml(T('gh.noRepos'))}</p>` : '')
          : '') +
        `<h3>${escapeHtml(T('gh.backupHead'))}</h3>` +
        `<label class="share-check"><span>${escapeHtml(T('gh.backup', { repo: s.repo }))}<small class="gh-sub">${escapeHtml(T('gh.backupSub'))}</small></span>${on('ghBackup', s.backup)}</label>` +
        (s.backup
          ? `<p class="settings-row"><span>마지막 기록</span><b>${s.syncing ? '기록하는 중…' : s.lastSync ? ago(s.lastSync) : '아직 없어요'}</b></p>` +
            (s.lastCount ? `<p class="settings-row"><span>그때 바뀐 파일</span><b>${s.lastCount}개</b></p>` : '') +
            (s.lastError ? `<p class="settings-note err">⚠️ ${escapeHtml(s.lastError)}</p>` : '') +
            (s.skipped.length ? `<p class="settings-note">ⓘ 자기 git 기록이 이미 있는 폴더는 건너뛰어요: ${s.skipped.map(escapeHtml).join(', ')}</p>` : '') +
            `<a class="settings-save ghlink" href="https://github.com/${encodeURIComponent(s.login)}/${encodeURIComponent(s.repo)}" target="_blank" rel="noopener">GitHub에서 보기</a>` +
            '<button id="ghSync" class="settings-ghost" type="button">지금 기록하기</button>' +
            '<p class="settings-note">• 크루가 답을 끝낼 때마다 그 크루 폴더의 바뀐 파일이 자동으로 기록돼요.<br>• <b>대화 내용은 올리지 않아요.</b> 점(.)으로 시작하는 파일, 비밀번호·열쇠처럼 보이는 파일, 1MB 넘는 파일도 올리지 않아요.<br>• 저장소가 공개로 바뀌면 기록을 멈춰요.</p>'
          : '') +
        `<p class="settings-note">${escapeHtml(T('gh.keyNote'))}</p>` +
        '<button id="ghOff" class="settings-danger" type="button">연결 끊기</button>' +
        '<p class="settings-note">연결을 끊으면 이 폰에 저장한 열쇠를 지워요. GitHub 쪽 승인까지 완전히 취소하려면 github.com/settings/applications 에서 GAMJA를 지워 주세요. 이미 올라간 기록은 그대로 남아요.</p>';
    } else if (s.pending && !s.pending.error) {
      html = ghCodeHtml(s);
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
  // 쓸 수 있는 저장소 고르기 (GitHub 화면 안의 두 번째 화면). 고르는 즉시 저장한다
  let ghView = 'main';
  let ghRepoList = null; // [{ full, private }]
  let ghRepoErr = '';
  let ghRepoQuery = '';
  async function loadGhRepos(fresh) {
    ghRepoErr = '';
    try { ghRepoList = (await api('/api/github/repos' + (fresh ? '?fresh=1' : ''))).repos; } catch (err) { ghRepoErr = err.message; }
  }
  function renderGhRepos(s) {
    const T = window.GAMJA_I18N.t;
    const g = s.git;
    const picked = new Set(g.repos.map((r) => r.full));
    const q = ghRepoQuery.trim().toLowerCase();
    const list = (ghRepoList || []).filter((r) => !q || r.full.toLowerCase().includes(q));
    const vis = (r) => `<small class="${r.private ? '' : 'gh-pub'}">${escapeHtml(r.private ? T('gh.private') : T('gh.public'))}</small>`;
    ghBody.innerHTML = `<button id="ghReposBack" class="settings-ghost gh-back" type="button">‹ ${escapeHtml(T('gh.back'))}</button>` +
      `<h3>${escapeHtml(T('gh.repos'))}</h3>` +
      '<div class="radio-list">' +
      `<label><input type="radio" name="ghMode" value="all"${g.mode === 'all' ? ' checked' : ''}> ${escapeHtml(T('gh.reposAll'))} <span>${escapeHtml(T('gh.modeAllSub'))}</span></label>` +
      `<label><input type="radio" name="ghMode" value="pick"${g.mode !== 'all' ? ' checked' : ''}> ${escapeHtml(T('gh.modePick'))} <span>${escapeHtml(T('gh.modePickSub'))}</span></label>` +
      '</div>' +
      (g.mode === 'all' ? '' :
        `<h3>${escapeHtml(ghRepoList ? T('gh.myRepos', { n: ghRepoList.length }) : T('gh.loading'))}</h3>` +
        (ghRepoErr ? `<p class="settings-note err">⚠️ ${escapeHtml(ghRepoErr)}</p>` : '') +
        `<input id="ghRepoFind" type="search" placeholder="${escapeHtml(T('gh.find'))}" value="${escapeHtml(ghRepoQuery)}" autocomplete="off" autocapitalize="off" spellcheck="false">` +
        list.map((r) => `<label class="share-check gh-repo"><span>${escapeHtml(r.full)}${vis(r)}</span><input type="checkbox" data-repo="${escapeHtml(r.full)}"${picked.has(r.full) ? ' checked' : ''}></label>`).join('') +
        (ghRepoList && !list.length ? `<p class="settings-note">${escapeHtml(T('gh.noMatch'))}</p>` : '') +
        `<button id="ghNewRepo" class="settings-ghost" type="button">＋ ${escapeHtml(T('gh.newRepo'))}</button>` +
        `<p class="settings-note">${escapeHtml(T('gh.pickNote'))}</p>`);
    const find = $('ghRepoFind');
    if (find) find.addEventListener('input', () => { ghRepoQuery = find.value; const pos = find.selectionStart; renderGh().then(() => { const f = $('ghRepoFind'); if (f) { f.focus(); f.setSelectionRange(pos, pos); } }); });
  }
  const ghSave = (body) => api('/api/github/settings', body);
  $('ghBtn').onclick = () => {
    ghEl.classList.remove('hidden');
    ghView = 'main';
    renderGh();
    clearInterval(ghUiTimer);
    ghUiTimer = setInterval(() => { if (ghView === 'main') renderGh(); }, 3000); // 승인 여부와 기록 상태를 따라간다 (저장소 고르는 중에는 다시 그리지 않는다)
  };
  $('ghBack').onclick = () => {
    if (ghView === 'repos') { ghView = 'main'; renderGh(); return; }
    clearInterval(ghUiTimer); ghEl.classList.add('hidden');
  };
  ghBody.addEventListener('change', async (e) => {
    const el = e.target;
    try {
      if (el.id === 'ghGitOn') { await ghSave({ gitOn: el.checked }); if (el.checked) toast(window.GAMJA_I18N.t('gh.onToast')); }
      else if (el.id === 'ghAskPublic') await ghSave({ askPublic: el.checked });
      else if (el.id === 'ghBackup') await ghSave({ backup: el.checked });
      else if (el.name === 'ghMode') { await ghSave({ mode: el.value }); if (el.value === 'pick' && !ghRepoList) await loadGhRepos(); }
      else if (el.dataset.repo) {
        const repos = [...ghBody.querySelectorAll('[data-repo]')].filter((c) => c.checked).map((c) => c.dataset.repo);
        // 검색으로 가려진 저장소의 선택도 지키려고, 지금 저장된 목록에서 화면에 없는 것을 더한다
        const s = await api('/api/github/status');
        const shown = new Set([...ghBody.querySelectorAll('[data-repo]')].map((c) => c.dataset.repo));
        await ghSave({ repos: [...repos, ...s.git.repos.map((r) => r.full).filter((f) => !shown.has(f))] });
        return;
      }
      else return;
    } catch (err) { toast(err.message); }
    renderGh();
  });
  ghBody.addEventListener('click', async (e) => {
    const id = (e.target.closest('button') || e.target).id; // 줄 버튼 안의 글자를 눌러도 버튼으로 본다
    try {
      if (id === 'ghConnect') { await api('/api/github/start', {}); renderGh(); }
      else if (id === 'ghReposBtn') { ghView = 'repos'; ghRepoQuery = ''; await renderGh(); await loadGhRepos(true); renderGh(); }
      else if (id === 'ghReposBack') { ghView = 'main'; renderGh(); }
      else if (id === 'ghGitInstall') { await api('/api/tools/install', { kit: 'git' }); toast(window.GAMJA_I18N.t('tools.started')); renderGh(); }
      else if (id === 'ghNewRepo') {
        const T = window.GAMJA_I18N.t;
        const name = await gSheet({ title: T('gh.newRepo'), message: T('gh.newRepoMsg'), field: { placeholder: 'my-project' }, ok: T('gh.create') });
        if (!name || !name.trim()) return;
        // 바깥을 눌러 닫으면 비공개로 만든다 (실수로 공개되지 않게)
        const pub = await gSheet({ title: T('gh.visTitle'), message: T('gh.visMsg'), ok: T('gh.makePublic'), cancel: T('gh.makePrivate') });
        const r = await api('/api/github/repos', { name: name.trim(), private: pub !== true });
        if (ghRepoList) ghRepoList.unshift(r.repo);
        toast(T('gh.created', { name: r.repo.full }));
        renderGh();
      }
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
    if (name && d.info) crewInfo[name] = d.info;
    renderTplBox(name);
    // "직접 만들기"와 같은 입력 양식. 감자 톡톡(루트)과 감자 앱이 들어 있는 폴더는 이름·아이콘을 바꾸지 않고 맡은 일만 보여 준다
    const withInfo = !!name && !d.locked;
    const meta = name ? crewMeta(name) : null;
    const parts = crewParts(name);
    $('projForm').innerHTML = crewFormHtml('ps', {
      icon: parts.icon, name: parts.text, blurb: (meta && meta.blurb) || '', group: (meta && meta.group) || '', job: d.instructions,
    }, { withInfo, jobRows: 8 });
    $('projBrainNote').textContent = window.GAMJA_I18N.t('crew.brainNote'); // 크루는 지침만. 두뇌는 채팅방에서 고른다
    // 루트(전체)와 GAMJA 앱이 들어 있는 폴더는 삭제 불가
    $('projDelete').classList.toggle('hidden', d.locked);
    $('projExport').classList.toggle('hidden', !name); // 홈 대화는 내보낼 크루가 없다
    projEl.classList.remove('hidden');
  }
  // ⚙️ 크루 설정의 "지침 버전" 상자: 지금 버전, 새 버전 업데이트, 이전 지침으로 되돌리기
  function renderTplBox(name) {
    const T = window.GAMJA_I18N.t;
    const box = $('projTplBox');
    const info = name ? crewInfo[name] : null;
    const u = updInfo(name);
    const rec = info && info.tpl;
    if (!info || (!rec && !u && !info.backups)) { box.innerHTML = ''; return; }
    let h = `<h3>${escapeHtml(T('upd.boxTitle'))}</h3>`;
    if (rec) h += `<p class="settings-note">${escapeHtml(T(rec.edited ? 'upd.verEdited' : 'upd.ver', { ver: rec.ver }))}</p>`;
    if (u) h += `<button class="settings-ghost" data-tpl="update" type="button">${escapeHtml(T('upd.btn', { ver: u.def.version }))}</button>`;
    if (info.backups) h += `<button class="settings-ghost" data-tpl="undo" type="button">${escapeHtml(T('upd.undo'))}</button>`;
    box.innerHTML = h;
  }
  $('projTplBox').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tpl]');
    if (!b) return;
    if (b.dataset.tpl === 'update') doCrewUpdate(projTarget); else undoCrewUpdate(projTarget);
  });
  // 지침 업데이트: 확인(바뀐 점, 직접 고쳤으면 경고) → 감자알이 백업하고 바꾼다. 같은 크루로 나눈 모든 채팅방이 다음 메시지부터 새 지침을 쓴다
  async function doCrewUpdate(name) {
    const T = window.GAMJA_I18N.t;
    const u = updInfo(name);
    if (!u) return;
    const ver = u.def.version;
    const chKey = `tplchg.${u.def.id}.${ver}`;
    const changes = T(chKey);
    const message = (changes !== chKey ? T('upd.msg', { ver, changes }) : T('upd.msgPlain', { ver })) + (u.edited ? '\n\n' + T('upd.edited') : '');
    if (!(await gSheet({ title: T('upd.title'), message, ok: T('upd.ok'), cancel: T('upd.later') }))) return;
    try { await api('/api/crew-update', { project: name, tpl: { id: u.def.id, ver }, ...(u.def.remote ? { remote: true } : { instructions: u.def.instructions }) }); } catch (err) { return alert(err.message); }
    await loadProjects();
    if (!projEl.classList.contains('hidden') && projTarget === name) await openProjectSettings(name);
    toast(T('upd.done', { ver }));
  }
  async function undoCrewUpdate(name) {
    const T = window.GAMJA_I18N.t;
    if (!(await gSheet({ title: T('upd.undoTitle'), message: T('upd.undoMsg'), ok: T('upd.undoOk'), cancel: T('upd.later') }))) return;
    try { await api('/api/crew-update-undo', { project: name }); } catch (err) { return alert(err.message); }
    await loadProjects();
    if (!projEl.classList.contains('hidden') && projTarget === name) await openProjectSettings(name);
    toast(T('upd.undone'));
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
    try {
      await api('/api/project-settings', { project: projTarget, instructions });
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
  $('projBack').onclick = () => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); // 쓰던 글칸이 있으면 먼저 저장되게
    projEl.classList.add('hidden');
  };
  $('projDelete').onclick = async () => {
    const T = window.GAMJA_I18N.t;
    await refreshChats(); // 지우기 전에 이 크루가 들어가 있는 방(보관 포함)이 있는지 센다
    // 채팅 목록에 실제로 보이는 방과 보관한 방만 센다 (대화도 방 열기도 고정도 없는 크루의 빈 첫 방은 세지 않는다)
    const opened = store.get('cc:roomMade', {});
    const pinned = getRoomPins();
    const mine = chats.filter((c) => !c.archive && (c.members && c.members.length ? c.members.includes(projTarget) : crewOf(c.name) === projTarget)
      && (c.extra || c.ts || opened[c.name] || pinned[c.name] || c.archived));
    const archived = mine.filter((c) => c.archived).length;
    if (mine.length) { // 들어가 있는 채팅방이 있으면 지울 수 없다. 방을 먼저 지우면 된다
      await gSheet({ title: T('crew.deleteTitle'), message: T('crew.hasRooms', { n: mine.length, m: archived }), ok: T('crew.hasRoomsOk'), alertOnly: true });
      return;
    }
    if (!(await gSheet({ title: T('crew.deleteTitle'), message: T('crew.deleteConfirm', { name: projTarget }), ok: T('room.deleteOk'), danger: true }))) return;
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
  $('autoUpdateToggle').onchange = async () => {
    const box = $('autoUpdateToggle');
    const on = box.checked;
    try { await api('/api/auto-update', { on }); }
    catch (err) { box.checked = !on; alert(err.message); }
  };
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
    setRoomPref('zoom', ZOOM_STEPS[i]); // 이 방만의 설정으로 저장
  }
  $('zoomOut').onclick = () => stepZoom(-1);
  $('zoomIn').onclick = () => stepZoom(1);
  $('zoomVal').onclick = () => setRoomPref('zoom', 1); // 가운데 숫자를 누르면 이 방을 100%로
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
      // 그룹 방에서 서로 부르기 한도에 걸려 멈췄을 때: 누르면 방장에게 "이어서 해 줘"를 보낸다
      if (m.relayStop && m.leader) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'relay-go';
        b.dataset.leader = m.leader;
        b.textContent = window.GAMJA_I18N.t('relay.go');
        n.append(document.createElement('br'), b);
      }
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
    // 그룹 채팅의 말풍선은 말한 참여자의 대화명을 보여 준다 (방장은 "대화명 · 방장")
    // 크루가 하나뿐인 채팅방은 "Claude" 대신 그 방의 크루 이름을 보여 준다
    // 두 줄: 첫 줄 대화명, 둘째 줄 "크루 이름 · 두뇌" (참여자 목록과 같게). 내보낸 참여자처럼 지금 정보가 없으면 첫 줄만
    if (m.role !== 'user') labelRow(row, m);
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
  // 크루 말풍선 위의 이름(두 줄)과 테두리 색. 그룹 방에서 답이 오는 중이면 지금 말하는 참여자로 다시 붙인다
  function labelRow(row, m) {
    {
      const g = roomGroup(project);
      const mem = g && m.by ? g.find((x) => x.id === m.by) : null;
      let nick, sub = '';
      if (mem) { nick = m.byName || agentNick(mem.crew, mem); sub = agentSub(mem.crew, mem); }
      else if (m.byName) nick = m.byName;
      else if (m.summary) nick = '';
      else { const c = m.by !== undefined && !g ? m.by : project; nick = agentNick(c, c === project ? roomAgent : null); sub = c === project ? agentSub(c, roomAgent) : ''; }
      const sum = m.summary || (mem && mem.leader) ? window.GAMJA_I18N.t('room.summary') : ''; // 방장이 한 말은 "대화명 · 방장"
      const nameEl = row.querySelector('.name');
      nameEl.textContent = '';
      const b = document.createElement('b');
      b.textContent = nick && sum ? `${nick} · ${sum}` : nick || sum;
      nameEl.appendChild(b);
      if (sub) { const s = document.createElement('small'); s.textContent = sub; nameEl.appendChild(s); }
      const mc = memberColor(mem); // 그룹 방: 말풍선 테두리를 그 참여자의 고유 색으로 (@ 대화명 버튼과 같은 색)
      const bb = row.querySelector('.bubble');
      bb.classList.toggle('mc', !!mc);
      if (mc) bb.style.setProperty('--mc', mc); else bb.style.removeProperty('--mc');
    }
  }
  const shownFileName = (n) => String(n).replace(/^\d+-[a-f0-9]{8}-/, '');
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
        : btn('once', T('perm.once'), 'main') + btn('no', T('perm.no'), 'ghost')}</div></div>`;
  }
  // 말풍선의 @대화명을 @ 버튼 줄에서 고른 모양처럼 그 참여자 고유 색 배경으로 (그룹 방, 지금 참여자 대화명만)
  // 글 조각 하나를 [글, @태그, 글…]로 나눈 조각 모음을 돌려준다. @대화명이 없으면 null
  function mentionFrag(text) {
    const g = roomGroup(project);
    const nicks = g ? g.map((x) => x.nick).filter(Boolean).sort((a, b) => b.length - a.length) : [];
    if (!nicks.length || !text.includes('@')) return null;
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 감자알이 부르기로 알아듣는 것과 똑같이 (server.js mentionedMembers: 글 어디든 "@대화명", 대소문자 무시, 긴 이름 먼저)
    const re = new RegExp(`()@(${nicks.map(esc).join('|')})`, 'giu');
    const frag = document.createDocumentFragment();
    let last = 0, mm, hit = false;
    while ((mm = re.exec(text))) {
      hit = true;
      const at = mm.index + mm[1].length;
      frag.appendChild(document.createTextNode(text.slice(last, at)));
      const tag = document.createElement('span');
      tag.className = 'mention-tag';
      const c = memberColor(g.find((x) => String(x.nick || "").toLowerCase() === mm[2].toLowerCase()));
      if (c) tag.style.setProperty('--mc', c);
      tag.textContent = '@' + mm[2];
      frag.appendChild(tag);
      last = at + 1 + mm[2].length;
    }
    if (!hit) return null;
    frag.appendChild(document.createTextNode(text.slice(last)));
    return frag;
  }
  function appendUserText(el, text) { el.appendChild(mentionFrag(text) || document.createTextNode(text)); }
  // 크루 말풍선(마크다운으로 그린 것): 코드·링크 밖의 글에서 @대화명을 찾아 바꾼다
  function tagMentions(root) {
    if (!roomGroup(project) || !root.textContent.includes('@')) return;
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue.includes('@') && !n.parentElement.closest('code, pre, a, .mention-tag') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const nodes = [];
    while (walk.nextNode()) nodes.push(walk.currentNode);
    for (const n of nodes) { const f = mentionFrag(n.nodeValue); if (f) n.replaceWith(f); }
  }
  function paint(view, m, streaming) {
    setTimeout(syncStopBtn, 0);
    if (m.role === 'user' && (m.images || m.localImages || m.files)) {
      // 첨부 이미지·파일 + 글 (보내는 중에는 미리보기 주소, 저장 후에는 서버 주소)
      view.bubble.textContent = '';
      const srcs = m.localImages || (m.images || []).map(imageUrl);
      const box = document.createElement('div');
      box.className = 'bubble-images';
      for (const n of m.files || []) {
        const a = document.createElement('a');
        a.className = 'file-chip';
        a.href = imageUrl(n);
        a.download = shownFileName(n);
        a.textContent = '📄 ' + shownFileName(n);
        box.appendChild(a);
      }
      for (const src of srcs) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = '첨부 이미지';
        img.loading = 'lazy';
        img.onclick = () => openPhoto(src);
        box.appendChild(img);
      }
      view.bubble.appendChild(box);
      if (m.text) appendUserText(view.bubble, m.text);
    } else if (m.role === 'error' && /^⏹\s*/.test(m.text)) {
      view.bubble.textContent = '';
      const sq = document.createElement('span'); sq.className = 'stop-sq';
      view.bubble.append(sq, m.text.replace(/^⏹\s*/, ''));
    } else if (m.role === 'user') { view.bubble.textContent = ''; appendUserText(view.bubble, m.text || ''); }
    else if (m.role === 'error') view.bubble.textContent = m.text;
    else {
      // 크루가 "도구 설치가 필요해요"라고 붙인 표시 줄은 글에서 숨긴다 (쓰는 중인 반쪽짜리 표시도 함께)
      const shown = m.text ? m.text.replace(INSTALL_MARK, '\n').replace(/\s*\[\[gamja[^\]]*$/, '').trim() : '';
      view.bubble.innerHTML = shown ? window.renderMarkdown(shown) : '';
      if (shown) tagMentions(view.bubble);
      view.bubble.classList.toggle('cursor', !!streaming);
    }
    if (!view.extra) return;
    let html = '';
    // Claude 로그인이 풀려서 난 오류: 어떻게 다시 로그인하는지 안내한다 (감자 앱에서 로그인해야 한다)
    if (m.role === 'error' && m.auth) {
      const T = window.GAMJA_I18N.t;
      html += `<div class="auth-card"><b>${escapeHtml(T('auth.title'))}</b><small>${escapeHtml(T('auth.body'))}</small></div>`;
    }
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
    // 안전을 위해 막은 명령: 버튼 없이 안내만
    for (const b of (m.blocked || [])) {
      html += `<div class="perm-card blocked-note"><b>${escapeHtml(window.GAMJA_I18N.t('perm.blockedTitle'))}</b>` +
        `<code data-no-i18n>${escapeHtml(b.cmd)}</code><small>⚠️ ${escapeHtml(b.why)}</small></div>`;
    }
    const acts = !streaming && m.text && m.role === 'bot'
      ? `<span class="msg-acts"><button class="speak-btn" type="button" title="읽어주기">🔊</button>` +
        `<button class="speak-btn copy-msg-btn" type="button" title="${escapeHtml(window.GAMJA_I18N.t('msg.copy'))}">📋</button></span>` : '';
    if (m.meta || acts) html += `<div class="meta-row">${m.meta ? `<div class="meta">${escapeHtml(m.meta)}</div>` : ''}${acts}</div>`; // 토큰 표시 줄의 오른쪽 끝에 두 버튼
    if (streaming && view.extraHtml === html) return; // 답이 오는 중: 도구 목록 등이 그대로면 다시 그리지 않는다
    view.extraHtml = html;
    view.extra.innerHTML = html;
    const sb = view.extra.querySelector('.speak-btn:not(.copy-msg-btn)');
    if (sb) sb.onclick = () => speak(m.text, true, view.bubble);
    const cb = view.extra.querySelector('.copy-msg-btn');
    if (cb) cb.onclick = async () => {
      // 화면에 보이는 글만 (코드 상자의 "복사" 버튼 글자는 빼고)
      const hide = [...view.bubble.querySelectorAll('.copy')];
      hide.forEach((b) => { b.style.display = 'none'; });
      const text = view.bubble.innerText.trim();
      hide.forEach((b) => { b.style.display = ''; });
      // 보안 연결(https)이 아닌 주소(와이파이 접속)에서는 clipboard가 막히므로, 숨은 글칸으로 복사하는 방법을 먼저 이어서 쓴다. 둘 다 안 될 때만 시트를 띄운다
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch { /* 아래 방법으로 */ }
      if (!ok) {
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
        document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
        try { ok = document.execCommand('copy'); } catch { ok = false; }
        ta.remove();
      }
      // 복사됐다는 알림은 크롬이 스스로 띄워 주므로 우리 토스트는 없다. 복사가 안 될 때만 시트를 띄운다
      if (!ok) gCopy(window.GAMJA_I18N.t('msg.copy'), text);
    };
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
      window.gaTrack('tool_install', { kit });
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

  // 서로 부르기가 멈춘 알림의 "이어서 하기": 방장을 불러 이어서 하게 한다 (보낸 글은 대화에 그대로 남는다)
  els.messages.addEventListener('click', (e) => {
    const btn = e.target.closest('.relay-go');
    if (!btn || btn.disabled) return;
    if (runId || remoteRunId) return toast(window.GAMJA_I18N.t('relay.busy'));
    btn.disabled = true;
    els.input.value = `@${btn.dataset.leader} ${window.GAMJA_I18N.t('relay.resume')}`;
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
    btn.textContent = window.GAMJA_I18N.trText('복사됨'); // 말풍선 안은 화면 번역이 건너뛰므로 직접 번역
    setTimeout(() => { btn.textContent = window.GAMJA_I18N.trText('복사'); }, 1200);
  });

  // ---------- 상태 표시 ----------
  function setStatus(text) {
    if (voice.on && voice.phase === 'work' && text) $('voiceState').textContent = text; // 음성 대화 화면에도 진행 상태
    if (!text) return els.status.classList.add('hidden');
    els.statusText.textContent = text;
    els.status.classList.remove('hidden');
  }
  function setRunning(on) {
    // 크루가 일하는 중에도 오른쪽 버튼은 그대로(🗣 음성 대화 / ➤). 빨간 ■ 중지는 크루 말풍선 오른쪽으로 옮겼다
    els.send.classList.remove('stop');
    if (!on) setStatus('');
    updateSendState();
  }

  // ---------- 전송 & SSE 수신 ----------
  // 반환: { text, finished, error } (음성 대화 모드가 답을 읽어 주는 데 씀), 보내지 않았으면 null
  // 그룹 채팅이면 크루들의 화면용 이름을 함께 보낸다 (서버는 화면용 이름을 모른다. 누구를 불렀는지(@대화명)는 감자알이 글에서 찾는다)
  function groupInfo() {
    const members = roomMembers(project);
    if (members.length < 2) return {};
    return { names: namesOf(members) };
  }
  async function sendMessage(opts = {}) {
    if (!aiReady()) { toast(window.GAMJA_I18N.t('ai.need.title')); return null; } // AI 계정이 없으면 보내지 않는다 (입력창 위 안내 참고)
    let text = els.input.value.trim();
    if ((!text && !pending.length && !attachPrep.jobs.size) || runId) return null;
    if (remoteRunId) { alert('이전 응답이 아직 진행 중이에요. 끝난 뒤에 보내 주세요.'); return null; }
    // 고른 사진을 아직 준비하는 중이면, 다 준비될 때까지 기다렸다가 한꺼번에 보낸다 (기다리는 동안 또 누르면 무시)
    if (attachPrep.jobs.size) {
      if (attachPrep.waiting) return null;
      attachPrep.waiting = true;
      const proj0 = project;
      setStatus(window.GAMJA_I18N.t('attach.preparing'));
      try {
        while (attachPrep.jobs.size) await Promise.all([...attachPrep.jobs]).catch(() => {});
      } finally { attachPrep.waiting = false; }
      setStatus('');
      if (runId || remoteRunId || project !== proj0) return null; // 기다리는 사이 다른 방으로 갔으면 보내지 않는다
      text = els.input.value.trim();
      if (!text && !pending.length) return null;
    }
    window.gaTrack('message_send');
    stopListening();
    stopSpeaking();
    clearTimeout(pollTimer);

    // 첨부 이미지를 먼저 올린다 (실패하면 보내지 않고 그대로 둔다)
    let images = [];
    const files = [];
    const sending = pending.slice();
    if (sending.length) {
      runId = 'pending';
      setRunning(true);
      setStatus(window.GAMJA_I18N.t('attach.uploading', { n: sending.length }));
      try {
        for (const a of sending) {
          const headers = a.file
            ? { 'Content-Type': 'application/octet-stream', 'X-Gamja-File': encodeURIComponent(a.name) }
            : { 'Content-Type': a.blob.type };
          const r = await fetch('/api/upload' + q(), { method: 'POST', headers, body: a.blob });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.code === 'export-running' ? window.GAMJA_I18N.t('export.writeWait') : (d.error || r.statusText));
          (a.file ? files : images).push(d.name);
        }
      } catch (err) {
        runId = null;
        setRunning(false);
        // 원인을 찾을 수 있게 오류 내용을 그대로 보여 준다 (첨부는 그대로 남겨 둠)
        alert(window.GAMJA_I18N.t('attach.uploadFail', { err: err.message }));
        return null;
      }
    }
    text = takeMentions(text); // 그룹 방: 골라 둔 @대화명을 말풍선 앞에 붙인다
    els.input.value = '';
    autoGrow();

    const userMsg = { role: 'user', text, ts: Date.now() };
    if (sending.some((a) => !a.file)) userMsg.localImages = sending.filter((a) => !a.file).map((a) => a.url);
    if (files.length) userMsg.files = files;
    clearAttachments(false);
    addMessage(userMsg);
    scrollBottom(true);
    // 입력창이 줄어들고 "생각 중" 줄이 나타나 높이가 다 자리 잡은 뒤에, 맨 아래로 한 번 더 보낸다 (내 말풍선이 가려지지 않게)
    setTimeout(() => scrollBottom(true), 250);

    let bot = { role: 'bot', text: '', ts: Date.now(), tools: [] };
    let view = addMessage(bot);
    paint(view, bot, true);
    let allText = ''; // 그룹 방: 참여자들의 답을 이름과 함께 모은 것 (읽어 주기·음성 대화용)
    // 그룹 방: 감자알이 알려 준 지금 말하는 참여자로 진행 중 말풍선의 이름을 바꾼다. 이미 답을 받은 말풍선이면 새 말풍선을 연다
    const speaker = (by, summary) => {
      if (!by || (bot.by === by && !bot.text)) return;
      if (bot.text) {
        paint(view, bot, false);
        bot = { role: 'bot', text: '', ts: Date.now(), tools: [] };
        view = addMessage(bot);
      }
      bot.by = by;
      if (summary) bot.summary = true; else delete bot.summary;
      labelRow(view.row, bot);
      paint(view, bot, true);
      if (follow) scrollBottom();
    };
    scrollBottom(true);

    runId = 'pending';
    setRunning(true);
    setStatus('🤔 생각 중...');

    // 글자가 올 때마다 그리면(1초에 최대 60번) 화면이 바빠 ← 같은 버튼이 늦게 눌린다 → 0.15초에 한 번만 그린다
    let raf = 0, paintTimer = 0, lastPaint = 0;
    const doPaint = () => { paintTimer = 0; raf = requestAnimationFrame(() => { raf = 0; lastPaint = Date.now(); paint(view, bot, true); if (follow) scrollBottom(); updateToBottom(); }); };
    const repaint = () => {
      if (raf || paintTimer) return;
      paintTimer = setTimeout(doPaint, Math.max(0, 150 - (Date.now() - lastPaint)));
    };
    let lastWasTool = false;
    let finished = false;
    const sentProject = project;
    let inRoomAtEnd = false; // 답이 끝나는 순간 채팅방 안에 있었는지 (그 직후 ←로 나가도 이 답은 읽은 것으로 친다)
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
        body: JSON.stringify({ message: text, project, images, files, voice: !!opts.voice, lang: window.GAMJA_I18N.lang, brain: brainForSend(), ...groupInfo() }),
        signal: abortCtl.signal,
      });
      if (r.status === 401) { rejected = true; showLogin(); throw new Error('로그인이 필요합니다'); }
      if (!r.ok) { rejected = true; const ed = await r.json().catch(() => ({})); throw new Error(ed.code === 'export-running' ? window.GAMJA_I18N.t('export.writeWait') : (ed.error || r.statusText)); }

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
              if (d.sessionId) { sessionId = d.sessionId; }
              break;
            case 'delta':
              if (d.turn) { // 그룹 방: 참여자 한 명의 답 전체
                speaker(d.by, bot.summary);
                bot.text = d.text;
                const mem = (roomGroup(project) || []).find((x) => x.id === d.by);
                allText += `${mem ? mem.nick + ': ' : ''}${d.text}\n\n`;
                repaint();
                break;
              }
              if (lastWasTool && bot.text && !bot.text.endsWith('\n\n')) bot.text += '\n\n';
              lastWasTool = false;
              bot.text += d.text;
              setStatus('✍️ 답변 작성 중...');
              repaint();
              break;
            case 'status':
              if (d.by) speaker(d.by, d.summary);
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
              if (d.sessionId) { sessionId = d.sessionId; }
              bot.meta = d.meta || ''; // 서버가 만든 "시간 · 토큰" 표시
              if (d.install) bot.install = d.install;
              if (d.denied) bot.denied = d.denied;
              if (d.blocked) bot.blocked = d.blocked;
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
      clearTimeout(paintTimer);
      inRoomAtEnd = tab === null && !document.hidden;
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
    // 답이 끝날 때 방 안에서 보고 있었는데, 기록을 다시 받는 사이 채팅 목록으로 나갔으면 여기서 읽음 처리한다
    if (finished && inRoomAtEnd && tab !== null && project === sentProject) markSeen();
    // 검사 실패 시 서버가 곧바로 자동 후속 실행을 시작하므로 한 번 더 확인
    setTimeout(() => { if (!runId && !remoteRunId && !awaitingRestart) loadConversation(); }, 1500);
    const said = allText.trim() || bot.text;
    if (!opts.voice && ttsOn && finished && said && !errorMsg) speak(said, false, [...els.messages.querySelectorAll('.row.bot .bubble')].pop()); // 음성 대화 모드는 직접 읽어 줌
    return { text: said, finished, error: errorMsg };
  }

  async function stopRun() {
    stoppingId = runId && runId !== 'pending' ? runId : runId ? '*' : remoteRunId;
    if (!runId && remoteRunId) { // 다른 기기(또는 끊긴 연결)에서 진행 중인 응답 중지
      const rid = remoteRunId;
      remoteRunId = null; liveView = null; setRunning(false); loadConversation();
      await api('/api/stop', { runId: rid }).catch(() => {});
      return;
    }
    const id = runId;
    // 서버에 중지를 알리되 응답을 기다리지 않고, 클라이언트 쪽도 바로 끊는다 (딜레이 없이)
    const sent = (id && id !== 'pending') ? api('/api/stop', { runId: id }).catch(() => {}) : null;
    if (abortCtl && runId === id) abortCtl.abort();
    if (sent) await sent;
  }

  // 오른쪽 버튼: 응답 중 ■ 중지 / 입력이 비어 있으면 🗣 음성 대화 모드 / 아니면 ➤ 보내기
  // ■를 눌러도 바로 멈추지 않고, 바텀시트로 한 번 더 묻는다. 묻는 사이에 답변이 끝나면 시트를 닫는다
  // 크루가 일하는 중이면 마지막 크루 말풍선 오른쪽에 빨간 ■ 중지 버튼을 붙인다 (음성 대화 중에는 숨김)
  function syncStopBtn() {
    let b = document.getElementById('bubbleStop');
    const rows = els.messages.querySelectorAll('.row.bot:not(.error) .line');
    const line = rows[rows.length - 1];
    if (!(runId || remoteRunId) || voice.on || !line || (line.querySelector('.bubble')?.textContent || '').trim()) { // 크루가 답을 쓰기 시작하면(생각 중이 끝나면) 숨김
      if (b) b.remove();
      els.messages.querySelectorAll('.line.has-stop').forEach((l) => l.classList.remove('has-stop'));
      return;
    }
    if (!b) {
      b = document.createElement('button');
      b.id = 'bubbleStop'; b.type = 'button'; b.className = 'bubble-stop'; b.textContent = '■';
      b.title = window.GAMJA_I18N.t('stop.title');
      b.onclick = () => confirmStop();
    }
    els.messages.querySelectorAll('.line.has-stop').forEach((l) => { if (l !== line) l.classList.remove('has-stop'); });
    line.classList.add('has-stop'); // 말풍선 바로 오른쪽에 나란히 (CSS)
    if (b.parentNode !== line) line.appendChild(b);
  }
  let stopAsking = false;
  async function confirmStop(thenStop = true) {
    if (stopAsking) return false;
    stopAsking = true;
    const T = window.GAMJA_I18N.t;
    const p = gSheet({ title: T('stop.title'), message: T('stop.msg'), ok: T('stop.ok'), cancel: T('stop.cancel'), danger: true });
    const mine = gsOpen;
    const watch = setInterval(() => { if (!runId && !remoteRunId && mine && gsOpen === mine) mine.close(false); }, 500);
    let yes = false;
    try { yes = await p; } finally { clearInterval(watch); stopAsking = false; }
    if (yes && thenStop && (runId || remoteRunId)) stopRun();
    return yes;
  }
  let endAsking = false;
  async function confirmEndVoice() {
    if (endAsking) return;
    endAsking = true;
    const T = window.GAMJA_I18N.t;
    let yes = false;
    try { yes = await gSheet({ title: T('voice.endTitle'), message: T('voice.endMsg'), ok: T('voice.end'), cancel: T('voice.keep'), danger: true }); } finally { endAsking = false; }
    if (yes && voice.on) stopVoice();
  }
  els.send.onclick = () => {
    if (voice.on) return stopVoice(); // 확인 없이 바로 종료. 음성 대화 끝내기는 크루의 작업을 멈추지 않는다
    if (els.send.dataset.mode === 'voice') return startVoice(); // 크루가 생각 중이어도 음성 대화를 시작할 수 있다
    if (runId || remoteRunId) return confirmStop();
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
  // 사진(PNG·JPG·WEBP·GIF)은 미리보기와 함께 이미지로, 그 밖의 파일은 원래 이름 그대로 파일로 보낸다
  const MAX_FILE_BYTES = 50e6, MAX_VIDEO_BYTES = 100e6; // 영상(화면 녹화 등)은 100MB까지
  const VIDEO_EXT = /\.(mp4|m4v|mov|avi|mkv|webm|3gp|3g2|wmv|flv|mpe?g|m2ts|hevc)$/i;
  const isVideo = (f) => /^video\//.test(f.type || '') || VIDEO_EXT.test(f.name || '');
  async function prepareImage(file) {
    const T = window.GAMJA_I18N.t;
    if (isVideo(file) ? file.size > MAX_VIDEO_BYTES : file.size > MAX_FILE_BYTES) throw new Error(T(isVideo(file) ? 'attach.tooBigVideo' : 'attach.tooBig'));
    let bytes;
    try { bytes = new Uint8Array(await file.arrayBuffer()); }
    catch { throw new Error(T('attach.readFail')); }
    if (!bytes.length) throw new Error(T('attach.empty'));
    const type = sniffType(bytes);
    if (!type || type === 'heic') {
      return { file: true, name: file.name || 'file', blob: new Blob([bytes], { type: 'application/octet-stream' }), url: null };
    }
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
  const overLimitText = () => window.GAMJA_I18N.t('attach.limit', { n: MAX_IMAGES });
  async function addAttachments(files) {
    files = files.filter(Boolean);
    const room = MAX_IMAGES - pending.length - attachPrep.count;
    if (files.length > Math.max(room, 0)) toast(overLimitText());
    const list = files.slice(0, Math.max(room, 0));
    if (!list.length) return;
    attachPrep.count += list.length;
    const job = (async () => {
      for (const f of list) {
        try {
          pending.push(await prepareImage(f));
        } catch (err) {
          alert(`${f.name ? `'${f.name}': ` : ''}${err.message}`);
        } finally {
          attachPrep.count--;
        }
      }
    })();
    attachPrep.jobs.add(job);
    updateSendState();
    try { await job; } finally {
      attachPrep.jobs.delete(job);
      renderAttachments();
    }
  }
  function renderAttachments() {
    attachBox.innerHTML = '';
    attachBox.classList.toggle('hidden', !pending.length);
    updateSendState();
    pending.forEach((a, i) => {
      const item = document.createElement('div');
      item.className = 'attach';
      if (a.file) {
        item.classList.add('attach-file');
        item.innerHTML = `<span class="attach-file-name" data-no-i18n></span><button type="button" title="빼기">✕</button>`;
        item.querySelector('span').textContent = '📄 ' + a.name;
      } else {
        item.innerHTML = `<img alt="첨부 미리보기"><button type="button" title="빼기">✕</button>`;
        item.querySelector('img').src = a.url;
        item.querySelector('img').onclick = () => openPhoto(a.url);
      }
      item.querySelector('button').onclick = () => {
        if (a.url) URL.revokeObjectURL(a.url);
        pending.splice(i, 1);
        renderAttachments();
      };
      attachBox.appendChild(item);
    });
    autoGrow(); // 미리보기 높이만큼 입력창 상한을 다시 계산한다
  }
  function clearAttachments(revoke = true) {
    if (revoke) pending.forEach((a) => a.url && URL.revokeObjectURL(a.url));
    pending = [];
    renderAttachments();
  }
  // ＋: 사진(갤러리)·파일 고르기 메뉴. 안드로이드는 형식 제한이 없으면 파일 앱만 열리므로 사진 칸을 따로 둔다
  const attachMenu = $('attachMenu');
  const photoInput = $('photoInput');
  const iosInput = $('iosInput');
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const closeAttachMenu = () => attachMenu.classList.add('hidden');
  $('attachBtn').onclick = (e) => {
    e.stopPropagation();
    if (pending.length >= MAX_IMAGES) return toast(overLimitText());
    if (isIOS) return iosInput.click(); // 아이폰은 자체 메뉴가 사진·파일을 다 보여 주므로 감자 메뉴를 건너뛴다
    attachMenu.classList.toggle('hidden');
  };
  $('attachPhotoBtn').textContent = window.GAMJA_I18N.t('attach.photo');
  $('attachFileBtn').textContent = window.GAMJA_I18N.t('attach.file');
  $('attachPhotoBtn').onclick = () => { closeAttachMenu(); photoInput.click(); };
  $('attachFileBtn').onclick = () => { closeAttachMenu(); fileInput.click(); };
  document.addEventListener('click', (e) => { if (!attachMenu.contains(e.target)) closeAttachMenu(); });
  const onPicked = (input) => () => {
    const all = [...input.files];
    input.value = '';
    if (!all.length) return toast(window.GAMJA_I18N.t('attach.noneReceived'));
    addAttachments(all).catch((err) => toast(window.GAMJA_I18N.t('attach.addFail', { err: err.message })));
  };
  photoInput.onchange = onPicked(photoInput);
  fileInput.onchange = onPicked(fileInput);
  iosInput.onchange = onPicked(iosInput);
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
  // 키보드가 올라와 있는지: 입력칸에 포커스가 있고, 보이는 화면 높이가 평소보다 크게 줄었을 때.
  // 안드로이드에서 뒤로 가기로 키보드를 닫으면 포커스가 그대로 남으므로 포커스만으로는 판단하지 않는다
  let fullH = vv ? vv.height : window.innerHeight;
  function keyboardUp() {
    const h = vv ? vv.height : window.innerHeight;
    const focused = document.activeElement === els.input;
    if (!focused || h > fullH) fullH = h; // 키보드가 없을 때의 높이를 기억 (화면을 돌리면 다시 잰다)
    if (!focused) return false;
    if (!vv) return true;
    return h < fullH - 120;
  }
  addEventListener('orientationchange', () => { fullH = 0; });
  function autoGrow() {
    const el = els.input;
    // 높이를 재려고 입력창을 잠깐 한 줄로 줄이면 대화 영역이 그 순간 커지면서 브라우저가 맨 아래 스크롤을 스스로 줄여 버린다.
    // 입력창이 두 줄 이상일 때 타이핑할 때마다 화면이 조금씩 위로 올라가던 원인이라, 맨 아래까지 남은 거리를 기억해 두었다가 되돌려 놓는다
    const m = els.messages;
    const dist = m.scrollHeight - m.scrollTop - m.clientHeight;
    // 키보드가 올라와 입력 중이면 입력칸이 한 줄 위로 올라가고, 비어 있는 채로 키보드를 닫으면 다시 한 줄로 내려온다
    const lifted = keyboardUp();
    composerBox.classList.toggle('kbd', lifted); // 키보드가 올라와 있으면 사용량 게이지를 숨긴다
    if (lifted || mentionOpen) composerBox.classList.add('multiline'); // @ 참여자 줄을 펼쳤을 때도 버튼 줄을 아래로 내려 자리를 만든다
    else if (!el.value) composerBox.classList.remove('multiline');
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight);
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    // 키보드가 올라와 화면이 낮을 때(또는 사진 미리보기가 있을 때)는 입력창이 화면 밖으로 밀려나지 않게 높이 상한을 낮춘다
    const appH = vv ? vv.height : window.innerHeight;
    const ab = $('attachments');
    const attachH = ab && !ab.classList.contains('hidden') ? ab.offsetHeight : 0;
    const room = Math.floor(appH - 225 - attachH);
    const max = Math.max(Math.ceil(line * 2 + pad), Math.min(Math.ceil(line * MAX_LINES + pad), room));
    el.style.height = 'auto';
    let h = el.scrollHeight;
    // 음성 대화 중 비어 있을 때는 안내 글(placeholder)이 줄바꿈돼도 두 줄로 치지 않는다
    const voiceEmpty = composerBox.classList.contains('voice-live') && !el.value;
    if (voiceEmpty) h = line + pad;
    if (!voiceEmpty && h > line * 1.5 + pad && !composerBox.classList.contains('multiline')) {
      composerBox.classList.add('multiline'); // 넓어진 폭으로 다시 잰다
      h = el.scrollHeight;
    }
    // 한 줄이면 비어 있든 글이 있든 항상 같은 높이로 (scrollHeight는 정수로 반올림돼 36.4가 36이 되어 1px씩 달라진다)
    if (!composerBox.classList.contains('multiline') && h <= line * 1.5 + pad) h = line + pad;
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
    // 새로고침 직후(화면 크기 변화 등으로 autoGrow가 먼저 불릴 때) 빈 입력칸이 저장된 글을 지우던 문제를 막는다
    if (!draftReady) return;
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
    refreshUsage(true); // 채팅방에 들어올 때 사용량 (같은 두뇌면 지난 값부터 바로)
  }
  // ---------- 사용량: 입력 줄 바탕 두 줄(위 5시간·아래 주간) + 게이지 버튼 + 사용량 보기(켜짐/꺼짐) ----------
  // 이 방 두뇌(Claude/Codex)의 지금 계정 기준. 바탕색 두 줄은 늘 보이고, 게이지를 누르면 입력창 대신 글자 두 줄과 [변경]이 나온다(상태는 기억).
  // 채팅방을 볼 때(enter): 이 두뇌의 지난 값이 있으면 바로 보여 주고 뒤에서 새로 받는다. 없으면(처음·계정을 바꿈) 받는 동안 빛이 훑고 지나간다(최소 1.4초).
  // 그 밖에는 1분마다 조용히 새로 받는다. 로그인 전·계정이 없으면 아무것도 안 보인다
  var USAGE_SWEEP = 1400; // style.css의 usageShimmer 한 번 길이와 같게
  var usageBusy = false, usageRoom = null; // var: 앱이 켜지는 중 이 줄보다 먼저 불려도 오류가 안 나게
  const usageColorOf = (p) => (p >= 90 ? '#e0533c' : p >= 70 ? '#e08a3c' : 'var(--gs-acc, var(--me))'); // 시트 안에서는 밝은 화면용 진한 금색
  const usageCache = () => store.get('cc:usageCache', {}) || {};
  var uvOn = false; // 사용량 보기를 켰는지 (채팅방을 나가면 꺼서 다시 들어오면 입력창이 보이게)
  function usageViewOn() { return uvOn; }
  // "세션 72% 사용 3시간 후 초기화" / "주간 40% 사용 2일 후 초기화" (남은 시간: 하루↑ 일, 1시간↑ 시간, 아니면 분)
  function usageLeft(u) {
    const ms = new Date(u.resetsAt) - Date.now(), T = window.GAMJA_I18N.t;
    if (!u.resetsAt || !(ms > 0)) return '';
    const m = Math.ceil(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    return T('uv.reset', { t: d >= 1 ? T('uv.days', { n: d }) : h >= 1 ? T('uv.hours', { n: h }) : T('uv.mins', { n: m }) });
  }
  function usageLine(el, u, week) {
    const T = window.GAMJA_I18N.t, label = T(week ? 'uv.w' : 'uv.d');
    el.textContent = ''; el.className = '';
    if (!u || typeof u.pct !== 'number' || u.idle) { el.className = 'muted'; el.textContent = label + ' ' + T(u ? 'uv.none' : 'uv.unknown'); return; }
    const b = document.createElement('b');
    b.textContent = T('uv.used', { p: u.pct });
    if (u.pct >= 90) b.className = 'full'; else if (u.pct >= 70) b.className = 'hot';
    const left = usageLeft(u);
    el.append(label, b, left);
  }
  function paintUsage(r) {
    const bar = document.querySelector('.composer'), btn = $('usageBtn');
    usageRoom = r && (r.accounts || []).length ? r : null;
    const has = !!usageRoom, now = (r && r.now) || {}, d = now.d, w = now.w;
    // stale: 지금 값을 못 받아 마지막으로 받은 값을 보여 주는 중 → 글자·막대를 회색으로
    const stale = !!now.stale, usageColor = stale ? () => '#6b6455' : usageColorOf;
    $('usageView').classList.toggle('stale', stale);
    const dp = d && typeof d.pct === 'number' && !d.idle ? Math.max(0, Math.min(100, d.pct)) : 0;
    const wp = w && typeof w.pct === 'number' ? Math.max(0, Math.min(100, w.pct)) : 0;
    bar.classList.toggle('usage', has);
    bar.style.setProperty('--u', dp + '%'); bar.style.setProperty('--uc', usageColor(dp));
    bar.style.setProperty('--w', wp + '%'); bar.style.setProperty('--wc', usageColor(wp));
    btn.style.setProperty('--g', (-90 + dp * 1.8) + 'deg');
    btn.classList.toggle('full', dp >= 90);
    btn.classList.toggle('hidden', !has);
    $('uvSwitch').classList.toggle('full', dp >= 90);
    $('uvSwitch').textContent = window.GAMJA_I18N.t('uv.switch');
    usageLine($('uvD'), d, false); usageLine($('uvW'), w, true);
    setUsageView(has && usageViewOn());
  }
  function setUsageView(on) {
    const bar = document.querySelector('.composer');
    bar.classList.toggle('uv-on', on);
    $('usageView').classList.toggle('hidden', !on);
    $('usageBtn').classList.toggle('on', on);
    // 키보드가 떠 있으면 버튼들이 입력칸 아래 줄에 있다가 키보드가 다 내려간 뒤에야 제 줄로 올라와서 늦게 올라오는 것처럼 보였다.
    // 글이 없으면 키보드를 기다리지 않고 바로 한 줄 모양으로 바꾼다 (버튼을 누르는 순간 입력칸 포커스가 이미 빠져 있을 수도 있다)
    if (on && document.activeElement === els.input) els.input.blur();
    const cb = $('composerBox');
    if (on && !els.input.value && cb.classList.contains('multiline')) { cb.classList.remove('multiline'); autoGrow(); }
  }
  async function refreshUsage(enter) {
    if (document.hidden || usageBusy) return;
    usageBusy = true;
    const room = project;
    try {
      const bar = document.querySelector('.composer');
      let loadingSince = 0;
      if (enter) {
        const c = usageCache(), last = c.rooms && c.brains && c.brains[c.rooms[room]];
        if (last) paintUsage(last);
        else { bar.classList.remove('usage'); bar.classList.add('usage-loading'); loadingSince = Date.now(); }
      }
      let r = null;
      try { r = await api('/api/usage/room?room=' + encodeURIComponent(room)); } catch {}
      if (loadingSince) { const left = USAGE_SWEEP - (Date.now() - loadingSince); if (left > 0) await new Promise((ok) => setTimeout(ok, left)); }
      bar.classList.remove('usage-loading');
      if (room !== project) return; // 그사이 다른 방으로 감 (그 방이 다시 부른다)
      if (!r) { if (loadingSince) paintUsage(null); return; }
      paintUsage(r);
      const c = usageCache();
      c.rooms = { ...(c.rooms || {}), [room]: r.brain };
      c.brains = { ...(c.brains || {}), [r.brain]: r.now ? r : null };
      store.set('cc:usageCache', c);
    } finally { usageBusy = false; }
  }
  function forgetUsage(brain) { const c = usageCache(); if (c.brains) { delete c.brains[brain]; store.set('cc:usageCache', c); } }
  // 손가락을 떼야 오는 click 대신 닿는 순간(pointerdown)에 바로 켜고 끈다 (click을 기다리면 한 박자 늦게 보였다). 키보드로 누를 때(detail 0)만 click으로
  const toggleUsageView = () => { uvOn = !uvOn; setUsageView(uvOn && !!usageRoom); };
  $('usageBtn').addEventListener('pointerdown', (e) => { if (e.button) return; e.preventDefault(); toggleUsageView(); });
  $('usageBtn').onclick = (e) => { if (e.detail === 0) toggleUsageView(); };
  // [변경]: 두뇌 탭(이 방 두뇌 먼저)이 있는 계정 시트
  $('uvSwitch').onclick = () => { if (usageRoom) openAcctSheet(usageRoom); };
  function usageWhen(u, withDate) { // 계정 시트의 초기화 시각 (짧게)
    const d = new Date(u && u.resetsAt), p2 = (n) => String(n).padStart(2, '0');
    return isNaN(d) || !u.resetsAt ? '' : (withDate ? `${d.getMonth() + 1}/${d.getDate()} ` : '') + `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }
  // 계정 변경 시트: 위의 알약에서 두뇌(연결된 것만)를 고르고, 아래 목록에서 계정을 누르면 바로 그 계정으로 바뀐다
  function openAcctSheet(r) {
    const T = window.GAMJA_I18N.t, NAME = { claude: 'Claude', codex: 'Codex' };
    const home = r.brain === 'codex' ? 'codex' : 'claude', other = home === 'codex' ? 'claude' : 'codex';
    if (gsOpen) gsOpen.close(false);
    const bg = document.createElement('div');
    bg.className = 'gs-bg';
    bg.innerHTML = '<div class="gs acct-gs" role="dialog" aria-modal="true"><h2></h2><p class="ag-sub"></p><div class="acct-sheet"></div><div class="gs-btns"><button class="gs-cancel" type="button"></button></div></div>';
    bg.querySelector('h2').textContent = T('ag.title');
    bg.querySelector('.ag-sub').textContent = T('ag.sub');
    bg.querySelector('.gs-cancel').textContent = T('sheet.close');
    const list = bg.querySelector('.acct-sheet');
    // 이 방 두뇌는 말풍선이 받아 둔 계정 목록으로 바로 그리고, 계정별 사용량은 뒤에서 채운다
    const data = { [home]: { ready: true, accounts: r.accounts || [], usage: r.usage || null } };
    let busy = false;
    const close = () => {
      if (!bg.isConnected || bg.classList.contains('out')) return;
      bg.classList.add('out');
      setTimeout(() => bg.remove(), 160);
      if (gsOpen && gsOpen.bg === bg) gsOpen = null;
    };
    const load = (b) => api('/api/usage/accounts?brain=' + b)
      .then((d) => { data[b] = d; })
      .catch(() => { if (data[b]) data[b].usage = data[b].usage || {}; })
      .finally(() => { if (bg.isConnected) draw(); });
    async function pick(brain, a) {
      if (busy) return;
      const room = project;
      // 다른 두뇌의 계정: 대화를 시작한 방은 두뇌를 바꿀 수 없어서 그 두뇌로 새 채팅방을 연다 (시작 전인 방은 이 방의 두뇌를 바꾼다)
      // 두뇌 정보가 없는 예전 방(roomAgent null)은 대화가 있으면(빈 화면이 아니면) 시작한 방으로 본다 (감자알이 늘 Claude로 돌린다)
      const started = roomAgent ? !!roomAgent.locked : !els.messages.querySelector('.empty');
      const newRoom = brain !== home && started;
      if (newRoom) {
        const ok = await gSheet({ title: T('ag.newRoomTitle', { brain: NAME[brain] }), message: T('ag.newRoomMsg', { from: NAME[home], brain: NAME[brain], email: a.email }), ok: T('ag.newRoomOk') });
        if (!ok) return;
      }
      busy = true;
      try {
        if (brain === 'codex') await api('/api/auth/codex', { action: 'switch', id: a.id });
        else await api('/api/auth/claude/accounts', { action: 'switch', id: a.id });
        if (brain !== home && !newRoom) {
          store.set('cc:lastBrain', brain);
          if (roomAgent && room === project) roomAgent = (await api('/api/room-agent', { room, brain })).agent;
        }
      } catch (err) { busy = false; return toast(err.message); }
      close();
      if (newRoom) {
        if (uvOn) { uvOn = false; setUsageView(false); }
        if (brain === 'codex') refreshAi();
        forgetUsage(brain);
        store.set('cc:lastBrain', brain);
        const crew = crewOf(room);
        if (!crew || !ROOM_CREATE_ENABLED) { openNewChat(); ncBrain = brain; renderNcForm(); return; } // 크루를 모르는 방(그룹 방 등)은 새 채팅 화면에서 고르게
        let nr;
        try { nr = await api('/api/rooms', { crews: [crew], brain }); } catch (err) { return toast(err.message); }
        window.gaTrack('new_chat', { kind: 'crew' });
        rememberRoomCrew(nr.room, crew);
        const titles = getRoomTitles();
        titles[nr.room] = defaultRoomTitle(crew);
        store.set('cc:roomTitle', titles);
        toast(T('ag.switchedTo', { email: a.email }));
        selectProject(nr.room);
        return;
      }
      if (uvOn) { uvOn = false; setUsageView(false); } // 계정을 바꾸면 사용량 보기를 끄고 입력창으로
      toast(T('ag.switchedTo', { email: a.email }), T('ag.appliesAll', { brain: NAME[brain] }));
      if (brain === 'codex') refreshAi();
      forgetUsage(brain);
      refreshUsage(true); // 입력 줄 바탕: 새 계정이라 불러오는 중 빛
    }
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    // 시안3: 두뇌 구분 없이 한 목록 (이 방 두뇌 먼저). 계정마다 두뇌 칩을 붙이고, 체크는 이 방 두뇌에서 쓰는 계정 하나만
    function draw() {
      list.textContent = '';
      for (const b of [home, other]) {
        const d = data[b];
        if (!d || !d.ready) continue; // 연결된 두뇌만
        for (const a of d.accounts) {
          const on = b === home && a.active;
          const row = el('button', 'acct-row' + (on ? ' on' : ''));
          row.type = 'button';
          row.append(el('span', 'ar-check'));
          const info = el('span', 'ar-info');
          const top = el('span', 'ar-top');
          top.append(el('span', 'ar-brain ' + b, NAME[b]));
          if (a.plan) top.append(el('small', '', a.plan));
          info.append(top, el('b', '', a.email));
          row.append(info);
          const u = d.usage ? d.usage[a.id] : undefined, x = u && u.d;
          const use = el('span', 'ar-use');
          use.append(el('small', on ? 'ar-on' : '', on ? T('ag.inUse') : '\u00a0'));
          if (x) { const pct = el('b', '', `${T('uv.d')} ${x.pct}%`); pct.style.color = usageColorOf(x.pct); use.append(pct); }
          else use.append(el('b', 'ar-none', d.usage ? '–' : '…'));
          row.append(use);
          if (!on) row.onclick = () => pick(b, a);
          list.append(row);
        }
      }
    }
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('.gs-cancel')) close(); });
    document.body.appendChild(bg);
    gsOpen = { bg, close };
    draw();
    load(home); // 계정별 사용량 (Claude는 계정마다 물어봐서 조금 걸린다)
    load(other); // 다른 두뇌가 연결돼 있으면 그 계정들이 목록 아래에 붙는다
  }

  refreshUsage(true);
  setInterval(() => refreshUsage(false), 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshUsage(true); });
  els.input.addEventListener('input', () => { lastTypeAt = Date.now(); autoGrow(); updateSendState(); });
  els.input.addEventListener('focus', () => setTimeout(autoGrow, 50));
  if (vv) vv.addEventListener('resize', () => composerBox.classList.toggle('kbd', keyboardUp())); // 뒤로 가기로 키보드만 닫을 때도 게이지가 다시 나오게
  els.input.addEventListener('blur', () => setTimeout(autoGrow, 50));
  (vv || window).addEventListener('resize', autoGrow); // 키보드가 올라오거나 내려가면 상한을 다시 계산한다
  // 뒤로 가기 등으로 키보드만 내리면 입력칸에 포커스가 남아 커서가 계속 깜빡인다. 키보드가 내려간 것을 보면 포커스를 뺀다 (쓰던 글은 그대로)
  let kbWasUp = false;
  (vv || window).addEventListener('resize', () => {
    const up = keyboardUp();
    if (kbWasUp && !up && document.activeElement === els.input) {
      // @를 펼쳐 놓고 글도 안 쓰고 대화명도 안 고른 채 키보드를 내리면 @를 끄고 처음 한 줄 모양으로 돌아간다
      if (mentionOpen && !els.input.value.trim() && !mentionSel.size) { mentionOpen = false; renderMentionBar(true); }
      els.input.blur();
      autoGrow();
    }
    kbWasUp = up;
  });
  els.input.addEventListener('blur', (e) => {
    kbWasUp = false;
    // 대화창 등 입력창 밖을 눌러 포커스가 빠질 때도, @만 펼쳐 놓은 빈 상태면 @를 끄고 처음 한 줄 모양으로 (입력창 안의 버튼으로 옮겨 가는 건 그대로)
    const box = els.input.closest('.composer-box');
    if (box && e.relatedTarget && box.contains(e.relatedTarget)) return;
    if (mentionOpen && !els.input.value.trim() && !mentionSel.size) { mentionOpen = false; renderMentionBar(true); setTimeout(autoGrow, 50); }
  });
  // 스크롤바는 스크롤하는 동안만 얇게 보인다
  let scrollHide = 0;
  els.input.addEventListener('scroll', () => {
    els.input.classList.add('scrolling');
    clearTimeout(scrollHide);
    scrollHide = setTimeout(() => els.input.classList.remove('scrolling'), 800);
  });
  // 음성 입력 가능 여부: 브라우저에 음성 인식이 있고, 보안 연결(https 또는 127.0.0.1)이어야 마이크를 쓸 수 있다.
  // 와이파이 주소(http://192.168…)로 열면 브라우저가 마이크를 막는다. 막히면 🎤는 빗금 마이크로, 🗣는 ➤로 바꿔 보여 준다.
  const hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const secureOk = window.isSecureContext !== false;
  const micUsable = hasSR && secureOk;
  // 마이크를 쓸 수 없을 때 이유를 알려 주는 시트 (🎤·🗣를 눌렀을 때)
  function showMicOff() {
    const T = window.GAMJA_I18N.t;
    const why = !secureOk ? T('mic.off.insecure', { url: `127.0.0.1:${location.port || 80}` }) : T('mic.off.unsupported');
    gSheet({ title: T('mic.off.title'), message: `${why}\n\n${T('mic.off.kbd')}`, ok: T('mic.off.ok'), alertOnly: true });
  }
  // 오른쪽 버튼 모양: 응답 중 ■(setRunning이 처리) / 입력이 비면 🗣 음성 대화(쓸 수 있는 곳만) / 아니면 ➤
  function updateSendState() {
    if (voice.on) { // 음성 대화 중: 이 버튼은 음성 대화 끄기
      syncStopBtn();
      els.send.dataset.mode = 'voiceon'; els.send.classList.add('voice-btn'); els.send.textContent = '⏹';
      els.send.title = '음성 대화 끄기'; els.send.disabled = false;
      els.send.classList.remove('stop');
      return;
    }
    syncStopBtn();
    const running = !!(runId || remoteRunId);
    const hasContent = !!(els.input.value.trim() || pending.length || attachPrep.jobs.size);
    $('composerBox').classList.toggle('typing', !!els.input.value); // 글을 쓰는 중에는 사용량 게이지를 숨긴다 (크루가 생각하는 중에는 보인다)
    els.send.classList.remove('stop');
    const voiceOk = !hasContent && micUsable && !!window.speechSynthesis;
    els.send.dataset.mode = voiceOk ? 'voice' : 'send';
    els.send.classList.toggle('voice-btn', voiceOk);
    els.send.textContent = voiceOk ? '🗣' : '➤';
    els.send.title = voiceOk ? '음성 대화' : '전송';
    els.send.classList.toggle('wait', running && hasContent); // 생각 중에 글을 쓰면 회색(보낼 수 없음)
    els.send.disabled = (!hasContent && !voiceOk) || (running && !voiceOk) || els.input.disabled; // 일하는 중·입력이 막힌 방(AI 미연결 등)에서는 보낼 수 없다
  }

  // ---------- 음성 입력 (Web Speech API, ko-KR) ----------
  // 안드로이드 크롬은 연속 모드(continuous)에서 앞 문장을 포함한 결과를 반복해서 돌려줘 같은 말이 겹쳐 붙는다.
  // → 한 문장씩 듣고(continuous=false) 확정된 문장만 입력창에 붙인 뒤 자동으로 다시 듣는다. 🎤를 다시 누르면 멈춤.
  //   확정 전 중간 결과는 입력창이 아니라 그 위의 회색 줄에만 보여 준다.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const interimBox = $('interim');
  let rec = null, wantListen = false, lastFinal = '', silentRuns = 0;
  if (!micUsable) { // 쓸 수 없는 곳: 빗금 마이크 (누르면 이유 안내)
    els.mic.title = window.GAMJA_I18N.t('mic.off.title');
    els.mic.classList.add('mic-off');
    els.mic.textContent = '🚫'; // icons.js가 빗금 마이크로 바꿔 끼운다
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
        if (await gSheet({ title: '마이크 권한이 필요해요', message: window.GAMJA_I18N.trText('폰의 음성 인식 서비스(Google 앱)에 마이크 권한이 필요해요.\n그 앱의 설정 화면을 열까요?\n(권한 → 마이크 → 허용)') + diag, ok: '설정 열기' })) app.recognizerSettings();
      } else alert(window.GAMJA_I18N.trText('폰의 음성 인식 서비스(Google 앱)에 마이크 권한이 없어요. 폰 설정 → 앱 → Google → 권한에서 마이크를 허용해 주세요.') + diag);
      return;
    }
    if (app && typeof app.appSettings !== 'undefined') {
      if (await gSheet({ title: '마이크를 허용해 주세요', message: window.GAMJA_I18N.trText('음성을 쓰려면 마이크를 허용해야 해요.\n폰의 GAMJA 앱 설정 화면을 열까요?\n(권한 → 마이크 → 허용)') + diag, ok: '설정 열기' })) app.appSettings();
    } else if (app) alert(window.GAMJA_I18N.trText('마이크 권한이 없어요. 폰 설정 → 앱 → GAMJA → 권한에서 마이크를 허용해 주세요.') + diag);
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
  // 키보드를 올리고 글을 쓰다가 🎤를 눌러도 입력칸에서 포커스가 빠지지 않게 (키보드는 그대로, 받아쓴 말은 쓰던 글 끝에 이어 붙는다)
  els.mic.addEventListener('pointerdown', (e) => { if (document.activeElement === els.input) e.preventDefault(); });
  els.mic.onclick = () => {
    if (voice.on) { if (voiceTap) voiceTap(); return; } // 음성 대화 중: 마이크 버튼이 예전의 원 (바로 보내기·끊기·다시 듣기)
    if (!micUsable) return showMicOff();
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
    if ($('setTts')) $('setTts').checked = gTts(); // 더보기의 스위치는 앱 기본값
    const b = $('ttsBtn'); // ⋯ 메뉴는 이 방의 설정
    b.textContent = ttsOn ? '🔊 답변 읽어주기: 켜짐' : '🔇 답변 읽어주기: 꺼짐';
    b.setAttribute('aria-pressed', String(ttsOn));
    b.style.opacity = synth ? '' : '.35';
  }
  // scope 'room': ⋯ 메뉴에서 바꾸면 이 방만, 'global': 더보기에서 바꾸면 앱 기본값
  function setTtsOn(on, scope = 'room') {
    if (on && !synth) { renderTts(); return alert('이 브라우저는 음성 합성을 지원하지 않아요.'); }
    if (scope === 'room') setRoomPref('tts', on);
    else { store.set('cc:tts', on); applyPrefs(); }
    if (on) { const w = new SpeechSynthesisUtterance(' '); w.volume = 0; synth.speak(w); } // iOS: 사용자 동작으로 잠금 해제
    else stopSpeaking();
    toast((on ? '🔊 답변을 읽어 드릴게요' : '🔇 읽어주기를 껐어요') + (scope === 'room' ? window.GAMJA_I18N.t('room.prefsOnly') : ''));
  }
  renderTts();
  if ($('setTts')) $('setTts').onchange = (e) => setTtsOn(e.target.checked, 'global');
  $('ttsBtn').onclick = () => { els.menu.classList.add('hidden'); setTtsOn(!ttsOn, 'room'); };
  function stopSpeaking() {
    if (typeof readerClose === 'function' && reader.chunks.length) readerClose();
    if (synth) synth.cancel();
  }
  function toSpeech(md) {
    return md
      .replace(/```[\s\S]*?(```|$)/g, ` ${window.GAMJA_I18N.trText('코드 블록 생략.')} `)
      .replace(/(?:^[ \t]*\|.*(?:\n|$))+/gm, ` ${window.GAMJA_I18N.t('voice.table')}\n`) // 표는 소리로 읽어도 알아듣기 어려워서 채팅을 보라고 안내한다
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, ` ${window.GAMJA_I18N.trText('링크')} `)
      .replace(/^\s*[#>|-]+\s*/gm, '')
      .replace(/[*_~|]/g, '')
      .replace(/\n{2,}/g, '. ')
      .trim();
  }
  // 목소리 고르기: 폰에 설치된 목소리 중 화면 언어와 같은 것만 보여 주고, 고른 것은 기억한다 (온라인 목소리가 대체로 더 자연스럽다)
  let ttsRate = Number(store.get('cc:ttsRate', 1.05)) || 1.05;
  const voiceBase = () => LOCALE.slice(0, 2);
  const voiceList = () => (synth ? synth.getVoices() : []).filter((v) => v.lang && v.lang.replace('_', '-').toLowerCase().startsWith(voiceBase()))
    .sort((a, b) => (a.localService === b.localService ? a.name.localeCompare(b.name) : a.localService ? 1 : -1));
  // 목소리 id로 폰에 설치된 목소리 찾기 (다른 기기에서 정한 목소리가 이 폰에 없으면 기본 목소리로 읽는다)
  const findVoice = (id) => (id ? voiceList().find((v) => v.voiceURI === id) : null);
  const savedVoice = () => findVoice(curVoiceId());
  function renderVoiceBtns() {
    const T = window.GAMJA_I18N.t;
    const cur = savedVoice(), glob = findVoice(gVoice());
    if (!$('voiceBtn').firstElementChild && window.GAMJA_ICONS) $('voiceBtn').innerHTML = window.GAMJA_ICONS.svg('speak');
    $('voiceBtn').title = $('voiceBtn').ariaLabel = T('voice.title') + (cur ? `: ${cur.name}` : '');
    if ($('setVoiceBtn')) $('setVoiceBtn').textContent = `${T('voice.menu')}: ${glob ? glob.name : T('voice.auto')}`;
    for (const id of ['voiceBtn', 'setVoiceBtn']) if ($(id)) $(id).style.opacity = synth ? '' : '.35';
  }
  // scope 'room': ⋯ 메뉴에서 열면 이 방만의 목소리, 'global': 더보기에서 열면 앱 기본 목소리
  function openVoicePicker(scope = 'room') {
    const T = window.GAMJA_I18N.t;
    els.menu.classList.add('hidden');
    if (!synth) return toast(T('voice.unsupported'));
    if (gsOpen) gsOpen.close(false);
    const bg = document.createElement('div');
    bg.className = 'gs-bg';
    bg.innerHTML = '<div class="gs" role="dialog" aria-modal="true"><h2></h2><div class="vp-list"></div><p class="vp-sub"></p><div class="vp-rate"></div><p class="vp-hint"></p><div class="gs-btns"><button class="gs-ok" type="button"></button></div></div>';
    bg.querySelector('h2').textContent = T('voice.title');
    bg.querySelector('.vp-sub').textContent = T('voice.rate');
    bg.querySelector('.vp-hint').textContent = T('voice.hint');
    bg.querySelector('.gs-ok').textContent = T('sheet.close');
    const list = bg.querySelector('.vp-list'), rates = bg.querySelector('.vp-rate');
    const close = () => {
      if (!bg.isConnected || bg.classList.contains('out')) return;
      bg.classList.add('out');
      setTimeout(() => bg.remove(), 160);
      if (gsOpen && gsOpen.bg === bg) gsOpen = null;
      stopSpeaking();
    };
    const preview = (v) => {
      stopSpeaking();
      const u = new SpeechSynthesisUtterance(T('voice.sample'));
      u.lang = LOCALE; u.rate = ttsRate;
      if (v) u.voice = v;
      synth.speak(u);
    };
    const drawList = () => {
      const vs = voiceList();
      const inRoom = scope === 'room';
      const follow = inRoom && roomPrefs.voice === undefined; // 이 방은 더보기의 기본 목소리를 따르는 중
      const cur = inRoom ? curVoiceId() : gVoice();
      list.innerHTML = '';
      const row = (label, tag, on, pick, v) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = `vp-row${on ? ' on' : ''}`;
        const n = document.createElement('span'); n.className = 'vp-name'; n.textContent = label;
        b.appendChild(n);
        if (tag) { const s = document.createElement('small'); s.textContent = tag; b.appendChild(s); }
        b.onclick = () => { pick(); renderVoiceBtns(); drawList(); preview(v || pickVoice()); };
        list.appendChild(b);
      };
      const choose = (v) => () => { const id = v ? v.voiceURI : ''; if (inRoom) setRoomPref('voice', id); else { store.set('cc:voice', id); applyPrefs(); } };
      if (inRoom) row(T('voice.follow'), '', follow, () => setRoomPref('voice', undefined), findVoice(gVoice()));
      row(T('voice.auto'), '', !follow && !cur, choose(null), null);
      for (const v of vs) row(v.name, v.localService ? T('voice.offline') : T('voice.online'), !follow && v.voiceURI === cur, choose(v), v);
      if (!vs.length) { const p = document.createElement('p'); p.className = 'settings-note'; p.textContent = T('voice.none'); list.appendChild(p); }
    };
    const drawRates = () => {
      rates.innerHTML = '';
      for (const r of [0.8, 1, 1.2, 1.5, 2]) {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = `×${r}`;
        if (Math.abs(ttsRate - r) < 0.03) b.className = 'on';
        b.onclick = () => { ttsRate = r; store.set('cc:ttsRate', r); drawRates(); preview(savedVoice() || pickVoice()); };
        rates.appendChild(b);
      }
    };
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('.gs-ok')) close(); });
    drawList(); drawRates();
    document.body.appendChild(bg);
    gsOpen = { bg, close };
    synth.onvoiceschanged = () => { drawList(); renderVoiceBtns(); }; // 목소리 목록이 늦게 도착하는 브라우저를 위해
  }
  $('voiceBtn').onclick = () => openVoicePicker('room');
  if ($('setVoiceBtn')) $('setVoiceBtn').onclick = () => openVoicePicker('global');
  if (synth) synth.addEventListener('voiceschanged', renderVoiceBtns);
  renderVoiceBtns();
  function pickVoice() {
    const voices = synth.getVoices();
    const base = LOCALE.slice(0, 2);
    return savedVoice() || voices.find((v) => v.lang === LOCALE && /google|yuna|sora|heami|samantha|aria/i.test(v.name)) ||
      voices.find((v) => v.lang && v.lang.replace('_', '-').startsWith(base));
  }
  // 긴 텍스트는 일부 브라우저에서 끊기므로 문장 단위로 나눈 발화 목록을 만든다
  function speechTexts(md, limit = 180) { // limit: 한 덩어리의 글자 수 (읽기 박스는 5초씩 앞뒤로 가려고 잘게 나눈다)
    const text = toSpeech(md);
    const chunks = text.match(/[^.!?。\n]+[.!?。]?/g) || [text];
    const out = [];
    let cur = '';
    const flush = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
    for (const c of chunks) {
      if ((cur + c).length > limit) flush();
      cur += c;
    }
    flush();
    return out;
  }
  function makeUtterance(text, rate) {
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    u.lang = LOCALE;
    if (v) u.voice = v;
    u.rate = rate || ttsRate;
    return u;
  }
  const utterances = (md) => speechTexts(md).map((t) => makeUtterance(t));

  // ---------- 읽어주는 중 한 줄 박스 (멈춤·이어듣기, 15초쯤 앞뒤로, 누르는 동안 2배, 끝내기) ----------
  // 덩어리(문장 묶음)를 하나씩 읽는다. 웹뷰의 pause/resume은 불안정해서, 멈춤은 "지금 덩어리를 끊고 나중에 그 덩어리부터 다시 읽기"로 한다
  const reader = { chunks: [], i: 0, paused: false, boost: false, token: 0, show: false, marks: [] };
  const readerBar = $('readerBar');
  // 읽는 문장 표시: 읽는 덩어리가 들어 있는 채팅 속 문단을 찾아 노랗게 칠한다 (찾지 못하면 표시만 안 한다)
  const speechKey = (s) => s.replace(/[^\p{L}\p{N}]/gu, '');
  function readerFindMarks(bubble) {
    reader.marks = [];
    if (!bubble) return;
    const blocks = [...bubble.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th')].map((el) => ({ el, key: speechKey(el.textContent) }));
    let from = 0;
    reader.marks = reader.chunks.map((c) => {
      const k = speechKey(c).slice(0, 8);
      if (k.length < 3) return null;
      for (let j = from; j < blocks.length; j++) {
        if (!blocks[j].key.includes(k)) continue;
        let h = j; // 목록 항목 안의 문단처럼 겹치면 가장 안쪽 것을 고른다
        while (h + 1 < blocks.length && blocks[h].el.contains(blocks[h + 1].el) && blocks[h + 1].key.includes(k)) h++;
        from = j;
        return blocks[h].el;
      }
      return null;
    });
  }
  function readerMark() {
    document.querySelectorAll('.reading-now').forEach((el) => el.classList.remove('reading-now'));
    const el = reader.show ? reader.marks[reader.i] : null;
    if (!el) return;
    el.classList.add('reading-now');
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function renderReader() {
    const on = reader.show && reader.chunks.length > 0;
    readerBar.classList.toggle('hidden', !on);
    readerMark();
    if (!on) return;
    const T = window.GAMJA_I18N.t;
    // 글자 ⏸·▶는 폰마다 그림 이모지로 보여서 모양이 달라지므로 직접 그린 아이콘을 쓴다
    $('readerPlay').innerHTML = reader.paused
      ? '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 4.5 L19 12 L8 19.5 Z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>'
      : '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="6" y="4.5" width="4.4" height="15" rx="1.2" fill="currentColor"/><rect x="13.6" y="4.5" width="4.4" height="15" rx="1.2" fill="currentColor"/></svg>';
    $('readerPlay').setAttribute('aria-label', T(reader.paused ? 'reader.resume' : 'reader.pause'));
    $('readerBoost').classList.toggle('on', reader.boost);
  }
  function readerFrom(i) {
    const my = ++reader.token;
    synth.cancel();
    reader.i = Math.max(0, i);
    reader.paused = false;
    const next = () => {
      if (my !== reader.token) return;
      if (reader.i >= reader.chunks.length) { readerClose(); return; }
      const u = makeUtterance(reader.chunks[reader.i], Math.min(4, ttsRate * (reader.boost ? 2 : 1)));
      const advance = () => { if (my !== reader.token) return; reader.i++; renderReader(); next(); };
      u.onend = advance;
      u.onerror = (e) => { if (e && (e.error === 'canceled' || e.error === 'interrupted')) return; advance(); };
      synth.speak(u);
    };
    renderReader();
    next();
  }
  function readerClose() {
    reader.token++;
    reader.chunks = []; reader.marks = []; reader.i = 0; reader.paused = false; reader.boost = false; reader.show = false;
    if (synth) synth.cancel();
    renderReader();
  }
  function readerSkip(sec) { // 글자 수로 sec초쯤 되는 위치로 옮긴다 (한국어는 보통 1초에 6글자쯤, 속도에 비례)
    let left = Math.abs(sec) * 6 * ttsRate, i = reader.i;
    const step = sec < 0 ? -1 : 1;
    if (sec < 0 && reader.i > 0 && !reader.paused) i--; // 방금 읽던 덩어리가 아니라 그 앞부터 센다
    while (left > 0 && i + step >= 0 && i + step < reader.chunks.length) { left -= reader.chunks[i].length; i += step; }
    return Math.max(0, Math.min(i, reader.chunks.length));
  }
  $('readerPlay').onclick = () => {
    if (!reader.chunks.length) return;
    if (reader.paused) readerFrom(reader.i);
    else { reader.token++; synth.cancel(); reader.paused = true; renderReader(); }
  };
  $('readerBack').onclick = () => { if (reader.chunks.length) readerFrom(readerSkip(-5)); };
  $('readerFwd').onclick = () => { if (!reader.chunks.length) return; const i = readerSkip(5); if (i >= reader.chunks.length) readerClose(); else readerFrom(i); };
  $('readerClose').onclick = readerClose;
  // ×2: 한 번 누르면 2배 빠르게, 다시 누르면 1배로 (눌러서 켜고 끄는 스위치)
  $('readerBoost').onclick = () => {
    if (!reader.chunks.length) return;
    reader.boost = !reader.boost;
    renderReader();
    if (!reader.paused) readerFrom(reader.i);
  };

  function speak(md, force, bubble) {
    if (!synth || (!ttsOn && !force)) return;
    stopSpeaking();
    const texts = speechTexts(md, 40);
    if (!texts.length) return;
    reader.chunks = texts;
    reader.show = !voice.on; // 🗣 음성 대화 모드에서는 박스를 보이지 않는다
    readerFindMarks(bubble);
    readerFrom(0);
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
      const go = () => { try { synth.resume(); } catch {} for (const u of list) synth.speak(u); };
      // 아이폰: 듣기(마이크) 직후라 소리 채널이 녹음 상태로 남아 있고, cancel 직후 바로 읽으면 말이 버려진다 → 무음 채널을 깨우고 잠깐 뒤에 읽는다
      if (isIOS) { holdStop(); setTimeout(go, 150); } else go();
      // 일부 브라우저는 중간에 끊었을 때 끝 신호를 안 보내므로, 읽기가 멈췄는지도 주기적으로 확인
      const guard = setInterval(() => { if (!synth.speaking && !synth.pending) finish(); }, 700);
      // 소리가 아예 시작되지 않는 폰(아이폰에서 막힐 때)은 3.5초 뒤 넘어가서 다시 듣기 단계로 돌아간다
      let started = false;
      list[0].onstart = () => { started = true; };
      setTimeout(() => { if (!started && !done) { try { synth.cancel(); } catch {} finish(); } }, 3500);
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
  let voiceHeard = false; // 지금 듣는 중에 소리·말이 잡혔는지 (대기 카운트를 멈추는 데 쓴다)
  let voiceNote = ''; // 음성 대화에서 직전에 말이 안 들렸을 때 화면에 남겨 두는 설명
  let wakeLock = null;
  const VOICE_LABEL = {
    listen: '👂 듣고 있어요', more: '👂 계속 듣고 있어요 — 다 말했으면 🎤를 누르세요',
    confirm: '⏳ 곧 보낼게요 — 🎤를 누르면 취소', work: '🤔 작업 중...',
    speak: '🔊 말하는 중 — 🎤를 누르면 끊고 말할 수 있어요', paused: '⏸ 쉬는 중 — 🎤를 누르면 다시 들어요',
  };
  // 작업 중 알림음: 크루가 생각·작업하는 동안 1초마다 작은 "뚜-둥" (운전 중에도 아직 일하는 중인 걸 알 수 있게)
  let beatCtx = null, beatTimer = 0;
  function beatUnlock() { // 음성 대화를 켜는 손동작 때 소리 장치를 깨워 둔다 (폰은 손동작 없이 소리를 못 낸다)
    try {
      if (!beatCtx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) beatCtx = new AC(); }
      if (beatCtx && beatCtx.state === 'suspended') beatCtx.resume();
    } catch { beatCtx = null; }
  }
  function beatOnce() {
    const c = beatCtx;
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    const tone = (f, dur, gain, at) => {
      const t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination);
      o.start(t); o.stop(t + dur + 0.02);
    };
    tone(440, 0.12, 0.18, 0);
    tone(660, 0.16, 0.16, 0.17);
  }
  function stopBeat() { clearInterval(beatTimer); beatTimer = 0; }
  function startBeat() {
    if (beatTimer) return;
    beatUnlock();
    beatTimer = setInterval(() => {
      if (!voice.on || voice.phase !== 'work') return stopBeat();
      if (!speaking()) beatOnce(); // 안내 음성을 읽는 동안에는 쉰다
    }, 1000);
  }
  // 소리 채널 붙잡기: 음성 대화 동안 귀에 안 들리는 무음을 반복 재생한다.
  // 목소리 문장 사이·알림음 사이가 비면 폰이 소리 채널을 놓아서 차가 라디오·음악으로 돌아가는 것을 막는다
  let holdAudio = null;
  const holdPhaseOk = () => !isIOS && voice.on && voice.phase !== 'listen' && voice.phase !== 'more'; // 마이크로 듣는 동안에는 다시 틀지 않는다
  function silentWav() { // 1초짜리 무음 WAV (8kHz, 8비트, 모노)
    const n = 8000, b = new Uint8Array(44 + n), v = new DataView(b.buffer);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) b[o + i] = t.charCodeAt(i); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true);
    v.setUint16(32, 1, true); v.setUint16(34, 8, true); str(36, 'data'); v.setUint32(40, n, true);
    b.fill(128, 44);
    return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  }
  function holdPlay() {
    try {
      if (!holdAudio) {
        holdAudio = new Audio(silentWav());
        holdAudio.loop = true;
        holdAudio.addEventListener('pause', () => { // 폰이 멈추게 했으면 듣기 단계가 아닐 때 다시 튼다
          setTimeout(() => { if (holdAudio.paused && holdPhaseOk()) holdAudio.play().catch(() => {}); }, 800);
        });
      }
      if (holdAudio.paused) holdAudio.play().catch(() => {});
    } catch { /* 무음 재생이 안 되는 폰은 그냥 넘어간다 */ }
  }
  function holdStop() { if (holdAudio && !holdAudio.paused) holdAudio.pause(); }
  function setVoice(phase, text) {
    voice.phase = phase;
    if (phase === 'work') startBeat(); else stopBeat();
    if (holdPhaseOk()) holdPlay();
    voiceEl.dataset.phase = phase;
    $('voiceState').textContent = VOICE_LABEL[phase] || '';
    // 화면은 입력창 그대로: 상태는 안내 글(placeholder)에, 말한 내용은 타자 치듯 입력창에 쓴다
    const live = phase === 'listen' || phase === 'more';
    els.mic.classList.toggle('listening', live || phase === 'speak' || phase === 'work'); // 클로드가 말하는 중에는 마이크가 "끊고 말하기" 버튼으로 빨갛게 깜빡인다
    composerBox.classList.toggle('voice-live', voice.on);
    composerBox.classList.toggle('voice-paused', voice.on && (phase === 'paused' || phase === 'listen' || phase === 'speak' || phase === 'work')); // 듣기·대기·클로드가 말하는 중에는 입력창 전체를 노랗게
    let pz = $('voicePause');
    if (!pz) {
      pz = document.createElement('button');
      pz.id = 'voicePause'; pz.type = 'button';
      pz.onclick = async () => {
        if (pz.dataset.phase === 'work') { // 크루를 멈추는 버튼이라 ■ 중지와 똑같이 한 번 묻는다
          if (!(await confirmStop(false)) || voice.phase !== 'work') return;
        }
        if (voiceTap) voiceTap();
      };
      $('input').parentNode.appendChild(pz);
    }
    pz.dataset.phase = phase;
    pz.textContent = phase === 'work' ? '⏳ ' + window.GAMJA_I18N.t('voice.speaking') : phase === 'speak' ? '🔊 ' + window.GAMJA_I18N.t('voice.speaking') : phase === 'listen' ? window.GAMJA_I18N.t('voice.speakNow') : '⏸ ' + window.GAMJA_I18N.t('voice.pausedBig');
    if (phase === 'listen' || phase === 'speak' || phase === 'paused') els.input.value = '';
    else if (text !== undefined) els.input.value = text;
    els.input.placeholder = window.GAMJA_I18N.trText(VOICE_LABEL[phase] || '') + (phase === 'listen' && text ? ` ${text}` : '');
    autoGrow();
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
      let started = false, ended = false;
      let lastErr = ''; // 말이 안 들렸을 때 화면에 이유를 보여 주기 위한 기록
      r.onstart = () => { started = true; if (!prefix && voice.on) els.input.placeholder = '(마이크가 켜졌어요. 말씀해 보세요)'; };
      r.onspeechstart = () => { heard = true; if (!prefix && voice.on) els.input.placeholder = '(소리가 들려요…)'; };
      r.onresult = (e) => {
        heard = true; voiceHeard = true;
        voiceNote = '';
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) finalText = e.results[i][0].transcript;
          else interim += e.results[i][0].transcript;
        }
        if (voice.on) {
          els.input.value = [prefix, finalText || interim].filter(Boolean).join(' ');
          if (els.input.value.trim()) composerBox.classList.remove('voice-paused'); // 말이 글자로 나오기 시작하면 노란 안내를 걷고 글을 보여 준다
          autoGrow();
        }
      };
      r.onerror = (e) => {
        lastErr = `${errCode(e)}${errDetail(e) ? ` · ${errDetail(e)}` : ''}`;
        if (isMicDenied(errCode(e))) { denied = true; voiceDeniedKind = errCode(e); voiceDeniedDetail = errDetail(e); } else reportMicError(errCode(e), errDetail(e));
      };
      r.onend = () => {
        if (ended) return; ended = true;
        clearTimeout(giveUp);
        voiceRec = null;
        if (!finalText.trim() && !prefix) voiceNote = window.GAMJA_I18N.trText(`(들은 말이 없어요${heard ? '' : ' · 소리가 안 잡혔어요'}${lastErr ? ` · ${lastErr}` : ''})`);
        resolve(denied ? VOICE_DENIED : finalText.trim() || null);
      };
      voiceRec = r;
      try { r.start(); } catch { clearTimeout(giveUp); ended = true; voiceRec = null; resolve(null); }
    });
  }
  // 한 번 켠 마이크로 계속 듣는다: 말이 멈추고 5초 조용하면(또는 원을 누르면) 끝내고 지금까지 들은 말을 돌려준다.
  // 이어 말하기마다 마이크를 새로 켜지 않아서 아이폰이 놓치지 않는다.
  function listenTurn() {
    const SRc = window.SpeechRecognition || window.webkitSpeechRecognition;
    return new Promise((resolve) => {
      const r = new SRc();
      r.lang = LOCALE;
      r.interimResults = true;
      r.continuous = true;
      let text = '';
      let denied = false;
      let ended = false;
      let sendNow = false;
      let idle = 0;
      let lastErr = '';
      let heard = false;
      const finish = () => { try { r.stop(); } catch {} };
      r.onstart = () => { if (voice.on && !text) els.input.placeholder = '(마이크가 켜졌어요. 말씀해 보세요)'; };
      r.onspeechstart = () => { heard = true; if (voice.on && !text) els.input.placeholder = '(소리가 들려요…)'; };
      r.onresult = (e) => {
        heard = true; voiceHeard = true; voiceNote = '';
        // 안드로이드 크롬은 연속 모드에서 "지금까지 들은 말 전체"를 새 조각으로 계속 보낸다 ("그룹" → "그룹 방에서" → …).
        // 새 조각이 앞 조각을 포함하면 앞 조각을 버리고, 앞 조각에 이미 들어 있는 짧은 조각은 건너뛴다 (아이폰처럼 따로 오는 문장은 그대로 이어 붙인다)
        const parts = [];
        const bare = (s) => s.replace(/\s+/g, '');
        for (let i = 0; i < e.results.length; i++) {
          const s = e.results[i][0].transcript.trim();
          if (!s) continue;
          const last = parts[parts.length - 1];
          if (last !== undefined && bare(s).startsWith(bare(last))) parts[parts.length - 1] = s;
          else if (last !== undefined && bare(last).startsWith(bare(s))) continue;
          else parts.push(s);
        }
        const t = parts.join(' ');
        if (!t) return;
        if (!text) { // 첫 말: 이어 말하기 기다리는 화면으로. 원을 누르면 바로 보낸다
          setVoice('more', t);
          voiceTap = () => { sendNow = true; voiceTap = null; finish(); };
        }
        text = t;
        if (voice.on) { els.input.value = t; composerBox.classList.remove('voice-paused'); autoGrow(); }
        clearTimeout(idle);
        idle = setTimeout(finish, 5000);
      };
      r.onerror = (e) => {
        lastErr = `${errCode(e)}${errDetail(e) ? ` · ${errDetail(e)}` : ''}`;
        if (isMicDenied(errCode(e))) { denied = true; voiceDeniedKind = errCode(e); voiceDeniedDetail = errDetail(e); } else reportMicError(errCode(e), errDetail(e));
      };
      r.onend = () => {
        if (ended) return; ended = true;
        clearTimeout(idle);
        voiceRec = null;
        if (!text.trim()) voiceNote = window.GAMJA_I18N.trText(`(들은 말이 없어요${heard ? '' : ' · 소리가 안 잡혔어요'}${lastErr ? ` · ${lastErr}` : ''})`);
        resolve(denied ? VOICE_DENIED : text.trim() ? { text: text.trim(), sendNow } : null);
      };
      voiceRec = r;
      try { r.start(); } catch { ended = true; voiceRec = null; resolve(null); }
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
    const gen = voice.gen = (voice.gen || 0) + 1; // 껐다 바로 켜면 앞 루프가 아직 끝나는 중일 수 있어, 새 번호가 아닌 루프는 스스로 멈춘다
    const live = () => voice.on && voice.gen === gen;
    for (let n = 0; n < 30 && voiceRec; n++) await new Promise((ok) => setTimeout(ok, 60)); // 앞 마이크가 완전히 꺼질 때까지 잠깐 기다린다 (아이폰은 마이크를 하나만 쓴다)
    // 말이 없는 채로 30초가 지나면 대기로 넘어간다. 마지막 10초(20초 뒤부터)는 노란 안내에 남은 초를 보여 준다.
    const SILENCE_MS = 30000;
    let silentSince = 0;
    let forcePause = false;
    const tick = setInterval(() => {
      if (!live()) return clearInterval(tick);
      if (voice.phase !== 'listen' || !silentSince) return;
      if (els.input.value.trim()) { silentSince = Date.now(); return; } // 글자로 말이 들어오는 중이면 세지 않는다
      const rem = Math.ceil((SILENCE_MS - (Date.now() - silentSince)) / 1000);
      if (rem <= 0) { forcePause = true; if (voiceRec) { try { voiceRec.abort(); } catch {} } }
      else if (rem <= 10 && composerBox.classList.contains('voice-paused')) { const pz = $('voicePause'); if (pz) pz.textContent = window.GAMJA_I18N.t('voice.countdown', { n: rem }); }
    }, 500);
    // 크루가 이미 생각 중일 때 시작했으면: "중지 후 말하기"를 보여 주고, 누르면 멈추고 바로 듣는다. 그냥 끝나면 답을 읽어 준다
    if (runId || remoteRunId) {
      const lastBotTs = () => { const b = history.filter((m) => m.role === 'bot' && m.text).pop(); return b ? b.ts : 0; };
      const ts0 = lastBotTs();
      let tapped = false;
      setVoice('work', '');
      voiceTap = () => { tapped = true; voiceTap = null; setVoice('listen', ''); stopRun(); if (abortCtl) abortCtl.abort(); };
      while (live() && !tapped && (runId || remoteRunId)) await new Promise((ok) => setTimeout(ok, 300));
      voiceTap = null;
      if (live() && !tapped) {
        await new Promise((ok) => setTimeout(ok, 900)); // 기록을 다시 받아 오는 시간
        const b = history.filter((m) => m.role === 'bot' && m.text).pop();
        if (live() && b && b.ts !== ts0) {
          setVoice('speak', toSpeech(b.text));
          voiceTap = () => stopSpeaking();
          await speakAndWait(b.text);
          voiceTap = null;
          await new Promise((ok) => setTimeout(ok, 300));
        }
      }
    }
    while (live()) {
      setVoice('listen', voiceNote); // 직전에 말이 안 들렸으면 이유를 같이 보여 준다
      voiceTap = null;
      voiceHeard = false;
      if (!silentSince) silentSince = Date.now();
      const turn = await listenTurn();
      const said = turn === VOICE_DENIED ? VOICE_DENIED : turn && turn.text;
      if (!live()) break;
      if (said === VOICE_DENIED) {
        stopVoice();
        micDenied(voiceDeniedKind, voiceDeniedDetail);
        break;
      }
      if (!said) {
        // 15초 동안 말이 없으면 쉬기 (계속 다시 켜면 휴대폰이 매번 알림음을 냄)
        if (forcePause) {
          forcePause = false; silentSince = 0;
          await speakAndWait(window.GAMJA_I18N.t('voice.waiting')); // 운전 중에도 쉬는 중으로 바뀐 걸 알 수 있게 말로 알린다
          if (!live()) break;
          setVoice('paused'); await waitForTap();
        }
        continue;
      }
      silentSince = 0;
      // 말하다 잠깐 쉬어도 끊지 않는다: 한 번 켠 마이크로 5초 조용할 때까지 이어 듣고, 원을 누르면 바로 보낸다.
      const collected = said;
      const sendNow = turn.sendNow;
      voiceTap = null;
      if (!live()) break;
      if (!sendNow) {
        setVoice('confirm', collected);
        if (!(await confirmWait(1200))) continue; // 취소 → 다시 듣기
        if (!live()) break;
      }
      setVoice('work', collected);
      els.input.value = collected;
      autoGrow();
      // 오래 걸리면 가끔 "아직 작업 중"이라고 알려 준다
      const nag = setInterval(() => { if (live() && voice.phase === 'work' && synth && !synth.speaking) speak(window.GAMJA_I18N.trText('아직 작업 중이에요.'), true); }, 45000);
      let userStopped = false;
      voiceTap = () => { // 생각·작업 중에 누르면 크루를 멈추고 바로 내 차례 (기다리지 않고 즉시 끊는다)
        userStopped = true;
        voiceTap = null;
        setVoice('listen', '');
        stopRun();
        if (abortCtl) abortCtl.abort();
      };
      const r = await sendMessage({ voice: true });
      voiceTap = null;
      clearInterval(nag);
      if (!live()) break;
      if (userStopped) continue; // 내가 멈춘 것 → 멈춘 응답은 읽지 않고 바로 듣기
      const reply = r && r.text ? r.text : r && r.error ? window.GAMJA_I18N.trText('문제가 생겼어요. 화면에서 내용을 확인해 주세요.') : '';
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
      if (live() && (remoteRunId || awaitingRestart)) {
        setVoice('work', window.GAMJA_I18N.trText('감자알이 다시 켜지는 중이에요...'));
        const t0 = Date.now();
        while (live() && (remoteRunId || awaitingRestart) && Date.now() - t0 < 180000) await new Promise((ok) => setTimeout(ok, 500));
      }
      if (!live()) break;
      const report = history.slice(before).filter((m) => m.role === 'bot' && m.text).pop();
      if (report) {
        const md = report.text.length > 220 ? `${report.text.slice(0, 220).replace(/\S*$/, '')} … ${window.GAMJA_I18N.trText('자세한 내용은 화면에 있어요.')}` : report.text;
        setVoice('speak', toSpeech(md));
        voiceTap = () => stopSpeaking();
        await speakAndWait(md);
        voiceTap = null;
        await new Promise((ok) => setTimeout(ok, 300));
      }
    }
  }
  let voiceBasePh = '';
  function startVoice() {
    if (voice.on) return;
    voiceBasePh = els.input.placeholder;
    if (!micUsable) return showMicOff(); // 쓸 수 없는 곳에서는 음성 화면을 열지 않는다
    stopListening();
    stopSpeaking();
    if (synth) { const w = new SpeechSynthesisUtterance(' '); w.volume = 0; synth.speak(w); } // 휴대폰: 사용자 동작으로 읽기 기능 잠금 해제
    beatUnlock(); // 작업 중 알림음도 같은 손동작으로 잠금 해제
    voice.on = true;
    document.body.classList.add('voice-on'); // 음성 대화 중에는 왼쪽 위 홈·오른쪽 위 ⋯ 를 막는다
    holdPlay(); // 무음 재생도 손동작이 있을 때 시작해 둔다
    els.input.readOnly = true; // 음성 대화 중에는 자판이 안 뜨게
    updateSendState();
    keepAwake(true);
    voiceLoop();
  }
  function stopVoice() {
    voice.on = false;
    voice.stoppedAt = Date.now();
    stopBeat();
    holdStop();
    if (voiceRec) { try { voiceRec.abort(); } catch {} }
    // 크루가 생각·작업 중일 때의 탭은 "중지 후 말하기"(크루 멈춤)라서, 음성 대화만 끌 때는 부르지 않는다
    if (voice.phase === 'work') voiceTap = null; else if (voiceTap) voiceTap();
    stopSpeaking();
    voice.phase = ''; // 음성 대화가 끝났으니 작업 중 안내가 더 나오지 않게 한다
    keepAwake(false);
    document.body.classList.remove('voice-on');
    els.input.readOnly = false;
    els.input.value = '';
    els.input.placeholder = voiceBasePh;
    els.mic.classList.remove('listening');
    composerBox.classList.remove('voice-live', 'voice-paused');
    const pz = $('voicePause'); if (pz) delete pz.dataset.phase; // 남아 있으면 마이크를 숨기는 규칙(style.css)이 계속 걸려 받아쓰기 버튼이 사라졌다
    autoGrow();
    updateSendState();
    // 진행 중이던 작업은 계속되고, 채팅 화면에서 이어서 보인다
  }
  $('voiceOrb').onclick = () => { if (voiceTap) voiceTap(); };
  $('voiceEnd').onclick = stopVoice;
  const vBtns = document.createElement('div'); vBtns.className = 'voice-btns'; voiceEl.appendChild(vBtns); vBtns.append($('voiceEnd'));

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
      setTimeout(() => { if (!requestReload(true)) { ind.classList.remove('spin'); reset(); } }, 250);
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
