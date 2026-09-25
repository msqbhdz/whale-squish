/*
 * 手机视口验收:用 iPhone 尺寸(390x844)打开线上地址,
 * 检查是否横向溢出、元素是否可见,并截一张竖屏图。
 *
 * 用法: node tools/mobile_check.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const URL_ = process.env.CHECK_URL || 'https://msqbhdz.github.io/whale-squish/';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = path.join(__dirname, '..', 'shots', 'mobile.png');
const PORT = 9400 + Math.floor(Math.random() * 90);
const PROFILE = path.join(process.env.TEMP, 'edge-mob-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// iPhone 12/13/14 逻辑分辨率
const W = 390, H = 844;

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars', '--force-device-scale-factor=3',
    `--window-size=${W + 100},${H + 100}`, '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROFILE], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 80; i++) {
    await sleep(500);
    try {
      targets = await getJson('/json/list');
      if (targets && targets.some((t) => t.type === 'page' && t.webSocketDebuggerUrl)) break;
    } catch (e) {}
  }
  const target = (targets || []).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!target) { console.error('拿不到调试目标'); child.kill(); process.exit(2); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const logs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') logs.push('[EXCEPTION] ' + m.params.exceptionDetails.text);
  };
  await new Promise((r) => { ws.onopen = r; });
  await send('Runtime.enable'); await send('Page.enable');
  // 关键:按手机视口 + 触摸模拟
  await send('Emulation.setDeviceMetricsOverride',
    { width: W, height: H, deviceScaleFactor: 3, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url: URL_ });
  await sleep(4000);

  const r = await send('Runtime.evaluate', {
    expression: `JSON.stringify((function(){
      var de = document.documentElement;
      var stage = document.getElementById('stage');
      var sb = stage ? stage.getBoundingClientRect() : null;
      var hint = document.getElementById('hint');
      var reset = document.getElementById('reset');
      return {
        title: document.title,
        viewport: window.innerWidth + 'x' + window.innerHeight,
        horizontalOverflow: de.scrollWidth > window.innerWidth + 1,
        scrollWidth: de.scrollWidth,
        bodyHeight: de.scrollHeight,
        stageBox: sb ? {x:Math.round(sb.left), y:Math.round(sb.top), w:Math.round(sb.width), h:Math.round(sb.height)} : null,
        hasBlowhole: !!document.getElementById('blowhole'),
        spoutDrops: (document.getElementById('spoutDrops')||{children:[]}).children.length,
        hintVisible: !!hint && getComputedStyle(hint).opacity !== '0',
        resetInView: !!reset && reset.getBoundingClientRect().right <= window.innerWidth + 1
      };
    })())`,
    returnByValue: true,
  });
  console.log('手机视口检查结果:');
  console.log(JSON.stringify(JSON.parse(r.result.value), null, 2));

  // 模拟手指按住往下拖,看形变是否生效
  const box = JSON.parse(r.result.value).stageBox;
  const cx = Math.round(box.x + box.w / 2), cy = Math.round(box.y + box.h / 2);
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
  for (let i = 1; i <= 10; i++) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy + i * 12 }] });
    await sleep(30);
  }
  await sleep(300);
  const squeezed = await send('Runtime.evaluate', {
    expression: 'document.getElementById("squish").getAttribute("transform")',
    returnByValue: true,
  });
  console.log('触摸拖动后的形变: ' + squeezed.result.value);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log('竖屏截图: ' + OUT);
  console.log(logs.length ? logs.join('\n') : '无 JS 异常');

  ws.close(); child.kill();
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.error('ERR ' + e.message); process.exit(1); });

function getJson(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p, timeout: 4000 }, (r) => {
      let d = ''; r.on('data', (c) => (d += c));
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}
