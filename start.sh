#!/usr/bin/env bash
# tmux 세션에서 감자알(gamja-egg)을 띄운다.
#   ./start.sh          시작 (이미 떠 있으면 안내만)
#   ./start.sh restart  재시작
#   ./start.sh stop     종료
#   ./start.sh attach   로그 보기 (빠져나오기: Ctrl+b 다음 d)
set -euo pipefail
cd "$(dirname "$0")"
SESSION="${TMUX_SESSION:-gamja-egg}"

# .env 파일이 있으면 읽는다 (APP_PASSWORD 등)
if [ -f .env ]; then set -a; . ./.env; set +a; fi

case "${1:-start}" in
  run)
    # tmux 안에서 실행되는 부분. 서버가 종료되면(채팅에서 요청한 재시작 포함) 3초 후 다시 띄운다.
    # 새 코드가 시작하자마자 3번 연속 죽으면 마지막 안정 버전(data/versions)으로 자동 복구.
    export GAMJA_SUPERVISED=1
    fails=0
    while true; do
      if [ -f .env ]; then set -a; . ./.env; set +a; fi  # .env 변경도 재시작 때 반영
      started=$(date +%s)
      code=0
      node server.js || code=$?
      if [ "$code" -ne 0 ] && [ $(( $(date +%s) - started )) -lt 20 ]; then fails=$((fails + 1)); else fails=0; fi
      if [ "$fails" -ge 3 ]; then
        last=$(ls -1d "${DATA_DIR:-data}"/versions/*/ 2>/dev/null | sort | tail -1 || true)
        if [ -n "$last" ]; then
          echo "새 코드가 계속 죽어서 마지막 안정 버전으로 복구: $last"
          cp -a "$last". ./
          date '+%F %T' > "${DATA_DIR:-data}/rollback-note"
        fi
        fails=0
      fi
      echo "서버 종료됨 (코드 $code), 3초 후 재시작..."
      sleep 3
    done ;;
  stop)
    tmux kill-session -t "$SESSION" 2>/dev/null && echo "중지됨: $SESSION" || echo "실행 중 아님"
    exit 0 ;;
  attach)
    exec tmux attach -t "$SESSION" ;;
  restart)
    tmux kill-session -t "$SESSION" 2>/dev/null || true ;;
  start) ;;
  *) echo "사용법: $0 [start|restart|stop|attach]"; exit 1 ;;
esac

if [ -z "${APP_PASSWORD:-}" ]; then
  echo "APP_PASSWORD가 없습니다. .env 파일에 APP_PASSWORD=... 를 넣거나 환경변수로 지정하세요." >&2
  exit 1
fi
if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "이미 실행 중: tmux attach -t $SESSION"
  exit 0
fi

mkdir -p "${PROJECTS_DIR:-$HOME/projects}"
# tmux 서버가 이미 떠 있으면 현재 셸 환경이 상속되지 않으므로 PATH/HOME은 -e로 전달.
# 비밀번호는 명령줄(ps에 보임)에 넣지 않고, tmux 안에서 .env를 다시 읽는다.
ENV_ARGS=(-e "PATH=$PATH" -e "HOME=$HOME")
if [ ! -f .env ]; then
  echo "경고: .env가 없어 환경변수를 tmux 명령줄로 전달합니다 (ps에 노출됨). .env 사용을 권장합니다." >&2
  for v in APP_PASSWORD PORT HOST PROJECTS_DIR CLAUDE_BIN ALLOWED_TOOLS COOKIE_SECURE SESSION_DAYS; do
    [ -n "${!v:-}" ] && ENV_ARGS+=(-e "$v=${!v}")
  done
fi
tmux new-session -d -s "$SESSION" -c "$PWD" "${ENV_ARGS[@]}" "./start.sh run"
echo "시작됨 → http://0.0.0.0:${PORT:-3000}  (로그: ./start.sh attach)"
