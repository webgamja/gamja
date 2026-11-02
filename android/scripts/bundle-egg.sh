#!/usr/bin/env bash
# CI에서 실행: 감자알(gamja-egg, 감자 안에서 돌아가는 서버)을 APK assets에 묶는다 (개발용 파일·비밀번호·대화 기록 제외).
# 파일 이름이 .gz로 끝나면 안드로이드 빌드 도구가 압축을 풀고 이름을 바꾸므로 .pack을 쓴다 (내용은 tar.gz).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/android/app/src/main/assets"
mkdir -p "$OUT"
# 감자알 버전표: 자동 업데이트가 "내 것보다 새것인지" 비교할 때 쓴다 (CI 빌드 횟수)
echo "${GAMJA_BUILD:-0}" > "$ROOT/BUILD"
# 앱이 "폰 안 감자알이 이 묶음보다 옛것인지" 비교할 때 쓰는 번호 (앱 번호와는 따로 간다)
echo "${GAMJA_BUILD:-0}" > "$OUT/egg-build.txt"
tar -C "$ROOT" -czf "$OUT/gamja-egg.pack" \
  ./server.js ./public ./tools ./start.sh ./package.json ./README.md ./BUILD
ls -la "$OUT/gamja-egg.pack"
