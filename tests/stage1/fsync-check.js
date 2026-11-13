// P9: 이 폰 파일시스템에서 파일·폴더 fsync가 되는지 확인
const fs = require('fs');
const path = require('path');
const d = path.join(__dirname, '..', '..', 'data', 'test-work', 'fsync');
fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(d, 'a'), 'x');
let fd = fs.openSync(path.join(d, 'a'), 'r');
try { fs.fsyncSync(fd); console.log('파일 fsync OK'); } catch (e) { console.log('파일 fsync 오류', e.code); }
fs.closeSync(fd);
fs.renameSync(path.join(d, 'a'), path.join(d, 'b'));
try { fd = fs.openSync(d, 'r'); fs.fsyncSync(fd); fs.closeSync(fd); console.log('폴더 fsync OK'); } catch (e) { console.log('폴더 fsync 오류', e.code); }
