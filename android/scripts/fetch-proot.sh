#!/usr/bin/env bash
# CI에서 실행: Termux 패키지 저장소에서 arm64용 proot와 proot가 필요로 하는 라이브러리를 모두 받아 APK assets에 넣는다.
# (proot: GPLv2, talloc: LGPLv3, libandroid-shmem: BSD — 수정 없이 별도 파일로 포함)
# 필요한 라이브러리는 패키지의 Depends 목록을 따라가며 자동으로 모으고,
# 마지막에 실제 실행 파일이 요구하는 라이브러리(NEEDED)가 전부 들어 있는지 검사한다.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO=https://packages.termux.dev/apt/termux-main
OUT=app/src/main/assets/bin
WORK=build/proot-work
USR=data/data/com.termux/files/usr
rm -rf "$WORK" "$OUT" && mkdir -p "$WORK" "$OUT"

fail() {
  echo "❌ $*" >&2
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '## ❌ proot 준비 실패\n```\n%s\n```\n' "$*" >> "$GITHUB_STEP_SUMMARY"
  fi
  exit 1
}

curl -fsSL "$REPO/dists/stable/main/binary-aarch64/Packages" -o "$WORK/Packages" \
  || curl -fsSL "$REPO/dists/stable/main/binary-aarch64/Packages.gz" | gunzip > "$WORK/Packages" \
  || fail "Termux 패키지 목록을 받지 못했어요"

# 패키지 정보의 한 항목 (Filename, Depends ...)
field() {
  awk -v p="$1" -v f="$2:" '$1=="Package:"{ok=($2==p)} ok && $1==f {sub(/^[^:]+: /,""); print; exit}' "$WORK/Packages"
}

declare -A SEEN=()
fetch() {
  local name=$1 file deps dep
  [ -n "${SEEN[$name]:-}" ] && return
  SEEN[$name]=1
  file=$(field "$name" Filename)
  [ -n "$file" ] || fail "패키지를 찾지 못함: $name"
  echo "· $name ← $file"
  curl -fsSL "$REPO/$file" -o "$WORK/$name.deb" || fail "내려받기 실패: $name"
  mkdir -p "$WORK/$name"
  (cd "$WORK/$name" && ar x "../$name.deb" && tar xf data.tar.*)
  # 이 패키지가 가진 공유 라이브러리를 모두 bin/으로 (심볼릭 링크는 실제 파일로)
  if [ -d "$WORK/$name/$USR/lib" ]; then
    find "$WORK/$name/$USR/lib" -maxdepth 1 -name '*.so*' | while read -r lib; do
      cp -L "$lib" "$OUT/$(basename "$lib")"
    done
  fi
  # 의존 패키지도 따라간다 ("a (>= 1), b | c" → a b)
  deps=$(field "$name" Depends | tr ',' '\n' | sed -E 's/\(.*\)//; s/\|.*//; s/[[:space:]]//g' | grep -v '^$' || true)
  for dep in $deps; do fetch "$dep"; done
}
fetch proot

cp -L "$WORK/proot/$USR/bin/proot" "$OUT/proot"
cp -L "$WORK/proot/$USR/libexec/proot/loader" "$OUT/loader"

# 검사: 실행 파일과 라이브러리가 요구하는 라이브러리가 bin/ 또는 안드로이드 시스템에 있는지
SYSTEM_LIBS=" libc.so libdl.so libm.so liblog.so libz.so libandroid.so "
missing=""
for f in "$OUT"/*; do
  for need in $(readelf -d "$f" 2>/dev/null | sed -n 's/.*(NEEDED).*\[\(.*\)\]/\1/p'); do
    if [ ! -e "$OUT/$need" ] && [[ "$SYSTEM_LIBS" != *" $need "* ]]; then
      missing+="$(basename "$f") → $need"$'\n'
    fi
  done
done
[ -z "$missing" ] || fail "APK에 빠진 라이브러리가 있어요:"$'\n'"$missing"

echo "✅ proot 준비 완료"
ls -la "$OUT"
