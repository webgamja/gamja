# 1단계 테스트 보고 (권한 데이터 정리·생명주기) — 최종

작성: 2026-11-12 · 대상 코드: `server.js`, `tools/perm-policy.js`, `public/app.js`, `public/i18n.js`
다시 돌리기: `node tests/stage1/run.js`, `node tests/stage1/c5-security.js`, `node tests/stage1/fsync-check.js` (임시 감자알을 `data/test-work/`에 띄운다. 개발 폰 데이터는 쓰지 않는다. 끝나면 `data/test-work/`는 지워도 된다)

## 결과 요약
| 파일 | 건수 | 통과 | 미통과 |
|---|---|---|---|
| `run.js` (P1~P8, C1~C4, C5 코드 확인) | 38 | 38 | 0 |
| `c5-security.js` (C5 실행 10 + restore 보안 S.* + 정책 PP.*) | 81 | 81 | 0 |
| `fsync-check.js` (P9) | 2 | 2 | 0 |

`run.js`의 복구 호출 한 줄(P5)은 새 규칙(`confirm:true` 필수)에 맞춰 `{confirm:true}`를 보내도록 고쳤다. 검사 내용은 그대로다.

## 이번에 넣은 보안 보완 (승인된 4가지 + 정책 오탐 수정)
1. **구조·내용 검증** (`validatePermData`): 크루=배열, 항목=객체, `rule`=문자열(≤300자·제어 문자 없음·`Bash(…)` 모양), `cmd`=문자열(≤4000), `ts`=숫자, 크루당 ≤100개, 크루 ≤1000개. 너무 넓은 규칙(`Bash(*)`, `Bash(:*)`, `Bash()`, `node:*` 같은 아무 코드나 돌리는 프로그램의 `:*`)과, 지금 권한 정책(`perm-policy`)이 위험으로 보는 규칙(비밀·시스템 파일, 위험 프로그램 등)은 거절. **하나라도 이상하면 전체 거절**(일부 복구 없음), 현재 권한은 그대로. 거절 시 이유를 400으로 알림.
2. **로컬 요청만 + 확인 + 알림**: `isLocalReq`가 아니면 403(와이파이 접속을 켜고 로그인한 외부 기기도 403, `X-Forwarded-For`·`CF-Connecting-IP`가 있으면 로컬로 보지 않음). 본문 `confirm:true`(불리언)가 없으면 400. 복구하면 본문 `project`의 채팅에 알림을 남기고 감자알 로그에도 기록.
3. **Origin 검사** (`sameOriginReq`): `POST /api/perm/*`(answer, remove, restore-backup, migration-notice/ack)에서 `Sec-Fetch-Site: cross-site`이거나 `Origin`이 있는데 `Host`(또는 `X-Forwarded-Host`)와 다르면(`null` 포함) 403. `Origin`이 없는 요청(앱·내부 호출)은 통과. 화면의 요청은 전부 같은 주소로 가는 `fetch(credentials: same-origin)`이라 막히지 않는다(`public/app.js`에서 확인). 권한 API 외의 다른 API는 건드리지 않았다.
4. **백업 파일 검사**: `lstat`으로 일반 파일인지 확인. 심볼릭 링크·폴더는 거절.
5. **정책 오탐 수정 (A안만)**: `tools/perm-policy.js`의 "작업 폴더 밖 덮어쓰기" 검사가 따옴표 안의 `>`·`>>` 글자(문장, 커밋 메시지)에 걸리던 것만 고침(`redirectsOutside`). 따옴표 밖의 진짜 리다이렉트(`> /etc/y`, `>> ~/f`, `> $HOME/x`, `> ../x`, `> "/etc/y"`)는 그대로 위험. 글을 다른 프로그램으로 실행할 수 있는 말(eval, sh/bash, awk, sed, node, python …)이 명령에 있으면 따옴표 안도 예전처럼 검사하고, 따옴표가 안 닫혀도 예전 검사. 위험 단계 정책·주의 단계는 바꾸지 않았다.
   - 남은 오탐(범위 밖, 안 고침): 비밀·시스템 파일 검사(`/etc/` 등)는 따옴표 안의 글자에도 반응한다.

기존 복구 동작(가장 최근 백업 선택, `-prerestore` 제외, 되돌리기 전 현재 상태를 `-prerestore`로 백업)은 그대로이고 테스트(S.names, S.val.prerestore)로 확인했다.

## 새로 추가된 테스트 (c5-security.js)
- Origin: 위조 4종(다른 출처·Origin만 다름·`null`·주소 뒤에 붙인 가짜) 403 + 권한 변화 없음, 같은 주소 Origin 200, `perm/remove`·`perm/answer`·`migration-notice/ack` 위조 403, `perm/remove` 정상 200, 다른 API 영향 없음.
- confirm: 없음/문자열 400, 알림이 채팅에 남음.
- 구조·내용: 17종 거절(배열 아님, rule 숫자, 항목 문자열, 넓은 규칙 4종, Bash 아님, 100개 초과, 긴 글자, 제어 문자, cmd·ts 오류, 비밀 파일, 위험 프로그램, `__proto__`, 좋은 것+나쁜 것 혼합) — 모두 400 + 현재 권한 동일. 정상 형식 200.
- lstat: 심볼릭 링크·폴더 거절.
- 로컬 제한: 와이파이 접속 켬 + 외부 주소 + 로그인 → 다른 API 200, 되돌리기 403 / 같은 설정에서 로컬 200 / 프록시 흔적 403.
- 정책(PP.*): 오탐 5건 안 위험, 진짜 밖 쓰기 8건 위험, `/dev/null` 허용, eval·sh -c·awk·따옴표 안 닫힘 위험, 비밀·위험 프로그램·감자알 폴더 위험 유지.

## 알려진 한계
- Cloudflare 터널(Pro, 아직 없음)이 `Host`를 바꿔서 전달하면 `Origin`과 달라져 권한 API가 403이 될 수 있다. 터널을 만들 때 `X-Forwarded-Host` 전달 또는 허용 목록을 같이 정한다.
- 권한 되돌리기 화면 버튼은 아직 없다(내부 API와 수동 절차).

## C5 — 채팅 zip 가져오기 → 권한 초기화 (실행 확인, 이전 보고와 동일)
- 가짜 claude를 붙인 임시 감자알에서 실제 `POST /api/rooms/import`로 확인: 새 크루 규칙 0(메모리·디스크), 다른 크루 유지, permOnce가 새 방의 첫 실행 인자에 없음, 요약 호출은 크루 규칙 없이 읽기 전용 도구만 쓰고 권한 비우기는 요약 전에 실행됨.
- 기존 크루에 붙이는 현재 동작은 2단계의 "항상 새 크루"로 사라진다.

## 보존한 자료
- T-B3 흔적 요약과 해석은 `import-permission-safety-proposal.md` 1절. 테스트 스크립트는 `tests/stage1/`.
