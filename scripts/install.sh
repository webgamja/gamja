#!/data/data/com.termux/files/usr/bin/bash
# 감자 설치 (Termux에서 실행). 이 파일이 들어 있는 감자 폴더를 Ubuntu(proot) 안에 설치하고 실행까지 한다.
#   bash scripts/install.sh
# 다시 실행하면 코드만 업데이트한다. 대화 기록(data/)과 비밀번호(.env)는 유지된다.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DISTRO="${GAMJA_DISTRO:-ubuntu}"
say() { printf '\n\033[1;33m🥔 %s\033[0m\n' "$*"; }

if [ ! -d /data/data/com.termux ] || [ -z "${PREFIX:-}" ]; then
  echo "Termux 앱 안에서 실행해 주세요. (Termux는 F-Droid 또는 GitHub 버전을 설치하세요. Play 스토어 버전은 오래됐어요)" >&2
  exit 1
fi

say "1/5 Termux 패키지 설치 (몇 분 걸려요)"
yes | pkg upgrade -y -o Dpkg::Options::="--force-confnew" || true
pkg install -y proot-distro tmux net-tools curl

say "2/5 Ubuntu 환경 준비"
if proot-distro login "$DISTRO" -- true >/dev/null 2>&1; then
  echo "이미 설치돼 있어요."
else
  proot-distro install "$DISTRO"
fi

say "3/5 Ubuntu 안에 Node.js · Claude Code · 감자 설치"
proot-distro login "$DISTRO" --bind "$SRC:/mnt/gamja-src" -- bash /mnt/gamja-src/scripts/setup-ubuntu.sh

say "4/5 gamja 명령과 자동 실행 설정"
install -m 755 "$SRC/scripts/gamja" "$PREFIX/bin/gamja"
# Termux:Boot 앱이 있으면 폰을 켤 때 감자가 자동으로 시작된다
mkdir -p "$HOME/.termux/boot"
cat > "$HOME/.termux/boot/gamja" <<'EOF'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
gamja start
EOF
chmod +x "$HOME/.termux/boot/gamja"

say "5/5 감자 실행"
gamja restart

# Claude 로그인은 감자가 직접 받지 않고, 공식 Claude Code 화면을 그대로 띄워 준다
say "Claude 로그인 (공식 Claude Code 화면)"
cat <<'EOF'
이제 공식 Claude Code 화면이 열려요. 감자는 화면을 띄워 주기만 하고,
로그인 정보는 감자를 거치지 않고 Anthropic과 직접 주고받아요.

  1) 처음 설정 화면(테마 등)이 나오면 Enter로 넘어가세요.
  2) 로그인 방법에서 Claude 계정(구독)을 고르세요.
  3) 나온 주소를 브라우저에서 열어 로그인하고, 받은 코드를 붙여 넣으세요.
  4) 로그인이 끝나면 /exit 를 입력해 나오세요.

이미 로그인돼 있다면 바로 /exit 하면 돼요.
EOF
read -r -p "지금 로그인할까요? [Y/n] " ans </dev/tty || ans=n
case "${ans:-Y}" in
  [nN]*) echo "나중에 gamja login 으로 언제든 로그인할 수 있어요." ;;
  *) gamja login || true ;;
esac

cat <<EOF

────────────────────────────────────────
🥔 설치 완료!

남은 일 (처음 한 번만):
  1) 안드로이드 설정 → 앱 → Termux → 배터리 → "제한 없음"
     (안 하면 화면이 꺼졌을 때 감자가 멈출 수 있어요)
  2) (선택) Termux:Boot 앱을 설치하면 폰을 켤 때 자동으로 시작돼요.

Claude 로그인을 다시 하려면:  gamja login
접속 주소와 비밀번호:         gamja status
────────────────────────────────────────
EOF
gamja status
