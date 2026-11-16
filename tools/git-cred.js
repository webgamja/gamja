#!/usr/bin/env node
// 🐙 git 크레덴셜 도우미: 크루의 git이 GitHub 열쇠가 필요할 때 감자알에게 받아서 건넨다.
// 열쇠는 크루의 대화·파일에 남지 않는다. 감자알이 "고른 저장소만"을 확인하고, 아니면 주지 않는다.
// 감자알이 크루를 실행할 때 GIT_CONFIG_* 환경 변수로 이 파일을 git의 credential.helper로 지정한다 (server.js의 gitEnv)
'use strict';

if (process.argv[2] !== 'get') process.exit(0); // store·erase는 할 일이 없다 (열쇠는 감자알만 가진다)

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', async () => {
  const q = {};
  for (const line of input.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) q[line.slice(0, i)] = line.slice(i + 1);
  }
  if (q.protocol !== 'https' || q.host !== 'github.com' || !process.env.GAMJA_GIT_URL) return;
  try {
    const r = await fetch(process.env.GAMJA_GIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Gamja-Git-Key': process.env.GAMJA_GIT_KEY || '' },
      body: JSON.stringify({ path: q.path || '' }),
      signal: AbortSignal.timeout(10000),
    });
    const d = await r.json();
    if (d.password) process.stdout.write(`username=${d.username}\npassword=${d.password}\n`);
    else process.stderr.write(`감자: ${d.error || 'GitHub 열쇠를 받지 못했어요'}\n`);
  } catch {
    process.stderr.write('감자: 감자알에 연결하지 못해 GitHub 열쇠를 받지 못했어요\n');
  }
});
