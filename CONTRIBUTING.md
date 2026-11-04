# Contributing to GAMJA / 참여하기

Thank you for your interest! GAMJA is a young project, and help of any size is welcome: bug reports, ideas,
translations, documentation and code.
관심 가져 주셔서 고마워요. 버그 제보, 아이디어, 번역, 문서, 코드 어떤 도움이든 반가워요.

## Before you start / 시작하기 전에

- **Bugs and ideas**: open an [issue](../../issues) first. Please say which phone, Android version and GAMJA
  version you use (More → Information), and what you expected to happen.
  Never paste passwords, tokens or private conversations.
- **Big changes**: please open an issue and talk with us before you spend a lot of time on a pull request.
- **Security problems**: do **not** open an issue. See [SECURITY.md](SECURITY.md).
- Be kind. See the [Code of Conduct](CODE_OF_CONDUCT.md).

## Sign your commits (DCO) / 커밋에 서명하기

We use the [Developer Certificate of Origin](https://developercertificate.org/) (DCO) instead of a CLA.
By adding a `Signed-off-by` line you confirm that you wrote the change (or have the right to submit it)
and that it may be distributed under this project's license (Apache-2.0).
CLA 대신 DCO를 써요. 커밋에 `Signed-off-by` 한 줄을 붙이면, 직접 쓴 코드이거나 낼 권리가 있고 이 프로젝트의
라이선스(Apache-2.0)로 배포돼도 된다는 뜻이에요.

```bash
git commit -s -m "Fix the voice button on Android 8"
```

This adds a line like `Signed-off-by: Your Name <you@example.com>`, using your git `user.name` and `user.email`.
If you forgot, run `git commit --amend -s` (or `git rebase --signoff main` for several commits).
The full text you agree to:

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.

Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

## Project layout / 구조

| Path | What it is |
|---|---|
| `server.js` | gamja-egg, the small web server that runs `claude` and streams the answers (Node.js, **no npm dependencies**) |
| `public/` | The web screens: `index.html`, `app.js`, `style.css`, `i18n.js`, `templates.js`, ... |
| `tools/` | Helper command crews use to make documents, images, video and sound |
| `android/` | The Android app (Kotlin) that hosts the server and the WebView |
| `scripts/` | Install scripts for Termux / Ubuntu |
| `.github/workflows/` | CI that builds the APK and publishes releases |

## Running it on your computer / 내 컴퓨터에서 돌려 보기

You need Node.js 18+ and the [Claude Code](https://claude.com/claude-code) command line tool, signed in.

```bash
cp .env.example .env     # set APP_PASSWORD
./start.sh               # or: APP_PASSWORD=... node server.js
```

Open `http://localhost:26514`. There is no build step: restarting is deploying.
The Android app is built by GitHub Actions (`.github/workflows/android.yml`); you can also build it with Gradle
from `android/`. Builds without the official signing key are signed with a debug key.

## Code guidelines / 코드 규칙

- **No new npm dependencies.** The server and the web screens use only what Node.js and browsers provide.
- Write code that reads like the code around it: same naming, comment density and idiom.
  Comments in this repository are mostly in Korean; English comments are fine too.
- **Text on screen**: do not hard-code new user-facing text. Add a key to `public/i18n.js` with both `ko` and `en`
  and use `t('key')`. Korean is the source language.
- Keep it safe: never run shell commands built from user input, keep file access inside the crew folder,
  and escape everything you put into HTML.
- Do not commit passwords, tokens, keys, conversation data (`data/`) or `.env`.
- Please keep pull requests small and focused, and describe how you tested them
  (which phone/browser, which screens).

## Translations / 번역

English is the first extra language. If you find a text that is not translated or is awkward, a pull request
against `public/i18n.js` is the easiest way to help. Other languages are welcome after English is stable.

## License of contributions / 기여물의 라이선스

Your contribution is licensed under the [Apache License 2.0](LICENSE), the same as the project.
The names and logo of GAMJA are covered by the [trademark policy](TRADEMARK.md).
