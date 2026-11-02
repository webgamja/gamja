// 감자 앱 안에서의 음성 어댑터 (듣기 + 읽어주기).
// 안드로이드 WebView에는 음성 인식·읽기가 없거나 껍데기뿐이라서, 앱이 폰의 기능(GamjaApp.voice*, GamjaApp.tts*)을 대신 써 준다.
// 여기서는 그것을 크롬의 SpeechRecognition / speechSynthesis처럼 보이게 만들어서, 🎤·음성 대화·읽어주기 코드(app.js)는 그대로 쓴다.
// 크롬 같은 일반 브라우저나, 음성 기능이 없는 옛 앱에서는 아무것도 하지 않는다.
(function () {
  const app = window.GamjaApp;
  if (!app) return;
  const fire = (obj, fn, ev) => { if (typeof fn === 'function') { try { fn.call(obj, ev); } catch (e) { console.error(e); } } };

  // ---------- 🎤 듣기 ----------
  // 앱의 WebView에는 webkitSpeechRecognition이라는 이름이 껍데기로만 있고, 시작하면 곧바로 "not-allowed"를 돌려준다.
  // 그래서 "이미 있으니 그만둔다"가 아니라, 앱이 음성 기능을 갖고 있으면 항상 이쪽으로 바꿔 끼운다.
  if (typeof app.voiceStart !== 'undefined') {
    let available = false;
    try { available = !!app.voiceAvailable(); } catch { /* 앱이 알려 주지 못하면 없는 것으로 */ }
    if (available) {
      let current = null; // 지금 듣고 있는(또는 끝을 기다리는) 인식기

      class AppSpeechRecognition {
        constructor() {
          this.lang = 'ko-KR';
          this.interimResults = true;
          this.continuous = false;
          this.maxAlternatives = 1;
          this._open = false;
        }
        start() {
          if (current && current._open) throw new Error('already started');
          current = this;
          this._open = true;
          app.voiceStart(this.lang);
        }
        stop() { if (this._open) app.voiceStop(); }
        abort() { if (this._open) app.voiceAbort(); }
      }

      // 앱(MainActivity)이 부르는 곳: type = start | speechstart | result | error | end
      window.__gamjaSR = {
        event(type, text, isFinal) {
          const r = current;
          if (!r) return;
          switch (type) {
            case 'start': fire(r, r.onstart, {}); break;
            case 'speechstart': fire(r, r.onspeechstart, {}); break;
            case 'result': {
              const alt = { transcript: String(text || ''), confidence: 1 };
              const result = [alt];
              result.isFinal = !!isFinal;
              fire(r, r.onresult, { resultIndex: 0, results: [result] });
              break;
            }
            case 'error': fire(r, r.onerror, { error: String(text || 'error') }); break;
            case 'end':
              r._open = false;
              current = null;
              fire(r, r.onend, {});
              break;
          }
        },
      };
      window.SpeechRecognition = AppSpeechRecognition;
      window.webkitSpeechRecognition = AppSpeechRecognition;
    }
  }

  // ---------- 🔊 읽어주기 ----------
  // WebView의 speechSynthesis는 소리가 안 나거나 아예 없는 폰이 있어서, 폰의 TextToSpeech로 읽도록 바꿔 끼운다.
  if (typeof app.ttsSpeak !== 'undefined') {
    const pending = new Map(); // 읽는 중이거나 순서를 기다리는 발화: id → utterance
    let seq = 0;

    class AppUtterance {
      constructor(text) {
        this.text = text === undefined ? '' : String(text);
        this.lang = '';
        this.rate = 1;
        this.pitch = 1;
        this.volume = 1;
        this.voice = null;
      }
    }

    const synth = {
      speaking: false,
      pending: false,
      paused: false,
      onvoiceschanged: null,
      getVoices() { return []; },
      pause() {}, // 폰의 읽기 기능은 일시정지를 못 해서 지원하지 않는다
      resume() {},
      speak(u) {
        const text = String(u.text || '').trim();
        if (!text) { setTimeout(() => fire(u, u.onend, {}), 0); return; } // iOS식 "잠금 해제용 빈 말"은 읽을 게 없다
        const id = 'u' + (++seq);
        pending.set(id, u);
        synth.speaking = true;
        try { app.ttsSpeak(id, text, u.lang || 'ko-KR', Number(u.rate) || 1); }
        catch { pending.delete(id); synth.speaking = pending.size > 0; setTimeout(() => fire(u, u.onerror, { error: 'synthesis-failed' }), 0); }
      },
      cancel() {
        const list = [...pending.values()];
        pending.clear();
        synth.speaking = false;
        try { app.ttsStop(); } catch { /* 앱이 못 멈춰도 화면은 정리한다 */ }
        for (const u of list) fire(u, u.onerror, { error: 'canceled' });
      },
    };

    // 앱(MainActivity)이 부르는 곳: type = start | end | error
    window.__gamjaTTS = {
      event(id, type) {
        const u = pending.get(id);
        if (!u) return;
        if (type === 'start') { fire(u, u.onstart, {}); return; }
        pending.delete(id);
        synth.speaking = pending.size > 0;
        fire(u, type === 'error' ? u.onerror : u.onend, type === 'error' ? { error: 'synthesis-failed' } : {});
      },
    };

    window.SpeechSynthesisUtterance = AppUtterance;
    try { Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true, writable: true }); }
    catch { /* 바꿀 수 없으면 원래 것을 그대로 쓴다 */ }
  }
})();
