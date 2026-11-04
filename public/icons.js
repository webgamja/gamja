// 감자 전용 아이콘: 이모지 대신 같은 굵기의 둥근 선 + 노란 면 하나로 통일한 그림 (24x24 칸)
// 화면에 있는 이모지를 아래 이름으로 바꿔 끼운다. 목록에 없는 이모지는 그대로 둔다.
// 크루 아이콘(회사·가게·개인 등)은 크루 템플릿이 이모지로 들고 있어서 여기서 매겨 준다.
(function () {
  const P = {
    potato: '<path class="a" d="M5 13c0-5 4-8.5 8-8 4 .4 6.5 3.6 6 8-.5 4-3.5 6.5-7.5 6.5S5 17 5 13z"/><circle class="d" cx="10" cy="12" r=".9"/><circle class="d" cx="14.5" cy="14" r=".9"/>',
    home: '<path class="a" d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-5h4v5"/>',
    globe: '<circle class="a" cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18-3-3-3-15 0-18"/>',
    menu: '<path d="M8 3v7M5.5 3v4a2.5 2.5 0 0 0 5 0V3M8 10v11"/><path class="a" d="M17 21V3c-2.5 1.5-3.5 5-3.5 8H17"/>',
    calendar: '<rect class="a" x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M8 3v4M16 3v4"/>',
    wallet: '<rect class="a" x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M16 14.5h2"/>',
    book: '<path class="a" d="M5 4h13a1 1 0 0 1 1 1v14H7a2 2 0 0 0-2 2z"/><path d="M5 21V4M9 8h6"/>',
    pencil: '<path class="a" d="M4 20l1-4L16 5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14 7l3 3"/>',
    camera: '<rect class="a" x="3" y="7" width="18" height="13" rx="3"/><path d="M8 7l1.5-3h5L16 7"/><circle cx="12" cy="13.5" r="3.2"/>',
    chat: '<path class="a" d="M4 5h16v11H10l-4 4v-4H4z"/>',
    doc: '<path class="a" d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h4"/>',
    company: '<rect class="a" x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h2M13 8h2M9 12h2M13 12h2M10 21v-4h4v4"/>',
    store: '<path class="a" d="M4 9h16v11H4z"/><path d="M4 9l1.5-5h13L20 9M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M10 20v-6h4v6"/>',
    person: '<circle class="a" cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    folder: '<path class="a" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    spark: '<path class="a" d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
    sound: '<path class="a" d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>',
    lock: '<rect class="a" x="5" y="10" width="14" height="10" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    search: '<circle class="a" cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    chart: '<rect class="a" x="4" y="13" width="4" height="7" rx="1"/><rect class="a" x="10" y="8" width="4" height="12" rx="1"/><rect class="a" x="16" y="4" width="4" height="16" rx="1"/>',
    receipt: '<path class="a" d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    ticket: '<path class="a" d="M3 8h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/><path d="M14 8v10" stroke-dasharray="2 2"/>',
    suitcase: '<rect class="a" x="4" y="8" width="16" height="12" rx="3"/><path d="M9 8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M4 13h16"/>',
    eye: '<path class="a" d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    compress: '<path d="M4 12h6M14 12h6M8 8l2 4-2 4M16 8l-2 4 2 4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    gear: '<circle class="a" cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    box: '<path class="a" d="M4 8l8-4 8 4v9l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v9"/>',
    branch: '<circle class="a" cx="7" cy="6" r="2.5"/><circle class="a" cx="7" cy="18" r="2.5"/><circle class="a" cx="17" cy="9" r="2.5"/><path d="M7 8.5v7M17 11.5c0 4-10 2-10 4.5"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14-4M4 4v4h4M4 13a8 8 0 0 0 14 4M20 20v-4h-4"/>',
    wifi: '<path d="M3 9a14 14 0 0 1 18 0M6 12.5a9.5 9.5 0 0 1 12 0M9 16a5 5 0 0 1 6 0"/><circle class="d" cx="12" cy="19" r="1.2"/>',
    battery: '<rect class="a" x="3" y="8" width="16" height="9" rx="2.5"/><path d="M21 11v3"/>',
    undo: '<path d="M9 5L4 10l5 5M4 10h9a6 6 0 0 1 0 12"/>',
    ring: '<circle class="a" cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M5.6 5.6l3.9 3.9M18.4 5.6l-3.9 3.9M5.6 18.4l3.9-3.9M18.4 18.4l-3.9-3.9"/>',
    check: '<circle class="a" cx="12" cy="12" r="9"/><path d="M7.8 12.4l3 3 5.4-6"/>',
    warn: '<path class="a" d="M12 4l9 16H3z"/><path d="M12 10v4.5"/><circle class="d" cx="12" cy="17.3" r=".9"/>',
    info: '<circle class="a" cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle class="d" cx="12" cy="7.9" r=".9"/>',
    wave: '<path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/>',
    clipboard: '<rect class="a" x="6" y="5" width="12" height="16" rx="2"/><path d="M9 5V4h6v1M9 11h6M9 15h4"/>',
    download: '<path class="a" d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3z"/><path d="M12 4v10M8 10l4 4 4-4"/>',
    upload: '<path class="a" d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3z"/><path d="M12 14V4M8 8l4-4 4 4"/>',
    bulb: '<path class="a" d="M12 3a6 6 0 0 0-3.5 10.9c.5.4.5 1.1.5 1.1h6s0-.7.5-1.1A6 6 0 0 0 12 3z"/><path d="M10 18h4M10.5 21h3"/>',
    mic: '<rect class="a" x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    send: '<path class="a" d="M4 12l16-8-6 16-3-7z"/>',
    star: '<path class="a" d="M12 3.2l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.5l6-.8z"/>',
    people: '<circle class="a" cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14a6.5 6.5 0 0 1 3.5 6"/>',
    wrench: '<path class="a" d="M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.4 2.4-2.6-.6-.6-2.6z"/>',
    trash: '<path class="a" d="M5 7h14l-1 13H6z"/><path d="M4 7h16M9 7V4h6v3"/>',
    image: '<rect class="a" x="3" y="5" width="18" height="14" rx="3"/><circle cx="9" cy="10" r="1.5"/><path d="M4 18l5-5 4 4 3-3 4 4"/>',
    bell: '<path class="a" d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
    dice: '<rect class="a" x="4" y="4" width="16" height="16" rx="4"/><circle class="d" cx="9" cy="9" r="1.2"/><circle class="d" cx="12" cy="12" r="1.2"/><circle class="d" cx="15" cy="15" r="1.2"/>',
    moon: '<path class="a" d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
    sun: '<circle class="a" cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
    theme: '<circle cx="12" cy="12" r="8"/><path class="a" d="M12 4a8 8 0 0 1 0 16z"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    pause: '<rect class="a" x="6" y="5" width="4" height="14" rx="1"/><rect class="a" x="14" y="5" width="4" height="14" rx="1"/>',
    music: '<path d="M9 18V6l10-2v12"/><circle class="a" cx="7" cy="18" r="2.5"/><circle class="a" cx="17" cy="16" r="2.5"/>',
    film: '<rect class="a" x="3" y="5" width="18" height="14" rx="2.5"/><path d="M8 5v14M16 5v14M3 10h5M3 14h5M16 10h5M16 14h5"/>',
    fail: '<circle class="a" cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
    laptop: '<rect class="a" x="4" y="5" width="16" height="11" rx="2"/><path d="M2 19h20"/>',
    note: '<path class="a" d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    stop: '<rect class="a" x="6" y="6" width="12" height="12" rx="2.5"/>',
    starline: '<path d="M12 3.2l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.5l6-.8z"/>',
    yinyang: '<circle class="a" cx="12" cy="12" r="9"/><path d="M12 3a4.5 4.5 0 0 1 0 9 4.5 4.5 0 0 0 0 9"/><circle class="d" cx="12" cy="7.5" r=".9"/>',
    tarot: '<rect class="a" x="6" y="3" width="12" height="18" rx="2.5"/><path d="M12 8l1.2 2.4 2.6.4-1.9 1.8.5 2.6L12 14l-2.4 1.2.5-2.6-1.9-1.8 2.6-.4z"/>',
    shield: '<path class="a" d="M12 3l7 3v5.5c0 4.4-3 7.8-7 9.5-4-1.7-7-5.1-7-9.5V6z"/><path d="M8.8 12.2l2.2 2.2 4.2-4.6"/>',
    grad: '<path class="a" d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5M22 9v6"/>',
    rocket: '<path class="a" d="M12 3c3 2 4.5 5.5 4.5 9l-2 3h-5l-2-3c0-3.5 1.5-7 4.5-9z"/><circle cx="12" cy="10" r="1.5"/><path d="M9.5 15L7 19l3-1M14.5 15L17 19l-3-1"/>',
    coder: '<rect class="a" x="3" y="4" width="18" height="13" rx="2.5"/><path d="M10 8.5L7.5 10.5 10 12.5M14 8.5l2.5 2-2.5 2M2 20h20"/>',
    crystal: '<circle class="a" cx="12" cy="10.5" r="7"/><path d="M6 20h12M8 17l-1 3M16 17l1 3M9 8.5a3.5 3.5 0 0 1 3-2"/>',
    hourglass:'<path d="M6 3h12M6 21h12"/><path class="a" d="M7 3c0 5 5 6 5 9s-5 4-5 9h10c0-5-5-6-5-9s5-4 5-9z"/>',
  };
  // 이모지(변형 문자 FE0E·FE0F를 뺀 것) → 아이콘 이름
  const BY_EMOJI = {
    '🥔': 'potato', '✳': 'potato', '🏠': 'home', '🌐': 'globe', '📄': 'doc', '💬': 'chat', '🔎': 'search', '📊': 'chart',
    '📅': 'calendar', '🗓': 'calendar', '🍽': 'menu', '📣': 'camera', '🧾': 'receipt', '🎟': 'ticket', '📚': 'book',
    '💰': 'wallet', '✍': 'pencil', '🧳': 'suitcase', '🏢': 'company', '🏪': 'store', '🙋': 'person', '📁': 'folder',
    '👤': 'person', '🤖': 'spark', '🔊': 'sound', '🔇': 'sound', '🔒': 'lock', '👀': 'eye', '🗜': 'compress', '＋': 'plus',
    '⚙': 'gear', '📦': 'box', '🐙': 'branch', '🔄': 'refresh', '📶': 'wifi', '🔋': 'battery', '⚖': 'doc', '⏪': 'undo', '🛟': 'ring',
    '✅': 'check', '👍': 'check', '⚠': 'warn', 'ⓘ': 'info', 'ℹ': 'info', '🗣': 'wave', '👂': 'wave', '📋': 'clipboard',
    '📥': 'download', '📤': 'upload', '🤔': 'bulb', '🧠': 'bulb', '🔍': 'search', '🎤': 'mic', '➤': 'send', '★': 'star',
    '🧑': 'person', '💼': 'suitcase', '👥': 'people', '🆕': 'spark', '🛠': 'wrench', '🔧': 'wrench', '🗑': 'trash',
    '🖼': 'image', '🔔': 'bell', '📜': 'doc', '🎲': 'dice', '🌙': 'moon', '☀': 'sun', '🌓': 'theme', '⬇': 'down',
    '❌': 'fail', '📝': 'pencil', '📖': 'book', '💻': 'laptop', '📂': 'folder', '🗒': 'note', '🔗': 'link', '⏹': 'stop', '☆': 'starline',
    '🔐': 'shield', '🛡': 'shield', '🧰': 'wrench', '☯': 'yinyang', '🃏': 'tarot', '🔮': 'crystal', '🎓': 'grad', '🚀': 'rocket', '⭐': 'star', '🧑‍💻': 'coder', '🎴': 'tarot',
    '🎵': 'music', '🎬': 'film', '✕': 'close', '✏': 'pencil', '⏸': 'pause', '⏳': 'hourglass', '←': 'back',
  };
  const clean = (s) => String(s).replace(/[︎️]/g, '');
  const svg = (name) => `<svg class="gi-s" viewBox="0 0 24 24" aria-hidden="true">${P[name]}</svg>`;
  // 이모지 하나 → 아이콘 SVG 글자 (없으면 null)
  const iconFor = (emoji) => (BY_EMOJI[clean(emoji).trim()] ? svg(BY_EMOJI[clean(emoji).trim()]) : null);

  // 안이 이모지 하나뿐인 곳 (버튼·로고·이름표)
  const WHOLE = '.pick-icon, .home-ico, .login-logo, .welcome-logo, .avatar, .icon-btn, .cbtn, .send-btn, .to-bottom, .attach button, .speak-btn, .share-icon, .ver-btn, .av, .cl-av, .tab-acts button, .fr-av, .sheet-big, .cf-icons button, .cl-pen';
  // 글 사이에 이모지가 섞여 있는 곳. 채팅 말풍선(대화 내용)은 일부러 넣지 않는다
  const INLINE = '.menu-item, .crew-btn, .made-btn, .settings-body h3, .settings-bar h2, .ui-title, .settings-note, .settings-row span, .share-check, ' +
    '.notice, .toast, .settings-ghost, .settings-save, .settings-danger, .home-add, .welcome-btn, .chip, .welcome h2, .welcome p, ' +
    '.tools summary, .tools div, .interim, .cl-mid b, .cl-mid small, .row.error .bubble, .voice-text, .fr-join, .sheet-main, .sheet-sub button, .sheet-chips button, .pick-card b, .pick-card small, .set-row b, .set-row small, .status, .voice-state, .resume-form button, .perm-card b, .perm-card small, .install-card b, .conn-bar span';
  const ALL = WHOLE + ', ' + INLINE;
  const ANY_RE = /(\p{Extended_Pictographic}[︎️]?|[＋ⓘℹ★☆✕➤←])/gu;
  const LEAD_RE = /^(\s*)(\p{Extended_Pictographic}[︎️]?|＋)/u;
  // 글 속 이모지를 아이콘으로: 직접 들어 있는 글자(text 노드)만 훑고, 목록에 없는 이모지는 그대로 둔다
  function swapInline(el) {
    for (const node of [...el.childNodes]) {
      if (node.nodeType === 1) { // 안쪽 <b> 같은 것도 훑는다 (그림 안쪽과 이미 만든 칸은 건너뜀)
        if (node.tagName !== 'svg' && !node.classList.contains('gi-lead')) swapInline(node);
        continue;
      }
      if (node.nodeType !== 3 || !ANY_RE.test(node.nodeValue)) continue;
      ANY_RE.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let changed = false, last = 0, m;
      const text = node.nodeValue;
      while ((m = ANY_RE.exec(text))) {
        const s = iconFor(m[0]);
        if (!s) continue;
        changed = true;
        frag.append(text.slice(last, m.index));
        const wrap = document.createElement('span');
        wrap.className = 'gi-lead';
        wrap.innerHTML = s;
        frag.append(wrap);
        last = m.index + m[0].length;
        if (text[last] === ' ') last++; // 그림 뒤의 공백은 간격(margin)이 대신한다
      }
      ANY_RE.lastIndex = 0;
      if (!changed) continue;
      frag.append(text.slice(last));
      node.replaceWith(frag);
    }
  }
  function swapOne(el) {
    if (el.matches(WHOLE) && !el.firstElementChild) {
      const s = iconFor(el.textContent);
      if (s) { el.innerHTML = s; return; }
    }
    if (el.matches(INLINE)) swapInline(el);
  }
  function swap(root) {
    const base = root.nodeType === 1 ? root : root.parentElement || document;
    const set = new Set(base.querySelectorAll ? base.querySelectorAll(ALL) : []);
    const up = base.closest && base.closest(ALL);
    if (up) set.add(up);
    set.forEach(swapOne);
  }
  window.GAMJA_ICONS = { svg, iconFor, swap };
  swap(document);
  // 바뀐 곳만 다시 훑는다 (대화가 한 글자씩 쏟아져도 가볍게)
  new MutationObserver((list) => {
    for (const m of list) {
      for (const n of m.addedNodes) swap(n);
      if (m.type === 'characterData') swap(m.target);
      else if (!m.addedNodes.length) swap(m.target);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
})();
