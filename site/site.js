// 감자 홈페이지 스크립트: 화면 밝기, 메뉴, 최신 버전 표시, 방문 통계(동의한 사람만)
(function () {
  'use strict';
  // 구글 애널리틱스(GA4) 측정 ID. 비워 두면 방문 통계를 전혀 쓰지 않고 동의 창도 나타나지 않는다. 예: 'G-XXXXXXXXXX'
  var GA_MEASUREMENT_ID = '';

  var en = document.documentElement.lang === 'en';
  var root = document.documentElement;

  // 화면 밝기: 사용자가 고른 것을 우선, 없으면 기기 설정을 따른다
  var saved = null;
  try { saved = localStorage.getItem('home-theme'); } catch (e) { /* 저장이 막혀 있어도 동작한다 */ }
  root.dataset.theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  var themeBtn = document.getElementById('theme');
  if (themeBtn) themeBtn.onclick = function () {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('home-theme', root.dataset.theme); } catch (e) { /* 무시 */ }
  };

  // 폰 화면 메뉴
  var nav = document.getElementById('nav');
  var menuBtn = document.getElementById('menuBtn');
  if (nav && menuBtn) {
    menuBtn.onclick = function () { nav.classList.toggle('open'); };
    nav.addEventListener('click', function () { nav.classList.remove('open'); });
  }

  // 최신 버전 번호 (실패해도 내려받기 버튼은 항상 최신 APK를 받아 온다)
  var ver = document.getElementById('ver');
  if (ver && window.fetch) {
    fetch('https://api.github.com/repos/webgamja/gamja-release/releases/latest')
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.name) ver.textContent = d.name; })
      .catch(function () { /* 번호를 못 가져와도 괜찮다 */ });
  }

  // 방문 통계 (구글 애널리틱스): 사용자가 동의하기 전에는 아무것도 불러오지 않는다
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
  function choice() { try { return localStorage.getItem('home-consent'); } catch (e) { return null; } }
  function setChoice(v) { try { localStorage.setItem('home-consent', v); } catch (e) { /* 무시 */ } }

  var box = document.getElementById('consent');
  var reset = document.getElementById('consentReset');
  if (!GA_MEASUREMENT_ID) {
    if (reset) reset.style.display = 'none'; // 방문 통계를 안 쓰는 동안은 설정 링크도 숨긴다
    return;
  }
  function showBox() { if (box) box.style.display = 'flex'; }
  function hideBox() { if (box) box.style.display = 'none'; }
  var c = choice();
  if (c === 'yes') loadGA(); else if (!c) showBox();
  if (box) {
    box.querySelector('.yes').onclick = function () { setChoice('yes'); hideBox(); loadGA(); };
    box.querySelector('.no').onclick = function () { setChoice('no'); hideBox(); };
  }
  if (reset) reset.onclick = function (e) { e.preventDefault(); showBox(); };
  void en;
})();
