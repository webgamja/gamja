// 웹감자(webgamja) 홈페이지 스크립트: 스크롤 움직임(나타나기, 폰 화면 바꾸기, 글자 채우기)과 방문 통계(기본 집계, 추적 안 함 신호 존중)
(function () {
  'use strict';
  // 구글 애널리틱스(GA4) 측정 ID. 비워 두면 방문 통계를 전혀 쓰지 않는다. 예: 'G-XXXXXXXXXX'
  var GA_MEASUREMENT_ID = 'G-TEHPG2PZTW';

  var root = document.documentElement;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 화면 밝기: 지금은 밝은 화면만 쓴다 (어두운 화면 스타일은 style.css에 남겨 두었다. 나중에 쓰려면 여기서 data-theme를 정하면 된다)
  root.dataset.theme = 'light';

  // 폰 화면 메뉴
  var nav = document.getElementById('nav');
  var menuBtn = document.getElementById('menuBtn');
  if (nav && menuBtn) {
    menuBtn.onclick = function () { nav.classList.toggle('open'); };
    nav.addEventListener('click', function () { nav.classList.remove('open'); });
  }

  // 머리글: 내려가면 얇은 선이 생긴다
  var hdr = document.querySelector('header');
  function onScroll() { if (hdr) hdr.classList.toggle('scrolled', window.scrollY > 8); }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // 나타나기: 화면에 들어오면 떠오른다
  var rv = [].slice.call(document.querySelectorAll('.rv'));
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
    rv.forEach(function (el) { io.observe(el); });
  } else { rv.forEach(function (el) { el.classList.add('in'); }); }

  // 스크롤 이야기: 글이 올라가는 길을 따라 폰 화면이 바뀐다
  var steps = [].slice.call(document.querySelectorAll('.story .step'));
  var screens = [].slice.call(document.querySelectorAll('.story .screen'));
  var stickyEl = document.querySelector('.story .sticky');
  var phoneEl = stickyEl && stickyEl.querySelector('.phone');
  if (steps.length && stickyEl) {
    // 폰 화면에서는 폰 모형을 붙어 있는 칸 높이에 맞게 줄이고, 몇 번째 단계인지 점으로 보여 준다
    var dotsEl = document.createElement('div');
    dotsEl.className = 'dots';
    steps.forEach(function () { dotsEl.appendChild(document.createElement('i')); });
    stickyEl.appendChild(dotsEl);
    var fitPhone = function () {
      if (!phoneEl) return;
      if (window.innerWidth <= 860) {
        var s = Math.min(1, Math.max(0.4, (stickyEl.clientHeight - 40) / 590));
        phoneEl.style.transform = 'scale(' + s + ')';
      } else { phoneEl.style.transform = ''; }
    };
    window.addEventListener('resize', fitPhone); fitPhone();
    var showStep = function (i) {
      steps.forEach(function (s, k) { s.classList.toggle('on', k === i); });
      screens.forEach(function (s, k) { s.classList.toggle('on', k === i); });
      [].forEach.call(dotsEl.children, function (d, k) { d.classList.toggle('on', k === i); });
      if (window.__track) window.__track('story_step', { step: i + 1 }, true);
    };
    showStep(0);
    // 글이 올라가는 길(화면 아래 끝 0 → 글이 보이는 영역의 위 끝 1) 중 몇 %를 지났는지로 "지금 읽는 글"을 정한다.
    // 78%를 지나기 전까지는 그 글이 진하게 보이고, 넘으면 흐려지면서 아래에서 올라오던 다음 글이 진해진다.
    // 큰 화면: 화면 아래 끝에서 머리글 아래까지. 폰 화면: 폰 모형 윗부분에서 머리글 아래까지
    var cur = 0, ticking = false;
    var pickStep = function () {
      ticking = false;
      var vh = window.innerHeight, top = 60, bottom = vh;
      if (window.innerWidth <= 860) bottom = Math.min(vh, stickyEl.getBoundingClientRect().top);
      var region = Math.max(120, bottom - top), LIMIT = 0.78;
      var best = -1, bp = -Infinity;
      steps.forEach(function (s, i) {
        var r = s.getBoundingClientRect();
        var p = (bottom - (r.top + r.height / 2)) / region;
        if (p <= LIMIT && p > bp) { bp = p; best = i; }
      });
      if (best < 0) best = steps.length - 1; // 모든 글이 지나갔으면 마지막 글
      if (best !== cur) { cur = best; showStep(best); }
    };
    var queuePick = function () { if (!ticking) { ticking = true; requestAnimationFrame(pickStep); } };
    window.addEventListener('scroll', queuePick, { passive: true });
    window.addEventListener('resize', queuePick);
    pickStep();
  }

  // 글자 채우기: 스크롤하는 만큼 글자가 하나씩 진해진다
  var fill = document.getElementById('fill');
  if (fill) {
    var words = [];
    [].slice.call(fill.childNodes).forEach(function (n) {
      var hl = n.nodeType === 1;
      n.textContent.split(/\s+/).filter(Boolean).forEach(function (w) {
        var sp = document.createElement('span');
        sp.textContent = w + ' ';
        if (hl) sp.className = 'hl';
        words.push(sp);
      });
    });
    fill.textContent = '';
    words.forEach(function (sp) { fill.appendChild(sp); });
    var tick = function () {
      var r = fill.getBoundingClientRect(), vh = window.innerHeight;
      var p = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (r.height + vh * 0.3)));
      var n = reduce ? words.length : Math.round(p * words.length);
      words.forEach(function (sp, i) { sp.classList.toggle('on', i < n); });
    };
    window.addEventListener('scroll', tick, { passive: true }); window.addEventListener('resize', tick); tick();
  }

  // 흐르는 크루: 내용을 두 번 이어 붙여서 끊김 없이 돌게 한다
  [].forEach.call(document.querySelectorAll('.track'), function (t) { t.innerHTML += t.innerHTML; });

  // 방문 통계 (구글 애널리틱스): 동의 창 없이 기본으로 집계한다. 개인정보처리방침 6번과 같은 내용이다.
  // 브라우저의 "추적 안 함(DNT)"이나 Global Privacy Control 신호를 켜 둔 방문자는 처음부터 집계하지 않는다
  // 서비스 초기에는 최대한 모으려고 브라우저의 "추적 안 함"(DNT)·Global Privacy Control 신호와 관계없이 집계한다 (2026-11-04부터. 개인정보처리방침 6번에 적어 두었다)
  // 나중에 신호를 따르려면 아래 값을 true로 바꾼다
  var HONOR_DNT = false;
  var signal = HONOR_DNT && (navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true);
  function loadGA() {
    if (!GA_MEASUREMENT_ID || window.__gaLoaded) return;
    window.__gaLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_MEASUREMENT_ID, { anonymize_ip: true, allow_google_signals: false, allow_ad_personalization_signals: false });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_MEASUREMENT_ID);
    document.head.appendChild(s);
  }
  if (!GA_MEASUREMENT_ID) return;
  window['ga-disable-' + GA_MEASUREMENT_ID] = signal; // 구글 애널리틱스가 정해 둔 "집계 끄기" 스위치
  if (signal) return;
  loadGA();

  // 어디서 들어와서 어디까지 보고 무엇을 눌렀는지: 기본 측정(페이지, 유입 경로, 기기, 위치)에 아래 행동을 더한다
  // 이벤트 이름: download_click(내려받기), github_click, lang_switch(언어 바꿈), nav_click(메뉴), scroll_depth(25/50/75/100%), story_step(이야기 1~4단계), contact_click(메일)
  var sent = {};
  function track(name, params, once) {
    var key = name + JSON.stringify(params || {});
    if (once && sent[key]) return;
    sent[key] = 1;
    if (window.gtag) window.gtag('event', name, params || {});
  }
  window.__track = track;
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a');
    if (!a) return;
    var href = a.getAttribute('href') || '';
    var where = a.closest('header') ? 'header' : a.closest('footer') ? 'footer' : 'page';
    if (/gamja\.apk/.test(href)) track('download_click', { place: where });
    else if (/^mailto:/.test(href)) track('contact_click', { place: where });
    else if (/github\.com/.test(href)) track('github_click', { place: where, link: href.replace(/^https?:\/\/github\.com\//, '').slice(0, 60) });
    else if (a.hasAttribute('lang') && a.classList.contains('icon-btn')) track('lang_switch', { to: a.getAttribute('lang') });
    else if (a.closest('nav')) track('nav_click', { link: href.slice(0, 40) });
  });
  var depths = [25, 50, 75, 100];
  function onDepth() {
    var h = document.documentElement.scrollHeight - window.innerHeight;
    if (h <= 0) return;
    var p = window.scrollY / h * 100;
    depths.forEach(function (d) { if (p >= d) track('scroll_depth', { percent: d }, true); });
  }
  window.addEventListener('scroll', onDepth, { passive: true });
})();
