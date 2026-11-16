// 감자 콘솔 서비스 워커: 크롬이 "앱으로 설치"를 바로 띄워 주게 하는 최소 장치.
// 아무것도 저장(캐시)하지 않는다. 화면 이동 요청만 그대로 감자알에 넘기고,
// 감자알에 닿지 않을 때(꺼져 있을 때)만 짧은 안내 화면을 보여 준다. 나머지 요청(API·스트림·파일)은 건드리지 않는다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const OFFLINE_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>감자</title>
<style>body{font-family:system-ui,sans-serif;background:#FBF5E6;color:#1d1a14;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;text-align:center;padding:24px;box-sizing:border-box}button{margin-top:16px;padding:10px 20px;border-radius:10px;border:0;background:#1d1a14;color:#fff;font-size:15px}</style>
</head><body><div><div style="font-size:40px">🥔</div><p><b>감자에 연결하지 못했어요</b></p>
<p style="font-size:14px;opacity:.7">감자 앱이 켜져 있는지 확인해 주세요.<br>Make sure the GAMJA app is running.</p>
<button onclick="location.reload()">다시 시도 · Retry</button></div></body></html>`;

self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
