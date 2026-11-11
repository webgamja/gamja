// 감자 콘솔 사용 통계 (구글 애널리틱스 GA4, "감자 콘솔" 웹 스트림).
// 보내는 것은 "어떤 기능을 몇 번 썼는지"뿐이다. 대화·크루 이름·방 이름·파일 이름·주소는 보내지 않는다.
// 주소와 제목은 고정값으로 덮어쓰고, 이벤트 이름과 값은 아래 허용 목록에 있는 것만 보낸다. 개인정보처리방침에 같은 내용이 적혀 있다.
// 비워 두면 통계를 쓰지 않는다. 감자 콘솔을 직접 고쳐서 쓰는 사람은 여기를 비우거나 자기 ID로 바꾸면 된다.
(function () {
  'use strict';
  var GA_MEASUREMENT_ID = '';

  var ALLOWED = {
    app_open: [], message_send: [], new_chat: ['kind'], crew_create: ['kind'], chat_continue: [], chat_export: [],
    chat_import: [], tool_install: ['kit'], room_trash_restore: [],
  };
  var KIT_OK = { image: 1, docs: 1, media: 1 };

  window.gaTrack = function () {};
  if (!GA_MEASUREMENT_ID || /\/safe\.html$/.test(location.pathname)) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  var lang = String(navigator.language || 'ko').slice(0, 2).toLowerCase() === 'ko' ? 'ko' : 'en';
  window.gtag('js', new Date());
  window.gtag('config', GA_MEASUREMENT_ID, {
    send_page_view: false, anonymize_ip: true, allow_google_signals: false, allow_ad_personalization_signals: false,
    page_location: 'app://console/', page_title: 'console', page_referrer: '',
  });
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_MEASUREMENT_ID);
  document.head.appendChild(s);

  var once = {};
  window.gaTrack = function (name, params) {
    try {
      var keys = ALLOWED[name];
      if (!keys) return;
      var out = { lang: lang, page_location: 'app://console/', page_title: 'console' };
      keys.forEach(function (k) {
        var v = params && params[k];
        if (k === 'kit' && !KIT_OK[v]) return;
        if (k === 'kind' && v !== 'crew' && v !== 'agent' && v !== 'group') return;
        if (v != null) out[k] = String(v);
      });
      if (name === 'message_send') { // 보낼 때마다 쓰면 너무 많아서 켠 뒤 처음 한 번과 이후 10번째마다만 센다
        once.n = (once.n || 0) + 1;
        if (once.n !== 1 && once.n % 10) return;
        out.count = String(once.n);
      }
      window.gtag('event', name, out);
    } catch (e) { /* 통계 때문에 화면이 멈추면 안 된다 */ }
  };
  window.gaTrack('app_open');
})();
