# 감자 안드로이드 앱 (v0.1)

폰 하나를 "나만의 Claude Code 서버"로 만드는 앱. Termux 없이 APK 하나로 동작한다.

## 흐름
1. **준비** (첫 실행, 10~20분): proot(APK에 포함) → Ubuntu 24.04 base(공식 이미지 다운로드) → apt로 Node.js → **공식 설치 스크립트로 Claude Code** → 감자 서버(APK에 포함) → 비밀번호 생성
2. **Claude 로그인**: 앱 안의 터미널에 **공식 Claude Code 화면**을 그대로 띄운다. 감자는 로그인 정보를 다루지 않는다.
3. **채팅**: 상시 실행 서비스가 Ubuntu 안에서 `start.sh run`(감시 루프)을 돌리고, 앱은 한 번만 쓰는 로그인 표를 받아 폰의 브라우저로 `http://127.0.0.1:26514`(감자 콘솔)를 연다 (자동 로그인). 포트는 감자알의 `.env`에 적힌 `PORT`를 읽는다. 예전에 설치한 폰은 3000, 새로 설치한 폰은 26514다.
   메뉴 → "다른 기기에서 접속"에서 같은 와이파이용 주소와 비밀번호를 확인한다.

## 설계 메모
- `targetSdk 28`: 29 이상이면 앱 데이터 폴더의 프로그램을 실행할 수 없다 (Termux와 같은 제약). 그래서 Play 스토어 대신 홈페이지에서 배포한다.
- Termux 앱을 포크하지 않는다 (GPLv3). 터미널 화면은 Termux의 `terminal-view` 라이브러리(Apache 2.0)만 쓴다.
- proot·loader·libtalloc은 CI가 Termux 패키지 저장소에서 받아 APK에 넣는다 (`scripts/fetch-proot.sh`, 수정 없이 별도 실행 파일).
- Claude Code는 APK에 넣지 않는다. 사용자 기기가 공식 경로로 직접 설치한다.

## 빌드
GitHub Actions(`.github/workflows/android.yml`)가 main에 push될 때마다 APK를 만든다 → Actions 실행 결과의 **gamja-apk** 아티팩트.
