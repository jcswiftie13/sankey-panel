/* 部署設定的「同一個值散在多個檔案」守門測試。
   這些是**結構上不可收斂**的：Docker 的 environment 與 k8s 的 secretKeyRef 是兩套 runtime 的
   注入機制、Makefile／compose／kustomize 是三套互不相通的變數系統。收斂不了就用斷言抓漂移。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/* NGINX_ENVSUBST_FILTER 漏一處的後果是**靜默**的：官方 envsubst 腳本用 name ~ /$filter/
   挑環境變數，filter 空字串時對每一個都成立，於是 conf 裡的 $uri／$host／$trace_api 全被
   換成空字串。最惡劣的是 try_files $uri $uri/ /index.html 變成 try_files / /index.html——
   仍然是合法語法，nginx 照常啟動然後每個路徑都回 index.html，沒有任何錯誤訊息。 */
test('NGINX_ENVSUBST_FILTER=^TRACE_ 出現在每一個會起 nginx 的檔案裡', () => {
  const files = ['Dockerfile', 'docker-compose.yml', 'docker-compose.dev.yml', 'deploy/k8s/deployment.yaml'];
  /* 一定要連著值一起比對。寫成寬鬆的 /NGINX_ENVSUBST_FILTER/ 有兩個實測過的失效方式：
     (1) NGINX_ENVSUBST_FILTER_X 這種打錯的名字**包含**正確的名字，照樣通過；
     (2) Dockerfile 的註解裡也提到這個變數名，所以光是「檔案裡有這個字串」不代表真的設了。
     兩種宣告形狀：Dockerfile／compose 是「名字=值」同一行，k8s 是 `- name:` 換行 `value:`。 */
  const sameLine = /NGINX_ENVSUBST_FILTER["']?\s*[:=]\s*["']?\^TRACE_/;
  const k8sPair = /name:\s*["']?NGINX_ENVSUBST_FILTER["']?\s*\n\s*value:\s*["']?\^TRACE_/;
  for (const f of files) {
    const t = read(f);
    assert.ok(sameLine.test(t) || k8sPair.test(t),
      f + ' 少了 NGINX_ENVSUBST_FILTER=^TRACE_（或名字／值被改過）');
  }
});

/* 內容映像名在三套工具裡各寫一次（Makefile 用 $(IMAGE)-content 拼、compose 用
   ${CONTENT_IMAGE:-…} 的預設值、kustomize 硬編）。改 Makefile 的 IMAGE 不會連動另外兩處。 */
test('內容映像名的三處預設值一致', () => {
  const image = /^IMAGE\s*\?=\s*(\S+)/m.exec(read('Makefile'));
  assert.ok(image, 'Makefile 的 IMAGE 宣告找不到了');
  const expect = image[1] + '-content';
  assert.match(read('docker-compose.yml'), new RegExp('CONTENT_IMAGE:-' + expect));
  assert.match(read('deploy/kustomization.yaml'), new RegExp(expect));
});

/* 安全標頭的單一來源。add_header 不繼承是 nginx 的事實（location 自己寫了一行，server 層
   那一組就對它失效），所以四個位置都要有；但內容抽成 security-headers.conf 一份。
   這條抓的是「有人又在某個 location 直接寫 add_header X-Frame-Options」那種回頭路。 */
test('安全標頭只有一份定義，四個位置各 include 一次', () => {
  const tpl = read('deploy/templates/default.conf.template');
  const snippet = read('deploy/templates/security-headers.conf');
  const includes = tpl.match(/include\s+\/etc\/nginx\/templates\/security-headers\.conf;/g) || [];
  assert.equal(includes.length, 4,
    'include 次數不是 4（server 層＋/api/＋= /index.html＋/assets/）：' + includes.length);
  for (const h of ['X-Frame-Options', 'X-Content-Type-Options']) {
    assert.match(snippet, new RegExp('add_header\\s+' + h), 'snippet 少了 ' + h);
    assert.doesNotMatch(tpl, new RegExp('add_header\\s+' + h),
      'template 又直接寫了 ' + h + '，應該只出現在 security-headers.conf');
  }
  /* Cache-Control 刻意留在各 location（那是每個 location 自己的語意，不是共用的安全標頭） */
  assert.match(tpl, /add_header\s+Cache-Control/, 'Cache-Control 應該留在 template 的 location 裡');
  /* 放錯目錄會被主 nginx.conf 的 include conf.d/*.conf 當成獨立設定吃掉 */
  assert.doesNotMatch(tpl, /\/etc\/nginx\/conf\.d\/security-headers/, 'snippet 不能放在 conf.d/');
  /* k8s 那條路徑靠 configMapGenerator 把檔案列進去才會出現在 /etc/nginx/templates */
  assert.match(read('deploy/kustomization.yaml'), /templates\/security-headers\.conf/,
    'kustomization 沒有把 snippet 列進 ConfigMap，k8s 上 include 會找不到檔案');
});

/* dev proxy 與 nginx 都要送同一個 header（CLAUDE.md §11：兩邊要一起改，否則 dev 與正式環境
   行為分歧）。名字寫死在兩個不同語言的檔案裡，沒有共用來源。 */
test('X-API-Key 與 TRACE_API_AUTH 在 dev proxy 與 nginx template 兩邊都在', () => {
  for (const f of ['app/vite.config.js', 'deploy/templates/default.conf.template']) {
    assert.match(read(f), /X-API-Key/i, f + ' 少了 X-API-Key');
    assert.match(read(f), /TRACE_API_AUTH/, f + ' 少了 TRACE_API_AUTH');
  }
});
