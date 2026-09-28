// Run with NODE_PATH pointing to a Playwright installation. No pack dependency.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, 'web', name), 'utf8');
const current = [{ name: 'style.safetensors', strength: 0.65, enabled: true }, { name: 'detail.safetensors', strength: -0.2, enabled: false }];
let entries = [{ id: 'missing', title: 'Missing combination', group: 'Test', loras: [{ name: 'absent.safetensors', strength: 1, enabled: true }] }];
let stale = true;
const server = http.createServer(async (req, res) => {
  const send = (type, body, code = 200) => { res.writeHead(code, { 'Content-Type': `${type}; charset=utf-8` }); res.end(body); };
  const json = (body, code) => send('application/json', JSON.stringify(body), code);
  if (req.url === '/scripts/app.js') return send('text/javascript', 'export const app = window.app;');
  if (req.url === '/scripts/api.js') return send('text/javascript', 'export const api = {fetchApi:(...args)=>fetch(...args)};');
  if (req.url.startsWith('/extensions/pw/')) return send('text/javascript', source(req.url.split('/').at(-1)));
  if (req.url === '/prompt-warehouse/session') return json({ token: 'valid' });
  if (req.url === '/prompt-warehouse/lora-presets') {
    if (req.method === 'GET') return json({ entries, lora_names: ['style.safetensors', 'detail.safetensors'] });
    if (stale) { stale = false; return json({ code: 'token' }, 403); }
    assert.equal(req.headers['x-prompt-warehouse-token'], 'valid');
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    if (payload.action === 'save') entries = [...entries.filter(e => e.id !== payload.preset.id), payload.preset];
    else entries = entries.filter(e => e.id !== payload.id);
    return json({ entries });
  }
  send('text/html', `<html><body style="background:#222"><script>
    window.app={ui:{settings:{getSettingValue:()=>window.locale||'en'}},registerExtension:e=>window.extension=e};
    window.node={graph:{},widgets:[{name:'lora_config',value:${JSON.stringify(JSON.stringify(current))}}],size:[355,120],
      addCustomWidget(w){this.widgets.push(w)},addWidget(type,name,value,callback){const w={type,name,value,callback};this.widgets.push(w);return w},
      setSize(s){this.size=s},computeSize(){return [355,200]},setDirtyCanvas(){}};
  </script><script type="module">
    import '/extensions/pw/multi_lora_loader.js';
    function Node(){}; window.extension.beforeRegisterNodeDef(Node,{name:'PromptWarehouseMultiLoraLoader',input:{required:{lora_config:['STRING',{lora_names:['style.safetensors','detail.safetensors']}]}}});
    window.configure=()=>Node.prototype.onConfigure.call(window.node);
    Node.prototype.onNodeCreated.call(window.node);
    window.open=()=>window.node.widgets.find(w=>w.name=== (window.locale==='zh'?'LoRA 搭配预设':'LoRA Presets')).callback();
    window.ready=true;
  </script></body></html>`);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.PW_BROWSER_CHANNEL || 'msedge' });
    const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.ready);
    await page.evaluate(() => { window.configure(); window.configure(); window.open(); });
    await page.locator('[data-title]').fill('Style + detail');
    assert.equal(await page.locator('[data-group]').count(), 0);
    assert.equal(await page.locator('[data-mode]').textContent(), 'Draft');
    await page.locator('[data-save]').click();
    await page.getByText('Combination saved.', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-mode]').textContent(), 'Saved');
    assert.deepEqual(entries.find(e => e.title === 'Style + detail').loras, current.filter(row => row.enabled));
    assert.equal(await page.locator('[data-rows] th').count(), 3);
    assert.equal(await page.locator('[data-rows] tbody tr').count(), 1);
    assert.deepEqual(await page.evaluate(() => {
      const index = window.node.widgets.findIndex(w => w.type === 'pw-lora-divider');
      return [window.node.widgets[index - 1].name, window.node.widgets[index + 1].name,
        window.node.widgets.filter(w => w.type === 'pw-lora-divider').length];
    }), ['＋ Add LoRA', 'LoRA Presets', 1]);
    await page.getByRole('button', { name: /Missing combination/ }).click();
    assert.equal(await page.locator('[data-load]').isDisabled(), true);
    const modelSelect = page.locator('[data-rows] select').first();
    const strengthInput = page.locator('[data-rows] input[type=number]').first();
    await modelSelect.selectOption('detail.safetensors');
    assert.equal(await page.locator('[data-mode]').textContent(), 'Unsaved');
    assert.equal(await page.locator('[data-load]').isEnabled(), true);
    await strengthInput.fill('');
    assert.equal(await page.locator('[data-save]').isDisabled(), true);
    assert.equal(await page.locator('[data-load]').isDisabled(), true);
    await strengthInput.fill('-0.375');
    assert.equal(await page.locator('[data-save]').isEnabled(), true);
    await page.locator('[data-load]').click();
    assert.equal(await page.locator('.pw-presets').count(), 0);
    assert.deepEqual(await page.evaluate(() => JSON.parse(window.node.widgets[0].value)),
      [{name:'detail.safetensors',strength:-0.375,enabled:true}]);
    assert.equal(entries.find(e => e.id === 'missing').loras[0].name, 'absent.safetensors');
    await page.evaluate(() => window.open());
    await page.getByRole('button', { name: /Missing combination/ }).click();
    await page.locator('[data-rows] select').first().selectOption('detail.safetensors');
    await page.locator('[data-rows] input[type=number]').first().fill('-0.375');
    await page.locator('[data-save]').click();
    await page.getByText('Combination saved.', { exact: true }).waitFor();
    assert.equal(entries.find(e => e.id === 'missing').loras[0].strength, -0.375);
    assert.equal(await page.locator('[data-mode]').textContent(), 'Saved');
    await page.locator('[data-add-lora]').click();
    assert.equal(await page.locator('[data-rows] tbody tr').count(), 2);
    assert.equal(await page.locator('[data-rows] input').last().inputValue(), '1');
    assert.equal(await page.locator('[data-mode]').textContent(), 'Unsaved');
    await page.locator('[data-rows] select').last().selectOption('detail.safetensors');
    await page.locator('[data-rows] input').last().fill('0.5');
    await page.locator('[data-save]').click();
    await page.getByText('Combination saved.', { exact: true }).waitFor();
    assert.deepEqual(entries.find(e => e.id === 'missing').loras[1], {name:'detail.safetensors',strength:0.5,enabled:true});
    let rowDeleteDialogs = 0;
    const rejectRowDialog = dialog => { rowDeleteDialogs++; dialog.dismiss(); };
    page.on('dialog', rejectRowDialog);
    await page.locator('[data-remove-lora]').last().click();
    assert.equal(await page.locator('[data-rows] tbody tr').count(), 1);
    assert.equal(await page.locator('[data-mode]').textContent(), 'Unsaved');
    assert.equal(entries.find(e => e.id === 'missing').loras.length, 2);
    await page.locator('[data-remove-lora]').first().click();
    assert.equal(await page.locator('[data-rows] tbody tr').count(), 0);
    assert.equal(await page.locator('[data-save]').isDisabled(), true);
    assert.equal(await page.locator('[data-load]').isDisabled(), true);
    assert.equal(rowDeleteDialogs, 0);
    page.off('dialog', rejectRowDialog);
    await page.getByRole('button', { name: /Style \+ detail/ }).click();
    await page.locator('[data-load]').click();
    assert.equal(await page.locator('.pw-presets').count(), 0);
    assert.deepEqual(await page.evaluate(() => JSON.parse(window.node.widgets[0].value)), current.filter(row => row.enabled));
    assert.equal(await page.evaluate(() => window.node.widgets.filter(w => w.name === 'LoRA Presets').length), 1);
    await page.evaluate(() => window.open());
    await page.getByRole('button', { name: /Style \+ detail/ }).click();
    await page.locator('[data-title]').fill('Renamed');
    assert.equal(await page.locator('[data-mode]').textContent(), 'Unsaved');
    await page.locator('[data-title]').fill('Style + detail');
    assert.equal(await page.locator('[data-mode]').textContent(), 'Saved');
    await page.evaluate(() => { window.node.widgets[0].value = JSON.stringify([
      {name:'style.safetensors',strength:0.8,enabled:true},
      {name:'disabled-missing.safetensors',strength:1,enabled:false}]); });
    await page.locator('[data-capture]').click();
    assert.equal(await page.locator('[data-rows] tbody tr').count(), 1);
    assert.equal(await page.locator('[data-load]').isEnabled(), true);
    assert.equal(await page.locator('[data-mode]').textContent(), 'Unsaved');
    await page.locator('[data-title]').fill('Renamed');
    await page.locator('[data-save]').click();
    await page.getByText('Combination saved.', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-mode]').textContent(), 'Saved');
    assert.equal(entries.length, 2);
    page.on('dialog', dialog => dialog.accept());
    await page.locator('[data-delete]').click();
    await page.getByText('Combination deleted.', { exact: true }).waitFor();
    assert.equal(entries.length, 1);
    await page.locator('[data-close]').click();
    await page.evaluate(() => { window.locale = 'zh'; window.configure(); window.open(); });
    await page.getByRole('heading', { name: 'LoRA 搭配预设' }).waitFor();
    await page.getByRole('button', { name: '＋ 新增当前搭配', exact: true }).waitFor();
    assert.equal(await page.locator('[data-mode]').textContent(), '草稿');
    await page.setViewportSize({ width: 420, height: 760 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.evaluate(() => { window.node.widgets[0].value = JSON.stringify([{name:'style.safetensors',strength:1,enabled:false}]); });
    await page.locator('[data-new]').click();
    assert.equal(await page.locator('[data-rows] tbody tr').count(), 0);
    assert.equal(await page.locator('[data-save]').isDisabled(), true);
    await page.locator('[data-add-lora]').click();
    assert.equal(await page.locator('[data-rows] tbody tr').count(), 1);
    assert.equal(await page.locator('[data-save]').isEnabled(), true);
    await page.setViewportSize({ width: 420, height: 760 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.pw-presets').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: save, stale token retry, rename, missing file, load, delete, workflow reload, Chinese locale and narrow layout');
  } finally { await browser?.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
