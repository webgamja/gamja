#!/bin/bash
# Ubuntu(proot) 안에서 실행됨 (scripts/install.sh가 호출). 감자 소스는 /mnt/gamja-src 에 연결돼 있다.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
SRC=/mnt/gamja-src
APP=/root/projects/gamja

echo "· 기본 패키지 설치"
apt-get update -y
apt-get install -y --no-install-recommends ca-certificates curl nodejs tar

major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$major" -lt 18 ]; then
  echo "Node.js 18 이상이 필요한데 $(node -v 2>/dev/null || echo '없음') 이에요. 더 최신 Ubuntu로 다시 시도해 주세요." >&2
  exit 1
fi

echo "· Claude Code 설치 (공식 설치 스크립트)"
if [ -x /root/.local/bin/claude ]; then
  echo "  이미 설치돼 있어요: $(/root/.local/bin/claude --version 2>/dev/null || true)"
else
  curl -fsSL https://claude.ai/install.sh | bash
fi

echo "· 감자 코드 복사 (대화 기록과 .env는 유지)"
mkdir -p "$APP"
tar -C "$SRC" --exclude=./data --exclude=./.env --exclude=./.git -cf - . | tar -C "$APP" -xf -
chmod +x "$APP/start.sh"

if [ ! -f "$APP/.env" ]; then
  pw=$(head -c 64 /dev/urandom | tr -dc 'a-zA-Z0-9' | head -c 12)
  cat > "$APP/.env" <<EOF
APP_PASSWORD=$pw
PORT=26514
HOST=0.0.0.0
CLAUDE_BIN=/root/.local/bin/claude
EOF
  chmod 600 "$APP/.env"
  echo "· 로그인 비밀번호를 만들었어요: $pw  (gamja status 로 다시 볼 수 있어요)"
fi
