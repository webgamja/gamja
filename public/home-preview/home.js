// 감자 홈페이지 시안 2: 스크롤 움직임 (나타나기, 폰 화면 바꾸기, 글자 채우기)
(function () {
  'use strict';
  var root = document.documentElement;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 화면 밝기
  var saved = null;
  try { saved = localStorage.getItem('home-theme'); } catch (e) { /* 무시 */ }
  root.dataset.theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.getElementById('theme').onclick = function () {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('home-theme', root.dataset.theme); } catch (e) { /* 무시 */ }
  };
  var nav = document.getElementById('nav');
  document.getElementById('menuBtn').onclick = function () { nav.classList.toggle('open'); };
  nav.addEventListener('click', function () { nav.classList.remove('open'); });

  // 머리글: 내려가면 얇은 선이 생긴다
  var hdr = document.querySelector('header');
  function onScroll() { hdr.classList.toggle('scrolled', window.scrollY > 8); }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // 나타나기: 화면에 들어오면 떠오른다
  var rv = [].slice.call(document.querySelectorAll('.rv'));
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
    rv.forEach(function (el) { io.observe(el); });
  } else { rv.forEach(function (el) { el.classList.add('in'); }); }

  // 스크롤 이야기: 가운데 선에 닿은 글에 맞춰 폰 화면이 바뀐다
  var steps = [].slice.call(document.querySelectorAll('.story .step'));
  var screens = [].slice.call(document.querySelectorAll('.story .screen'));
  function showStep(i) {
    steps.forEach(function (s, k) { s.classList.toggle('on', k === i); });
    screens.forEach(function (s, k) { s.classList.toggle('on', k === i); });
  }
  showStep(0);
  if ('IntersectionObserver' in window) {
    var so = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) showStep(steps.indexOf(e.target)); });
    }, { rootMargin: '-45% 0px -45% 0px' });
    steps.forEach(function (s) { so.observe(s); });
  }

  // 글자 채우기: 스크롤하는 만큼 글자가 하나씩 진해진다
  var fill = document.getElementById('fill');
  var words = [];
  if (fill) {
    var nodes = [].slice.call(fill.childNodes);
    fill.textContent = '';
    nodes.forEach(function (n) {
      var hl = n.nodeType === 1;
      var text = (hl ? n.textContent : n.textContent).split(/\s+/).filter(Boolean);
      text.forEach(function (w) {
        var sp = document.createElement('span');
        sp.textContent = w + ' ';
        if (hl) sp.className = 'hl';
        fill.appendChild(sp); words.push(sp);
      });
    });
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
})();
