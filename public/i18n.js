// 다국어(i18n) 바탕. 화면에 보이는 글은 한국어를 원본(ko)으로 두고, 다른 언어는 따로 적는다.
//
// 두 가지 방법을 함께 쓴다.
//  1) 새로 만드는 화면: 글을 아래 STR에 키로 적고 t('키')로 꺼내 쓴다 (ko·en을 같이 적는다).
//  2) 기존 화면: 코드에 한국어가 그대로 있는 글은 건드리지 않고, 화면이 영어일 때만 아래 EN_TEXT(한국어 원문 → 영어)로 바꿔서 보여 준다.
//     글자 하나하나를 바꾸는 큰 공사 없이 화면 전체를 단계적으로 번역할 수 있다. 한국어 화면에서는 아무것도 하지 않는다.
//     숫자가 들어가는 글은 EN_PATTERN(정규식 → 영어)으로 적는다. 번역이 없는 글은 한국어 그대로 보인다.
//  채팅 말풍선 안의 대화 내용(사용자와 Claude의 글)과 코드 블록은 절대 바꾸지 않는다.
(function () {
  const STR = { ko: {}, en: {} };
  const LANGS = ['ko', 'en'];
  const PREF_KEY = 'cc:lang';
  // 설정: 'auto'(폰의 언어를 따라감) | 'ko' | 'en'
  let pref = 'auto';
  try { const saved = localStorage.getItem(PREF_KEY); if (saved) pref = JSON.parse(saved); } catch { pref = 'auto'; }
  if (pref !== 'auto' && !LANGS.includes(pref)) pref = 'auto';
  const nav = String(navigator.language || 'ko').slice(0, 2).toLowerCase();
  let lang = pref === 'auto' ? (nav === 'ko' ? 'ko' : 'en') : pref; // 한국어가 아니면 영어
  document.documentElement.lang = lang;
  const locale = lang === 'ko' ? 'ko-KR' : 'en-US'; // 날짜 모양·음성 인식·읽기에 쓰는 지역 코드

  function t(key, vars) {
    const s = (STR[lang] && STR[lang][key]) ?? STR.ko[key] ?? key;
    return vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : vars[k])) : s;
  }
  function add(code, dict) { STR[code] = { ...(STR[code] || {}), ...dict }; }
  function setLang(code) { // 'auto' | 'ko' | 'en'
    if (code !== 'auto' && !LANGS.includes(code)) return;
    try { if (code === 'auto') localStorage.removeItem(PREF_KEY); else localStorage.setItem(PREF_KEY, JSON.stringify(code)); } catch { /* 저장소를 못 쓰면 이번만 */ }
  }

  // ---------- 기존 화면의 글: 한국어 원문 → 영어 ----------
  const EN_TEXT = new Map(Object.entries({
    // 아래 메뉴·탭 제목
    '크루': 'Crew', '채팅': 'Chats', '더보기': 'More', '채팅 목록': 'Chats',
    // 로그인
    '비밀번호': 'Password', '로그인': 'Log in',
    // 채팅방 위쪽·메뉴
    '결과물': 'Results', '대화 압축': 'Compress chat', '새 대화': 'New chat', '크루 설정': 'Crew settings',
    '답변 읽어주기: 꺼짐': 'Read replies: off', '답변 읽어주기: 켜짐': 'Read replies: on', '답변 읽어주기': 'Read replies',
    '맨 아래로': 'Jump to bottom', '메뉴': 'Menu', '닫기': 'Close', '뒤로': 'Back', '돌아가기': 'Back',
    // 입력창
    '메시지 입력': 'Type a message', '사진 첨부': 'Attach photos', '받아쓰기': 'Dictate', '전송': 'Send', '중지': 'Stop',
    '쓰던 글이 있어요': 'Unsent draft', '위에 고정됨': 'Pinned',
    // 진행 상태
    '생각 중...': 'Thinking...', '답변 작성 중...': 'Writing a reply...', '파일 읽는 중...': 'Reading a file...',
    '파일 작성 중...': 'Writing a file...', '명령 실행 중...': 'Running a command...', '할 일 정리 중...': 'Organizing tasks...',
    '새 코드 검사 중...': 'Checking the new code...', '서버 재시작 중...': 'Restarting...', '서버에 다시 연결하는 중...': 'Reconnecting...',
    '중지했습니다.': 'Stopped.',
    // 음성 대화
    '듣고 있어요': 'Listening', '종료': 'End', '음성 대화': 'Voice chat', '작업 중...': 'Working...',
    '계속 듣고 있어요 — 다 말했으면 원을 누르세요': 'Still listening — tap the circle when you are done',
    '곧 보낼게요 — 원을 누르면 취소': 'Sending soon — tap the circle to cancel',
    '말하는 중 — 원을 누르면 끊고 말할 수 있어요': 'Speaking — tap the circle to interrupt',
    '쉬는 중 — 원을 누르면 다시 들어요': 'Paused — tap the circle to listen again',
    '(마이크가 켜졌어요. 말씀해 보세요)': '(The mic is on. Go ahead and speak)', '(소리가 들려요…)': '(I can hear you…)',
    // 채팅 목록
    '대화를 시작해 보세요': 'Start a conversation', '감자 톡톡': 'Gamja Talk', '나: ': 'Me: ',
    '아직 대화가 없어요.': 'No chats yet.', '어제': 'Yesterday',
    // 크루 탭
    '자주 쓰는 크루': 'Favorites', '추천 크루': 'Suggested crews', '전체 보기 ›': 'See all ›', '추가': 'Add', '추가됨': 'Added',
    '회사': 'Company', '가게': 'Shop', '개인': 'Personal', '직접 만든 크루': 'My own crews', '기본 대화': 'Default chat',
    '찾는 크루가 없어요.': 'No crews found.', '크루 이름·소개 검색': 'Search crews', '검색': 'Search', '크루 추가': 'Add a crew',
    '폴더와 상관없이 무엇이든 물어보는 기본 대화': 'The default chat — ask anything',
    // 프로필 창
    '채팅하기': 'Chat', '공유': 'Share', '설정': 'Settings', '자주 쓰는 크루에 추가': 'Add to favorites',
    // 결과물
    '전체': 'All', '웹페이지': 'Web pages', '이미지': 'Images', '문서': 'Documents', '음악': 'Music', '영상': 'Videos',
    '아직 만든 결과물이 없어요.': 'Nothing has been made yet.',
    '주소 복사': 'Copy address', '폰의 다른 앱으로 열어요': 'Opening in another app',
    // 설정 목록
    '나에 대해': 'About me', '호칭, 답변 스타일': 'Your name and reply style',
    'AI 설정': 'AI settings', '모델, 생각 깊이, 대화 압축': 'Model, thinking depth, chat compression',
    '소리·화면': 'Sound & display', '답변 읽어주기, 테마': 'Read replies, theme',
    '보안': 'Security', '비밀번호, 로그아웃': 'Password, log out',
    '연결': 'Connections', '외부 접속 주소, GitHub, 다른 폰에 설치': 'External address, GitHub, install on another phone',
    '언어 설정': 'Language', '화면 언어: 자동, 한국어, English': 'Screen language: Auto, 한국어, English',
    '도구 상자': 'Toolbox', '크루가 문서·그림·영상·소리를 만드는 도구': 'Tools for making documents, images, videos and sounds',
    '문서 도구': 'Document tools', 'PDF · 워드 · 파워포인트 · 엑셀 문서 만들기': 'Make PDF, Word, PowerPoint and Excel files',
    '그림 도구': 'Image tools', '로고 · 도표 · 카드뉴스 같은 그림 파일(PNG) 만들기': 'Make logos, charts and card news as PNG images',
    '영상·소리 도구': 'Video & sound tools', '사진으로 슬라이드 영상, 간단한 소리 만들기': 'Make slideshow videos from photos and simple sounds',
    '정보': 'About', '감자 로그인': 'Gamja login', '감자 버전': 'Gamja version', '감자알 버전': 'Gamja Egg version',
    '자동 업데이트': 'Auto update', '켜짐 (3시간마다 확인)': 'On (checks every 3 hours)', '꺼짐 (개발용)': 'Off (dev build)',
    '최근 감자알 업데이트': 'Recent Gamja Egg updates', '아직 기록이 없어요.': 'No history yet.',
    '문제가 생겼을 때': 'If something goes wrong', '이전 버전으로 되돌리기': 'Roll back to the previous version',
    '방금 바뀐 코드가 문제일 때 바로 이전 안정 버전으로': 'Go back to the last stable version if the newest change causes trouble',
    '비상 모드': 'Emergency mode', '화면이 망가졌을 때 쓰는 탈출구': 'An escape hatch for when the screen is broken',
    '✅ 로그인됨 · 이 폰': 'Logged in · this phone', '로그인됨 · 이 폰': 'Logged in · this phone', '로그인됨 · 다른 기기': 'Logged in · another device',
    '로그인 안 됨': 'Not logged in',
    // 감자 앱 묶음
    '감자 앱': 'Gamja app', '다른 기기에서 접속': 'Connect from another device',
    '같은 와이파이의 주소와 비밀번호를 보여 줘요': 'Shows the Wi-Fi address and password',
    'Claude 로그인 다시 하기': 'Log in to Claude again', '공식 Claude 로그인 화면을 열어요': 'Opens the official Claude login',
    '배터리 설정': 'Battery settings', '화면이 꺼져도 감자알이 계속 돌게 해요': 'Keeps Gamja Egg running when the screen is off',
    '오픈소스 라이선스': 'Open-source licenses', '감자가 사용하는 오픈소스 목록': 'Open-source software Gamja uses',
    // 소리·화면, 보안
    '대화 글자 크기': 'Chat text size', '테마': 'Theme', '폰 설정 따르기': 'Follow phone', '밝게': 'Light', '어둡게': 'Dark',
    '답이 끝나면 소리로 읽어 줘요': 'Read replies aloud when they finish',
    '로그인 비밀번호': 'Login password', '현재 비밀번호': 'Current password', '새 비밀번호': 'New password',
    '새 비밀번호 보이기': 'Show new password', '안전한 비밀번호 만들기': 'Generate a safe password', '비밀번호 바꾸기': 'Change password',
    '로그아웃': 'Log out', '이 기기에서 로그아웃': 'Log out on this device',
    // 크루 입력 양식·설정
    '저장했어요': 'Saved', '크루 삭제': 'Delete crew', '이 크루 공유하기': 'Share this crew', '대화 정보': 'Chat info',
    '이 크루의 모델': 'Model for this crew', '이 크루의 생각 깊이': 'Thinking depth for this crew',
    '전체 설정 따르기': 'Follow global setting', '빠르게': 'Fast', '보통': 'Normal', '깊게': 'Deep',
    '모델·생각 깊이는 다음 메시지부터 적용돼요.': 'Model and thinking depth apply from the next message.',
    // 크루 고르기·가져오기·공유
    '크루 스토어': 'Suggested crews', '코드로 가져오기': 'Import with a code', '확인하기': 'Check', '취소': 'Cancel',
    '크루 추가하기': 'Add crew', '복사한 코드 붙여넣기': 'Paste the copied code', '코드 복사': 'Copy code',
    '공유하기': 'Share', '지침 전체': 'Full instructions', '예시 문장': 'Example prompts',
    // GitHub·연결
    'GitHub 연결': 'GitHub', 'GitHub 연결하기': 'Connect GitHub', '연결 끊기': 'Disconnect', '지금 기록하기': 'Back up now',
    'GitHub에서 보기': 'View on GitHub', '마지막 기록': 'Last backup', '방금 전': 'Just now', '아직 없어요': 'None yet',
    '외부 접속 주소': 'External address', '다른 폰에 설치': 'Install on another phone', '상태': 'Status', '켜기': 'Turn on',
    // 공통 알림
    '이미 최신 버전이에요': 'Already up to date', '새 버전이 있는지 확인하는 중...': 'Checking for updates...',
    '새 버전을 받았어요. 곧 다시 시작해요': 'Got a new version. Restarting soon',
    '이 감자알은 개발용이라 자동 업데이트가 꺼져 있어요': 'This is a dev build, so auto-update is off',
    '감자알이 다시 시작하는 중이에요. 잠시만 기다려 주세요': 'Restarting — please wait a moment',
    '사진을 읽지 못했어요': 'Could not read the photo', '선택한 사진을 받지 못했어요': 'Could not receive the selected photos',
    '크루를 추가했어요. 위의 내 크루에서 찾을 수 있어요': 'Crew added. Find it under My crews',
    '이미 있는 크루예요': 'That crew already exists',
    '복사했어요': 'Copied', '주소를 복사했어요': 'Address copied',
    '답변을 읽어 드릴게요': 'Replies will be read aloud', '읽어주기를 껐어요': 'Read-aloud is off',
    '새로운 대화를 시작했어요': 'Started a new chat',
  }));
  // 숫자·이름이 들어가는 글: [정규식, 영어 ($1, $2는 정규식에서 잡은 값)]
  const EN_PATTERN = [
    [/^자주 쓰는 크루 (\d+)$/, 'Favorites $1'], [/^내 크루 (\d+)$/, 'My crews $1'], [/^검색 결과 (\d+)$/, 'Results $1'],
    [/^사진은 (\d+)장까지 첨부할 수 있어요$/, 'You can attach up to $1 photos'],
    [/^(\d+)분 전$/, '$1 min ago'], [/^(\d+)시간 전$/, '$1 h ago'], [/^(\d+)일 전$/, '$1 d ago'],
    [/^작업 중… ?(.*)$/, 'Working… $1'],
    [/^(\d+)초$/, '$1 s'], [/^약 (\d+)MB$/, 'About $1 MB'],
    [/^(전체|웹페이지|이미지|문서|음악|영상) (\d+)$/, (m, k, n) => `${EN_TEXT.get(k) || k} ${n}`],
    [/^(.+)의 결과물$/, 'Results of $1'],
    [/^음성 인식 오류 \((.*)\)$/, 'Voice recognition error ($1)'],
    [/^감자알 (\d+\.\d+\.\d+)으로 업데이트됐어요$/, 'Gamja Egg updated to $1'],
  ];
  function lookupEn(core) {
    if (EN_TEXT.has(core)) return EN_TEXT.get(core);
    for (const [re, rep] of EN_PATTERN) if (re.test(core)) return core.replace(re, rep);
    return null;
  }
  const HAS_KO = /[가-힣]/;
  function trText(s) {
    if (lang !== 'en') return s;
    const raw = String(s);
    if (!HAS_KO.test(raw)) return raw;
    const lead = raw.match(/^\s*/)[0];
    const trail = raw.match(/\s*$/)[0];
    const core = raw.slice(lead.length, raw.length - trail.length);
    if (!core) return raw;
    const hit = lookupEn(core);
    if (hit !== null) return lead + hit + trail;
    // 앞의 기호(이모지·글머리표)를 떼고 한 번 더: "• 쓰지 않을 때는 꺼 두세요."
    const m = core.match(/^([^\p{L}\p{N}]+)([\s\S]*)$/u);
    if (m) { const h2 = lookupEn(m[2]); if (h2 !== null) return lead + m[1] + h2 + trail; }
    return raw;
  }

  // ---------- 화면(DOM)의 글을 영어로 바꿔 끼우기 (화면 언어가 영어일 때만) ----------
  // 대화 말풍선(오류 말풍선 제외), 코드, 입력칸의 글은 건드리지 않는다
  const SKIP = '.row:not(.error) .bubble, .bubble pre, pre, code, textarea, input, script, style, svg, .crew-pre, .codeblock, [data-no-i18n]';
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  function translateTree(root) {
    if (lang !== 'en' || !root) return;
    const base = root.nodeType === 1 ? root : root.parentElement;
    if (!base || (base.closest && base.closest(SKIP))) return;
    if (root.nodeType === 3) {
      const v = root.nodeValue; const tv = trText(v);
      if (tv !== v) root.nodeValue = tv;
      return;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const list = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) list.push(n);
    for (const n of list) {
      const p = n.parentElement;
      if (!p || (p.closest && p.closest(SKIP))) continue;
      const v = n.nodeValue;
      if (!HAS_KO.test(v)) continue;
      const tv = trText(v);
      if (tv !== v) n.nodeValue = tv;
    }
    for (const el of [root, ...root.querySelectorAll('[placeholder],[title],[aria-label]')]) {
      if (!el.getAttribute || (el.closest && el.closest(SKIP) && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) continue;
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (v && HAS_KO.test(v)) { const tv = trText(v); if (tv !== v) el.setAttribute(a, tv); }
      }
    }
  }
  function startTranslator() {
    if (lang !== 'en' || !document.body) return;
    // 알림창·확인창·입력창의 글도 영어로 (alert/confirm/prompt에 한국어 원문을 그대로 넘기는 코드를 고치지 않아도 된다)
    for (const fn of ['alert', 'confirm', 'prompt']) {
      const orig = window[fn].bind(window);
      window[fn] = (msg, ...rest) => orig(trText(String(msg ?? '')), ...rest);
    }
    translateTree(document.body);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') translateTree(m.target);
        else if (m.type === 'attributes') translateTree(m.target);
        else for (const n of m.addedNodes) translateTree(n);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  window.GAMJA_I18N = {
    t, add, setLang, trText, locale,
    get lang() { return lang; },
    get pref() { return pref; },
    get supported() { return LANGS.slice(); },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startTranslator); else startTranslator();

  // ---------- 새 화면의 글 (키로 적는 방식) ----------
  add('ko', {
    'crew.make': '✏️ 직접 만들기',
    'crew.makeSub': '이름과 맡길 일 적기 ›',
    'crew.import': '📥 친구가 보낸 크루 코드로 추가',
    'crew.importSub': '붙여넣기 ›',
    'crew.deleteConfirm': "'{name}' 크루를 삭제할까요?\n크루의 폴더와 지침, 나눈 대화는 보관돼요.\n크루 탭의 '삭제한 크루 복구하기'에서 30일 안에 되살릴 수 있고, 그 뒤에는 완전히 지워져요.",
    'room.title': '채팅방 설정',
    'room.name': '채팅방 이름',
    'room.nameNote': '비워 두면 크루 이름을 써요. 이 폰에만 저장돼요.',
    'room.members': '참여자',
    'room.memberNote': '크루를 누르면 크루 설정(지침·모델·공유·삭제)으로 가요.',
    'ext.title': '🌐 외부 접속',
    'ext.rowTitle': '외부 접속',
    'ext.rowSub': '같은 와이파이의 다른 기기에서 접속해요',
    'ext.lanH': '같은 와이파이 접속',
    'ext.lanLabel': '다른 기기에서 접속 허용',
    'ext.lanNote': '켜면 같은 와이파이에 있는 아이폰·안드로이드·PC의 브라우저로 이 폰의 감자에 접속할 수 있어요. 꺼 두면 이 폰에서만 열려요.',
    'ext.lanAddrs': '접속 주소: {addrs}',
    'ext.lanNone': '와이파이 주소를 찾지 못했어요. 와이파이에 연결돼 있는지 확인해 주세요.',
    'perm.title': '🔒 허용이 필요한 명령',
    'perm.once': '이번만 허용',
    'perm.always': '항상 허용',
    'perm.no': '허용 안 함',
    'perm.ok': '확인',
    'perm.good.read': '크루가 필요한 정보를 확인해서 더 정확하게 일해요.',
    'perm.good.write': '크루가 결과 파일을 직접 만들고 고쳐 줘요.',
    'perm.good.run': '크루가 도구를 써서 일을 끝까지 해 줘요.',
    'perm.good.net': '필요한 프로그램이나 자료를 받아서 일을 이어갈 수 있어요.',
    'perm.warn.read': '파일을 읽거나 확인하는 명령이라 내용은 바뀌지 않아요.',
    'perm.warn.write': '파일을 만들거나 바꾸는 명령이에요. 되돌리기 어려울 수 있어요.',
    'perm.warn.run': '프로그램을 실행하는 명령이에요. 항상 허용하면 이 크루는 이 프로그램으로 할 수 있는 일을 묻지 않고 해요.',
    'perm.warn.net': '인터넷에서 받거나 설치하는 명령이에요. 용량과 데이터를 쓰고, 이번 한 번만 허용할 수 있어요.',
    'perm.warn.critical': '폰이나 감자의 안전을 해칠 수 있어서 허용할 수 없는 명령이에요.',
    'perm.warn.complex': '여러 명령이 이어져 있거나 특수 기호가 있어서 한 번에 허용할 수 없어요. 크루에게 한 가지씩 실행해 달라고 해 주세요.',
    'perm.alwaysNote': '"항상 허용"은 이 크루에만 적용돼요. 더보기 → 허용한 명령에서 언제든 지울 수 있어요.',
    'perm.resume': '허용했어요. 이어서 해 주세요.',
    'perm.noted': '허용하지 않았어요',
    'perm.allowedElsewhere': '허용했어요. 그 크루에게 이어서 해 달라고 말해 주세요',
    'perm.rowTitle': '허용한 명령',
    'perm.rowSub': '크루가 묻지 않고 실행해도 되는 명령',
    'perm.pageTitle': '🔐 허용한 명령',
    'perm.intro': '크루가 허용 카드에서 "항상 허용"한 명령이에요. 이 목록에 있는 명령은 묻지 않고 실행돼요. 안 쓰는 것은 지워 두세요.',
    'perm.empty': '아직 항상 허용한 명령이 없어요.',
    'perm.remove': '지우기',
    'install.row': '다른 폰에 감자 설치',
    'install.rowSub': 'QR을 찍어 새 폰에 감자를 내려받아요',
    'install.title': '다른 폰에 감자 설치',
    'install.note': '새 폰의 카메라로 QR을 찍으면 감자 홈페이지가 열려요. 거기서 "내려받기"를 누르면 돼요.',
    'install.qrHint': '새 폰의 카메라로 찍어 보세요',
    'install.copy': '📋 주소 복사',
    'install.copied': '주소를 복사했어요',
    'install.stepsH': '설치 순서',
    'install.s1': '새 폰으로 QR을 찍어 감자 홈페이지를 열고 "내려받기"를 눌러요.',
    'install.s2': '내려받은 파일(gamja.apk)을 열어 설치해요. "출처를 알 수 없는 앱"을 허용하라고 하면 허용해 주세요.',
    'install.s3': '감자를 열면 처음 한 번 준비를 해요. 10~20분 걸리니 와이파이와 충전기를 연결해 두세요.',
    'install.s4': '안내에 따라 내 Claude 계정으로 로그인하면 끝이에요.',
    'install.move': '이 폰의 크루와 대화는 새 폰으로 옮겨지지 않아요. 새 폰에서 새로 시작해요. (옮기기와 백업은 Pro로 준비 중이에요)',
    'install.devH': '개발자 모드',
    'install.devNote': 'Termux로 감자알을 직접 설치하는 방법이에요. 일반 이용자에게는 필요 없어요.',
    'install.devBtn': 'Termux 설치 명령 만들기',
    'trash.row': '🗑 삭제한 크루 복구하기',
    'trash.title': '삭제한 크루',
    'trash.note': '지운 크루는 30일 동안 여기에 보관돼요. 복구하면 크루의 폴더·지침과 나눈 대화가 함께 돌아와요. 30일이 지나면 자동으로 완전히 지워져요.',
    'trash.empty': '삭제한 크루가 없어요.',
    'trash.today': '오늘',
    'trash.ago': '{d}일 전',
    'trash.meta': '{when} 삭제 · {left}일 남음 · 대화 {n}개',
    'trash.restore': '복구',
    'trash.purge': '완전히 삭제',
    'trash.purgeTitle': '완전히 삭제할까요?',
    'trash.purgeMsg': "'{name}' 크루의 폴더와 대화를 지금 완전히 지워요. 되돌릴 수 없어요.",
    'trash.purgeOk': '완전히 삭제',
    'sheet.ok': '확인',
    'sheet.cancel': '취소',
    'sheet.close': '닫기',
    'admin.rollbackTitle': '이전 버전으로 되돌릴까요?',
    'admin.rollbackMsg': '바로 이전의 안정 버전으로 코드를 되돌리고 감자알을 다시 켜요. 몇 초 걸려요.',
    'admin.rollbackOk': '되돌리기',
    'admin.stopTitle': '답변을 멈추고 되돌릴까요?',
    'admin.stopMsg': '지금 답변을 만드는 방이 있어요. 멈추고 되돌리면 진행 중인 답변은 지금까지의 글만 남아요.',
    'admin.stopOk': '멈추고 되돌리기',
    'room.deleteTitle': '채팅방을 삭제할까요?',
    'room.deleteOk': '삭제',
    'crew.deleteTitle': '크루를 삭제할까요?',
    'pw.confirmTitle': '비밀번호를 바꿀까요?',
    'pw.confirmMsg': '비밀번호를 바꾸면 모든 기기가 로그아웃돼요.\n새 비밀번호를 적어 두셨나요?',
    'pw.confirmOk': '바꾸기',
    'ptr.keep': '붙여 둔 사진이 있어서 새로고침하지 않았어요',
    'conn.checking': '🔄 연결을 확인하는 중이에요…',
    'conn.restarting': '🔄 감자알을 다시 켜는 중이에요. 최대 1분쯤 걸려요',
    'conn.checkingBtn': '확인 중…',
    'conn.lost': '연결할 수 없어요. 폰의 와이파이와 감자 앱이 켜져 있는지 확인해 주세요',
    'conn.retry': '다시 시도',
    'conn.back': '✅ 다시 연결됐어요',
    'conn.off': '접속이 끊겼어요. 폰에서 외부 접속을 껐어요',
    'tool.need': '🧰 {name}가 필요해요',
    'tool.sub': '{size} · 설치에 몇 분 걸려요',
    'tool.go': '설치하고 이어서 하기',
    'tool.going': '설치하는 중… (몇 분 걸려요, 다른 화면으로 가도 계속돼요)',
    'tool.done': '✅ 설치했어요. 이어서 할게요',
    'tool.doneElsewhere': '설치했어요. 그 크루에게 이어서 해 달라고 말해 주세요',
    'tool.fail': '설치하지 못했어요. 인터넷 연결과 저장 공간을 확인해 주세요',
    'tool.resume': '도구 설치가 끝났어요. 하던 일을 이어서 해 주세요.',
    'ext.qrHint': '다른 폰의 카메라로 QR을 찍으면 이 주소가 열려요',
    'ext.copy': '📋 주소 복사',
    'ext.copied': '주소를 복사했어요',
    'ext.lanShowApp': '주소와 비밀번호 보기',
    'ext.lanPwNote': '접속할 때는 감자 비밀번호가 필요해요. 모르는 사람이 있는 와이파이에서는 꺼 두세요.',
    'ext.proH': '외부 접속 주소 (와이파이 밖)',
    'ext.proTitle': '🔒 Pro 준비 중',
    'ext.proNote': '와이파이 밖(LTE)에서도 접속하고 아이폰 Safari에서 음성 대화까지 쓰는 안전한 https 주소는 Pro에서 제공할 예정이에요.',
    'menu.zoom': '화면비율',
    'menu.zoomReset': '눌러서 100%로 되돌려요',
    'room.manage': '대화 관리',
    'room.new': '대화 모두 지우기',
    'room.newNote': '이 방의 대화를 모두 지우고 새로 시작해요. 되돌릴 수 없어요. 크루의 지침과 만든 파일은 그대로고, 방 자체는 남아요. (방을 없애려면 맨 아래 "채팅방 삭제")',
    'room.newConfirm': '이 방의 대화를 모두 지울까요? 모든 기기에서 지워지고 되돌릴 수 없어요.',
    'room.compact': '대화 압축',
    'room.compactNote': '긴 대화를 요약해서 Claude의 기억을 가볍게 해요. 화면의 대화 기록은 그대로 남아요.',
    'room.deleteNote': '채팅방을 지우면 이 방의 대화가 사라지고 채팅 목록에서도 없어져요. 크루는 그대로 남아요.',
    'room.delete': '🗑 채팅방 삭제',
    'room.deleteConfirm': "'{name}' 채팅방을 삭제할까요?\n대화가 지워지고 되돌릴 수 없어요. 크루는 그대로 남아요.",
    'room.saved': '저장했어요',
    'room.loading': '대화를 불러오는 중이에요',
    'room.pin': '채팅 목록 맨 위에 고정',
    'room.memberNoteGone': '삭제된 크루예요. 복구하면 지침과 만든 파일, 대화가 그대로 돌아와요.',
    'room.deleteNoteGone': '채팅방을 지우면 이 대화가 완전히 사라져요. 되돌릴 수 없어요.',
    'gone.placeholder': '삭제된 크루라 대화할 수 없어요',
    'gone.note': '이 크루는 삭제돼서 더 이상 대화할 수 없어요. 다시 대화하려면 30일 안에 크루를 복구하세요.',
    'gone.rename': "같은 이름('{name}')의 크루가 이미 있어요.\n복구할 크루의 새 이름을 적어 주세요. (영문·숫자·한글·-·_ 로 40자까지)",
    'newchat.nameNote': '이 이름은 모든 기기에서 같이 보여요. 채팅방 설정에서 나중에 바꿀 수 있어요.',
    'newchat.willAdd': '크루 탭에 추가돼요',
    'newchat.all': '전체 보기 ›',
    'newchat.pick': '크루 고르기',
    'newchat.pickSub': '내 크루와 추천 크루 중에서 한 명을 골라요',
    'newchat.pickNote': '추천 크루를 고르면 "새 채팅 시작"을 누를 때 크루를 추가하고 바로 시작해요.',
    'newchat.pickTitle': '크루 고르기',
    'newchat.choose': '고르기',
    'newchat.start': '새 채팅 시작',
    'newchat.search': '크루 이름·소개 검색',
    'newchat.results': '검색 결과 {n}',
    'newchat.none': '찾는 크루가 없어요.',
    'newchat.favs': '자주 쓰는 크루',
    'newchat.recommend': '추천 크루',
    'auth.title': '🔑 Claude 로그인이 필요해요',
    'auth.body': '감자 앱을 열고 홈 화면의 "문제 해결 도구" → "Claude 다시 로그인"에서 로그인하면 이어서 쓸 수 있어요.',
    'pwa.row': '📲 홈 화면 바로가기',
    'pwa.title': '홈 화면 바로가기',
    'update.autoOn': '3시간마다 새 감자알을 확인해요',
    'update.autoOff': '자동으로 받지 않아요. 버전 옆 🔄를 눌러 직접 확인할 수 있어요',
    'update.autoDev': '개발용 감자알은 자동 업데이트를 쓰지 않아요',
    'pwa.body': '감자 콘솔을 앱처럼 바로 열 수 있어요.\n\n① 크롬 오른쪽 위 ⋮ 메뉴를 눌러요.\n② "홈 화면에 추가"(또는 "앱 설치")를 눌러요.\n③ 홈 화면에 생긴 감자 아이콘으로 열어요.\n\n로그인이 풀리면 감자 앱의 "감자 콘솔 접속하기"로 열어 주세요.',
    'pwa.go': '지금 추가하기',
    'login.hint': '비밀번호를 모르면 감자 앱의 "감자 콘솔 접속하기"로 열어 주세요. 비밀번호 없이 바로 로그인돼요.',
    'voice.table': '표는 채팅 화면을 참고해 주세요.',
    'reader.pause': '멈춤',
    'reader.resume': '이어서 듣기',
    'voice.menu': '🎙 읽어주는 목소리',
    'voice.title': '읽어주는 목소리',
    'voice.auto': '기본 목소리 (자동)',
    'voice.online': '온라인',
    'voice.offline': '이 폰 안',
    'voice.rate': '읽는 속도',
    'voice.hint': '이 폰에 설치된 목소리만 보여요. "온라인" 목소리는 대체로 더 자연스럽지만 인터넷이 필요할 수 있어요. 더 많은 목소리는 폰 설정 → 언어 → 텍스트 음성 변환에서 받을 수 있어요.',
    'voice.none': '고를 수 있는 목소리를 찾지 못했어요. 이 브라우저가 음성 합성을 지원하지 않거나 폰에 한국어 음성이 없어요.',
    'voice.sample': '안녕하세요, 이 목소리로 답변을 읽어 드릴게요.',
    'voice.unsupported': '이 브라우저는 음성 합성을 지원하지 않아요.',
    'newchat.addStart': '추가하고 시작',
    'newchat.titleOne': '새 채팅 시작',
    'newchat.noteOne': '이야기할 크루를 고르면 새 채팅방이 바로 열려요. 같은 크루와도 주제별로 대화를 따로 나눌 수 있어요.',
    'newchat.title': '채팅방 만들기',
    'newchat.note': '참여할 크루를 고르면 새 채팅방이 만들어져요. 두 명 이상 고르면 크루들이 한 방에서 차례로 의견을 내는 그룹 채팅이 돼요.',
    'newchat.groupNote': '최대 {max}명까지 고를 수 있어요. 그룹 채팅에서는 크루가 의견만 내고 파일은 고치지 않아요. @크루이름으로 부르면 그 크루만 답해요.',
    'room.groupPh': '메시지 입력 · @이름으로 지목',
    'room.groupOff': '그룹 채팅은 준비 중이에요',
    'room.invite': '＋ 참여자 초대',
    'room.inviteFirst': '첫 방은 초대할 수 없어요',
    'room.inviteFull': '최대 {max}명이에요',
    'invite.title': '참여자 초대',
    'invite.note': '방에 초대할 크루를 고르세요. {slots}명까지 더 초대할 수 있어요. 둘 이상이 되면 그룹 채팅이 돼요.',
    'invite.go': '초대하기',
    'invite.none': '초대할 수 있는 크루가 없어요.',
    'member.open': '크루 설정 열기',
    'member.kick': '이 방에서 내보내기',
    'member.kickNote': '내보내도 크루는 지워지지 않고, 이 방의 대화 기록도 그대로 남아요.',
    'member.kickNoteNo': '참여자가 두 명 이하인 방에서는 내보낼 수 없어요. 방 자체를 지우려면 채팅방 설정의 "채팅방 삭제"를 쓰세요.',
    'member.kickConfirm': "'{name}'을(를) 이 방에서 내보낼까요?\n크루는 그대로 남아요.",
    'room.summary': '정리',
    'newchat.noteSoon': '채팅방 만들기는 준비 중이에요. 이름과 참여자를 고르는 화면만 먼저 보여 드려요.',
    'newchat.goSoon': '채팅방 만들기 (준비 중)',
    'newchat.name': '채팅방 이름',
    'newchat.namePh': '비워 두면 크루 이름과 시각으로 정해요',
    'newchat.members': '참여자',
    'newchat.group': '＋ 참여자 더 추가 (그룹 채팅)',
    'newchat.soon': '준비 중',
    'newchat.go': '채팅방 만들기',
    'room.inviteSoon': '＋ 참여자 초대 (그룹 채팅)',
    'gone.restore': '크루 복구하기',
    'gone.restoreShort': '복구',
    'gone.restored': '크루를 복구했어요',
    'chat.deletedCrew': '삭제된 크루',
    'chat.goneNote': '삭제된 크루와 나눈 대화예요. 읽기만 할 수 있어요.',
    'chat.eraseGoneBtn': '이 대화 지우기',
    'chat.eraseGoneConfirm': '이 대화를 완전히 지울까요? 되돌릴 수 없어요.',
    'chat.eraseConfirm': "'{name}' 방의 대화를 지울까요?\n크루는 그대로 남아요.",
    'chat.eraseBusy': '지금 작업 중이에요. 끝난 뒤에 지워 주세요.',
    'cf.title': '직접 만들기',
    'cf.intro': '이름과 맡길 일만 적으면 나만의 크루가 만들어져요. 나중에 크루 설정에서 언제든 고칠 수 있어요.',
    'cf.icon': '아이콘',
    'cf.name': '이름',
    'cf.namePh': '예) 우리가게 후기',
    'cf.blurb': '한 줄 소개 (선택)',
    'cf.blurbPh': '예) 손님 후기에 답글을 써 줘요',
    'cf.group': '묶음',
    'cf.job': '맡길 일',
    'cf.jobPh': '예) 손님 후기에 정중한 답글을 달아 주는 일',
    'cf.make': '크루 만들기',
    'cf.needName': '이름을 적어 주세요',
    'cf.needJob': '맡길 일을 적어 주세요',
    'lang.title': '🌐 언어',
    'tools.intro': '크루가 PDF·워드·그림·영상·소리 같은 파일을 만들 때 쓰는 도구예요. 필요한 것만 설치하세요. 설치한 도구로 만든 파일은 결과물에 모여요.',
    'tools.install': '설치',
    'tools.installing': '설치 중…',
    'tools.installed': '설치됨',
    'tools.started': '설치를 시작했어요. 몇 분 걸려요',
    'tools.note': '와이파이에 연결하고 충전기를 꽂은 채로 설치하는 걸 권해요. 설치하는 동안에는 크루에게 일을 시키지 마세요.',
  });
  add('en', {
    'crew.make': '✏️ Create your own',
    'crew.makeSub': 'Write a name and a job ›',
    'crew.import': '📥 Add with a code from a friend',
    'crew.importSub': 'Paste ›',
    'crew.deleteConfirm': "Delete the crew '{name}'?\nIts folder, instructions and conversations are kept.\nYou can restore it within 30 days from 'Restore deleted crews' in the Crew tab; after that it is erased for good.",
    'room.title': 'Chat room settings',
    'room.name': 'Chat room name',
    'room.nameNote': 'Leave it empty to use the crew name. Saved on this phone only.',
    'room.members': 'Members',
    'room.memberNote': 'Tap the crew to open the crew settings (instructions, model, share, delete).',
    'ext.title': '🌐 External access',
    'ext.rowTitle': 'External access',
    'ext.rowSub': 'Connect from other devices on the same Wi-Fi',
    'ext.lanH': 'Same Wi-Fi access',
    'ext.lanLabel': 'Allow access from other devices',
    'ext.lanNote': "When on, iPhones, Android phones and PCs on the same Wi-Fi can open this phone's GAMJA in a browser. When off, it opens on this phone only.",
    'ext.lanAddrs': 'Address: {addrs}',
    'ext.lanNone': "Couldn't find a Wi-Fi address. Check that you are connected to Wi-Fi.",
    'perm.title': '🔒 A command needs your OK',
    'perm.once': 'Allow once',
    'perm.always': 'Always allow',
    'perm.no': "Don't allow",
    'perm.ok': 'OK',
    'perm.good.read': 'The crew can check what it needs and work more accurately.',
    'perm.good.write': 'The crew can create and edit result files itself.',
    'perm.good.run': 'The crew can use tools to finish the job.',
    'perm.good.net': 'It can download programs or data and keep going.',
    'perm.warn.read': 'It only reads or checks files, so nothing changes.',
    'perm.warn.write': 'It creates or changes files. This may be hard to undo.',
    'perm.warn.run': 'It runs a program. If you always allow it, this crew can do anything that program can do without asking.',
    'perm.warn.net': 'It downloads or installs things, using data and storage. It can only be allowed once.',
    'perm.warn.critical': 'This could harm the phone or GAMJA, so it cannot be allowed.',
    'perm.warn.complex': 'It chains several commands or uses special symbols, so it cannot be allowed at once. Ask the crew to run them one at a time.',
    'perm.alwaysNote': '"Always allow" applies to this crew only. You can remove it any time in More → Allowed commands.',
    'perm.resume': 'Allowed. Please continue.',
    'perm.noted': 'Not allowed',
    'perm.allowedElsewhere': 'Allowed. Ask that crew to continue',
    'perm.rowTitle': 'Allowed commands',
    'perm.rowSub': 'Commands crews may run without asking',
    'perm.pageTitle': '🔐 Allowed commands',
    'perm.intro': 'Commands you chose "Always allow" on a permission card. They run without asking. Remove the ones you no longer need.',
    'perm.empty': 'No commands are always allowed yet.',
    'perm.remove': 'Remove',
    'install.row': 'Install GAMJA on another phone',
    'install.rowSub': 'Scan a QR to download GAMJA on the new phone',
    'install.title': 'Install GAMJA on another phone',
    'install.note': "Scan the QR with the new phone's camera to open the GAMJA website, then tap Download.",
    'install.qrHint': "Scan it with the new phone's camera",
    'install.copy': '📋 Copy address',
    'install.copied': 'Address copied',
    'install.stepsH': 'Steps',
    'install.s1': 'Scan the QR with the new phone to open the GAMJA website and tap Download.',
    'install.s2': 'Open the downloaded file (gamja.apk) to install it. If asked, allow "install unknown apps".',
    'install.s3': 'Open GAMJA. The first start prepares everything and takes 10 to 20 minutes. Keep it on Wi-Fi and plugged in.',
    'install.s4': 'Sign in with your own Claude account when asked, and you are done.',
    'install.move': "This phone's crews and conversations are not moved to the new phone. You start fresh there. (Moving and backup are planned for Pro.)",
    'install.devH': 'Developer mode',
    'install.devNote': 'The way to install the GAMJA server by hand with Termux. Regular users do not need it.',
    'install.devBtn': 'Create a Termux install command',
    'trash.row': '🗑 Restore deleted crews',
    'trash.title': 'Deleted crews',
    'trash.note': 'Deleted crews are kept here for 30 days. Restoring brings back the crew folder, instructions and conversations. After 30 days they are erased for good.',
    'trash.empty': 'No deleted crews.',
    'trash.today': 'today',
    'trash.ago': '{d} days ago',
    'trash.meta': 'Deleted {when} · {left} days left · {n} messages',
    'trash.restore': 'Restore',
    'trash.purge': 'Delete for good',
    'trash.purgeTitle': 'Delete for good?',
    'trash.purgeMsg': "The folder and conversations of '{name}' are erased now. This cannot be undone.",
    'trash.purgeOk': 'Delete for good',
    'sheet.ok': 'OK',
    'sheet.cancel': 'Cancel',
    'sheet.close': 'Close',
    'admin.rollbackTitle': 'Go back to the previous version?',
    'admin.rollbackMsg': 'This restores the last stable code and restarts GAMJA. It takes a few seconds.',
    'admin.rollbackOk': 'Go back',
    'admin.stopTitle': 'Stop the reply and go back?',
    'admin.stopMsg': 'A reply is being written in a room. If you stop and go back, that reply keeps only the text written so far.',
    'admin.stopOk': 'Stop and go back',
    'room.deleteTitle': 'Delete this chat room?',
    'room.deleteOk': 'Delete',
    'crew.deleteTitle': 'Delete this crew?',
    'pw.confirmTitle': 'Change the password?',
    'pw.confirmMsg': 'Changing the password signs out every device.\nDid you write down the new password?',
    'pw.confirmOk': 'Change',
    'ptr.keep': "Not refreshed because you have attached photos",
    'conn.checking': '🔄 Checking the connection…',
    'conn.restarting': '🔄 GAMJA is restarting. This can take up to a minute',
    'conn.checkingBtn': 'Checking…',
    'conn.lost': "Can't connect. Make sure the phone's Wi-Fi and the GAMJA app are on",
    'conn.retry': 'Try again',
    'conn.back': '✅ Reconnected',
    'conn.off': 'Disconnected. External access was turned off on the phone',
    'tool.need': '🧰 {name} is needed',
    'tool.sub': '{size} · takes a few minutes to install',
    'tool.go': 'Install and continue',
    'tool.going': 'Installing… (a few minutes, it keeps going if you leave this screen)',
    'tool.done': '✅ Installed. Continuing',
    'tool.doneElsewhere': 'Installed. Ask that crew to continue where it left off',
    'tool.fail': 'Could not install. Check your connection and free space',
    'tool.resume': 'The tool is installed. Please continue where you left off.',
    'ext.qrHint': "Scan the QR with another phone's camera to open this address",
    'ext.copy': '📋 Copy address',
    'ext.copied': 'Address copied',
    'ext.lanShowApp': 'Show address and password',
    'ext.lanPwNote': 'The GAMJA password is required to connect. Turn this off on Wi-Fi shared with people you do not know.',
    'ext.proH': 'External address (outside Wi-Fi)',
    'ext.proTitle': '🔒 Pro coming soon',
    'ext.proNote': 'A secure https address that works outside Wi-Fi (mobile data) and supports voice chat in iPhone Safari will be offered in Pro.',
    'menu.zoom': 'Zoom',
    'menu.zoomReset': 'Tap to reset to 100%',
    'room.manage': 'Conversation',
    'room.new': 'Clear all messages',
    'room.newNote': "Clears this room's whole conversation and starts fresh. This can't be undone. The crew's instructions and files stay, and so does the room itself. (To remove the room, use \"Delete chat room\" at the bottom.)",
    'room.newConfirm': "Clear all messages in this room? They are removed on every device and can't be undone.",
    'room.compact': 'Compact conversation',
    'room.compactNote': "Summarizes a long conversation so Claude's memory stays light. The chat history on screen stays.",
    'room.deleteNote': 'Deleting the chat room erases its conversation and removes it from the chat list. The crew itself stays.',
    'room.delete': '🗑 Delete chat room',
    'room.deleteConfirm': "Delete the chat room '{name}'?\nThe conversation will be erased and cannot be restored. The crew itself stays.",
    'room.saved': 'Saved',
    'room.loading': 'Loading the conversation',
    'room.pin': 'Pin to the top of the chat list',
    'room.memberNoteGone': 'This crew was deleted. Restore it to get its instructions, files and conversation back.',
    'room.deleteNoteGone': 'Deleting the chat room erases this conversation for good. It cannot be undone.',
    'gone.placeholder': 'This crew was deleted, so you cannot chat',
    'gone.note': 'This crew was deleted, so you cannot chat anymore. Restore the crew within 30 days to chat again.',
    'gone.rename': "A crew named '{name}' already exists.\nEnter a new name for the restored crew. (letters, numbers, Korean, - and _ up to 40 characters)",
    'newchat.nameNote': 'This name is shown on every device. You can change it later in chat room settings.',
    'newchat.willAdd': 'Added to the Crew tab',
    'newchat.all': 'See all ›',
    'newchat.pick': 'Choose a crew',
    'newchat.pickSub': 'Pick one from your crews or the recommended ones',
    'newchat.pickNote': 'If you pick a recommended crew, it is added when you tap "Start new chat" and the chat starts right away.',
    'newchat.pickTitle': 'Choose a crew',
    'newchat.choose': 'Choose',
    'newchat.start': 'Start new chat',
    'newchat.search': 'Search crews by name or description',
    'newchat.results': 'Results {n}',
    'newchat.none': 'No crew found.',
    'newchat.favs': 'Favorite crews',
    'newchat.recommend': 'Recommended crews',
    'auth.title': '🔑 Claude sign-in is needed',
    'auth.body': 'Open the GAMJA app, then Home > "Troubleshooting tools" > "Sign in to Claude again". After that you can continue.',
    'pwa.row': '📲 Home screen shortcut',
    'pwa.title': 'Home screen shortcut',
    'update.autoOn': 'Checks for a new egg every 3 hours',
    'update.autoOff': 'Not downloaded automatically. Tap 🔄 next to the version to check yourself',
    'update.autoDev': 'Development eggs do not auto-update',
    'pwa.body': 'Open the GAMJA console like an app.\n\n1) Tap the ⋮ menu at the top right of Chrome.\n2) Tap "Add to Home screen" (or "Install app").\n3) Open it from the GAMJA icon on your home screen.\n\nIf you get signed out, open it with "Open GAMJA console" in the GAMJA app.',
    'pwa.go': 'Add now',
    'login.hint': 'If you do not know the password, open the console with "Open GAMJA console" in the GAMJA app. It signs you in without a password.',
    'voice.table': 'Please see the chat for the table.',
    'reader.pause': 'Pause',
    'reader.resume': 'Resume',
    'voice.menu': '🎙 Reading voice',
    'voice.title': 'Reading voice',
    'voice.auto': 'Default voice (automatic)',
    'voice.online': 'Online',
    'voice.offline': 'On this phone',
    'voice.rate': 'Reading speed',
    'voice.hint': 'Only voices installed on this phone are listed. "Online" voices usually sound more natural but may need internet. You can get more voices in the phone settings under Language → Text-to-speech.',
    'voice.none': 'No voices found. This browser may not support speech synthesis, or the phone has no voice for this language.',
    'voice.sample': 'Hello, I will read the answers to you in this voice.',
    'voice.unsupported': 'This browser does not support speech synthesis.',
    'newchat.addStart': 'Add and start',
    'newchat.titleOne': 'Start a new chat',
    'newchat.noteOne': 'Pick the crew you want to talk to and a new chat room opens right away. You can keep separate conversations by topic, even with the same crew.',
    'newchat.title': 'Create a chat room',
    'newchat.note': 'Pick the crew to join and a new chat room is created. Pick two or more for a group chat where the crews give their opinions one after another.',
    'newchat.groupNote': 'You can pick up to {max} crews. In a group chat the crews only give opinions and do not edit files. Mention a crew with @name to hear only from it.',
    'room.groupPh': 'Message · @name to ask one',
    'room.groupOff': 'Group chat is coming soon',
    'room.invite': '＋ Invite members',
    'room.inviteFirst': 'Not available in the first room',
    'room.inviteFull': 'Up to {max} members',
    'invite.title': 'Invite members',
    'invite.note': 'Pick the crews to invite. You can invite {slots} more. With two or more it becomes a group chat.',
    'invite.go': 'Invite',
    'invite.none': 'There are no crews left to invite.',
    'member.open': 'Open crew settings',
    'member.kick': 'Remove from this room',
    'member.kickNote': 'The crew is not deleted and the conversation in this room stays.',
    'member.kickNoteNo': 'You cannot remove members from a room with two or fewer. To remove the room itself, use "Delete chat room" in the room settings.',
    'member.kickConfirm': "Remove '{name}' from this room?\nThe crew itself stays.",
    'room.summary': 'Summary',
    'newchat.noteSoon': 'Creating chat rooms is coming soon. For now you can only preview the screen for choosing a name and members.',
    'newchat.goSoon': 'Create chat room (coming soon)',
    'newchat.name': 'Chat room name',
    'newchat.namePh': 'Leave empty to use the crew name and time',
    'newchat.members': 'Members',
    'newchat.group': '＋ Add more members (group chat)',
    'newchat.soon': 'Coming soon',
    'newchat.go': 'Create chat room',
    'room.inviteSoon': '＋ Invite members (group chat)',
    'gone.restore': 'Restore crew',
    'gone.restoreShort': 'Restore',
    'gone.restored': 'Crew restored',
    'chat.deletedCrew': 'Deleted crew',
    'chat.goneNote': 'This is a conversation with a deleted crew. Read only.',
    'chat.eraseGoneBtn': 'Delete this conversation',
    'chat.eraseGoneConfirm': 'Delete this conversation for good? This cannot be undone.',
    'chat.eraseConfirm': "Delete the conversation in '{name}'?\nThe crew itself stays.",
    'chat.eraseBusy': 'It is working right now. Please try again when it finishes.',
    'cf.title': 'Create your own',
    'cf.intro': 'Just give it a name and a job, and your own crew is ready. You can change it anytime in the crew settings.',
    'cf.icon': 'Icon',
    'cf.name': 'Name',
    'cf.namePh': 'e.g. Shop reviews',
    'cf.blurb': 'One-line description (optional)',
    'cf.blurbPh': 'e.g. Writes replies to customer reviews',
    'cf.group': 'Group',
    'cf.job': 'Job',
    'cf.jobPh': 'e.g. Politely reply to customer reviews',
    'cf.make': 'Create crew',
    'cf.needName': 'Please enter a name',
    'cf.needJob': 'Please describe the job',
    'lang.title': '🌐 Language',
    'tools.intro': 'Tools your crews use to make files like PDFs, Word documents, images, videos and sounds. Install only what you need. Files made with them appear under Results.',
    'tools.install': 'Install',
    'tools.installing': 'Installing…',
    'tools.installed': 'Installed',
    'tools.started': 'Installing — this takes a few minutes',
    'tools.note': 'We recommend installing on Wi-Fi while charging. Please do not give crews tasks while installing.',
  });
})();
