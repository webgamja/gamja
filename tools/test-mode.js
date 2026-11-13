'use strict';
// 시험용 주입 지점(GAMJA_TEST_*)의 단 하나뿐인 관문.
// - 시험 모드는 GAMJA_TEST_MODE=1 일 때만 켜진다. 시험 하네스(tests/)만 이것을 켠다.
// - 시험 모드가 아니면 모든 시험 기능은 꺼져 있다: env('이름')은 항상 undefined를 돌려준다 (환경변수가 있어도 읽지 않는다).
// - 운영 모드(시험 모드 아님)에서 GAMJA_TEST_* 가 하나라도 있으면 감자알이 켜지지 않는다 (남아 있는 설정이 몰래 작동하지 않도록).
// - 시험 모드는 운영 환경에서 켜지지 않는다: start.sh 감시 아래(GAMJA_SUPERVISED=1), GAMJA_HOME 사용, DATA_DIR·PROJECTS_DIR 미지정,
//   DATA_DIR가 감자알 폴더의 data/ 와 같으면 켜지지 않는다.
const path = require('path');

const PREFIX = 'GAMJA_TEST_';
const raw = process.env.GAMJA_TEST_MODE;
const ON = raw === '1';

function hookNames(env = process.env) {
  return Object.keys(env).filter((k) => k.startsWith(PREFIX) && k !== 'GAMJA_TEST_MODE');
}
// 켜도 되는 환경인지 확인한다. 문제가 있으면 이유를 돌려주고, 없으면 ''.
function problem(env = process.env, root = path.join(__dirname, '..')) {
  const raw0 = env.GAMJA_TEST_MODE;
  if (raw0 !== undefined && raw0 !== '' && raw0 !== '1') return `GAMJA_TEST_MODE 값은 1이거나 없어야 해요 (지금: ${raw0}).`;
  const on = raw0 === '1';
  const hooks = hookNames(env);
  if (!on) return hooks.length ? `운영 모드에서는 시험용 설정(${hooks.join(', ')})을 쓸 수 없어요. 지우고 다시 켜 주세요.` : '';
  if (env.GAMJA_SUPERVISED === '1') return '시험 모드는 start.sh 감시 아래(운영)에서 켤 수 없어요.';
  if (env.GAMJA_HOME) return '시험 모드는 GAMJA_HOME을 쓰는 환경(운영)에서 켤 수 없어요.';
  if (!env.DATA_DIR || !env.PROJECTS_DIR) return '시험 모드는 DATA_DIR와 PROJECTS_DIR를 따로 정해야 켜져요.';
  if (path.resolve(env.DATA_DIR) === path.resolve(root, 'data')) return '시험 모드는 감자알 폴더의 data/ 를 쓸 수 없어요.';
  return '';
}
function env(name) { return ON ? process.env[PREFIX + name] : undefined; }
// 감자알이 켜질 때 한 번: 문제가 있으면 끝내고, 아니면 상태를 한 줄로 남긴다
function enforce(log = console, exit = (c) => process.exit(c)) {
  const why = problem();
  if (why) { log.error(`❌ 시험 기능 격리: ${why}`); exit(1); return false; }
  log.log(ON ? '[감자알] 시험 모드: 켜짐 (시험용 주입 지점 사용 가능)' : '[감자알] 시험 모드: 꺼짐 (운영 모드)');
  return true;
}
module.exports = { ON, env, hookNames, problem, enforce };
