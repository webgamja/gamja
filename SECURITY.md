# Security policy / 보안 정책

## Reporting a vulnerability / 취약점 제보

**Please do not open a public issue for security problems.**
보안 문제는 공개 이슈로 올리지 말아 주세요.

- Email: **help@webgamja.com** with the subject starting with `[SECURITY]`
- Or use GitHub's **Report a vulnerability** button (Security tab → Advisories), which is private.

Please include / 이렇게 알려 주세요:

- What you found and where (file, screen or API)
- Steps to reproduce, and what an attacker could do
- Your GAMJA version (More → Information) and Android version
- Please do **not** include passwords, tokens, conversation contents or personal data

We are a small team and respond on a best-effort basis. We aim to acknowledge a report within 7 days, and to
tell you when a fix is released. If you want to be credited, tell us how.
작은 팀이라 최선을 다해 답해요. 보통 7일 안에 접수 확인을 드리는 것을 목표로 해요.

## Scope / 범위

GAMJA runs a small web server (called "gamja-egg") on your own phone. It starts the `claude` command-line tool in
your project folders, so anyone who can log in to it can read and change files on that phone. Things we especially
care about:

- Bypassing the login, the password change, or the login attempt limit
- Reading or writing files outside the chosen crew folder (path traversal)
- Cross-site scripting or script injection from generated results (the preview screen) or chat content
- Leaking the password, tokens or conversations
- Problems in the update mechanism (the app or gamja-egg installing something unexpected)

Out of scope: problems that need physical access to an unlocked phone, a weak password you chose yourself,
vulnerabilities in Claude Code, Android, Ubuntu or other third-party software (please report those upstream).

## Supported versions / 지원 버전

Only the latest release receives security fixes. GAMJA updates itself, so please update before reporting.

## Safe use / 안전하게 쓰려면

- Choose a long, unique password. Don't expose the port to the public internet; use the same Wi-Fi, a VPN
  or a private tunnel instead.
- Keep the app updated.
