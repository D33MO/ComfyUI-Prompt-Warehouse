// NODE_PATH must point to a Playwright installation. No pack dependency.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const send = (type, body) => { res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); res.end(body); };
  if (req.url === '/scripts/app.js') return send('text/javascript', 'export const app = window.app;');
  if (req.url === '/scripts/api.js') return send('text/javascript', 'export const api = {};');
  if (req.url.startsWith('/extensions/pw/')) return send('text/javascript', fs.readFileSync(path.join(root, 'web', req.url.split('/').at(-1)), 'utf8'));
  send('text/html', `<html><head><style>.widget{width:500px;height:340px;margin:50px;background:#263d28}textarea{background:#222;color:#ddd}</style></head><body><div class="widget"></div><script>
    window.app={ui:{settings:{getSettingValue:()=>window.locale||'en'}},registerExtension:e=>window.extension=e};
    const input=document.createElement('textarea'); input.value='portrait, large breasts, sunset';
    document.querySelector('.widget').append(input);
    const promptWidget={name:'prompt',element:input,callback:()=>window.inputCallbacks++};
    Object.defineProperty(promptWidget,'value',{get:()=>input.value,set:v=>input.value=v});
    Object.defineProperty(promptWidget,'inputEl',{get:()=>promptWidget.element});
    window.inputCallbacks=0;input.addEventListener('input',()=>promptWidget.callback());
    window.node={widgets:[promptWidget],size:[500,600],addWidget(){},setDirtyCanvas(){window.dirty=true}};
    </script><script type="module">
      import '/extensions/pw/prompt_warehouse.js';
      import {weightSelection,attachPromptWeightControls} from '/extensions/pw/prompt_weight.js';
      window.weightSelection=weightSelection;window.attach=()=>attachPromptWeightControls(window.node,window.node.widgets[0]);
      function Node(){};window.extension.beforeRegisterNodeDef(Node,{name:'PromptWarehouse'});Node.prototype.onNodeCreated.call(window.node);
      window.ready=true;
    </script></body></html>`);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.PW_BROWSER_CHANNEL || 'msedge' });
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    const errors = [];page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.ready);
    const input=page.locator('textarea');
    const button=action=>page.locator(`[data-weight-action="${action}"]`);
    const select=async(start,end)=>{await input.focus();await input.evaluate((el,r)=>el.setSelectionRange(...r),[start,end]);};
    assert.equal(await page.locator('[data-weight-action]').count(),3);
    const textBox=await input.boundingBox(),toolbar=await page.locator('.pw-node-weight-controls').boundingBox();
    assert.ok(toolbar.x>=textBox.x+textBox.width);
    await select(10,23);await button('wrap').click();
    assert.equal(await input.inputValue(),'portrait, (large breasts), sunset');
    await button('increase').click();
    assert.equal(await input.inputValue(),'portrait, (large breasts:1.1), sunset');
    await button('increase').click();await button('increase').click();
    assert.equal(await input.inputValue(),'portrait, (large breasts:1.3), sunset');
    await button('wrap').click();
    assert.equal(await input.inputValue(),'portrait, (large breasts:1.3), sunset');
    for(let i=0;i<4;i++) await button('decrease').click();
    assert.equal(await input.inputValue(),'portrait, (large breasts:0.9), sunset');
    assert.equal(await page.evaluate(()=>window.node.widgets[0].value),'portrait, (large breasts:0.9), sunset');
    assert.ok(await page.evaluate(()=>window.inputCallbacks>0&&window.dirty));
    await input.press('Control+z');
    assert.equal(await input.inputValue(),'portrait, (large breasts:1), sunset');
    // Existing weighted text loaded with the workflow is also recognized.
    await input.fill('before (cat:1.25) after');await select(7,17);
    await button('increase').click();
    assert.equal(await input.inputValue(),'before (cat:1.35) after');
    await select(8,11);await button('decrease').click();
    assert.equal(await input.inputValue(),'before (cat:1.25) after');
    await input.fill('cat');await select(0,3);await button('decrease').click();
    assert.equal(await input.inputValue(),'(cat:0.9)');
    for(let i=0;i<20;i++)await button('decrease').click();
    assert.equal(await input.inputValue(),'(cat:-1.1)');
    // No selection and whitespace are no-ops; keyboard activation and fallback work.
    await input.fill('cat');await select(0,0);await button('increase').click();
    assert.equal(await input.inputValue(),'cat');
    await input.fill('   ');await select(0,3);await button('wrap').click();
    assert.equal(await input.inputValue(),'   ');
    await input.fill('cat');await select(0,3);
    await page.evaluate(()=>document.execCommand=()=>false);
    await input.press('Tab');await page.keyboard.press('Enter');
    assert.equal(await input.inputValue(),'(cat)');
    await button('increase').click();assert.equal(await input.inputValue(),'(cat:1.1)');
    await page.evaluate(()=>window.attach());
    assert.equal(await page.locator('[data-weight-action]').count(),3);
    // Nested groups, two adjacent groups, unicode and decimal rounding.
    const cases=[['((cat:1.2), dog:0.8)','increase','((cat:1.2), dog:0.9)'],['(cat:1), (dog:1)','increase','((cat:1), (dog:1):1.1)'],['猫\n花','wrap','(猫\n花)'],['(cat:1.2)','wrap',null]];
    for(const [value,action,expected] of cases){
      const actual=await page.evaluate(({value,action})=>window.weightSelection(value,0,value.length,action)?.text??null,{value,action});
      assert.equal(actual,expected);
    }
    await page.locator('.widget').evaluate(el=>{el.style.width='300px';el.style.height='220px';el.style.transform='scale(0.7)';el.style.transformOrigin='top left';});
    const resized=await input.boundingBox(), resizedToolbar=await page.locator('.pw-node-weight-controls').boundingBox();
    assert.ok(resizedToolbar.x>=resized.x+resized.width);
    const resizedParent=await page.locator('.widget').boundingBox();
    assert.ok(resizedToolbar.x+resizedToolbar.width<=resizedParent.x+resizedParent.width+1);
    assert.deepEqual(errors,[]);
    console.log('PASS: node right toolbar, parentheses, repeated +/- and existing weights, undo, widget sync, keyboard, fallback, rounding, resize/zoom');
  } finally { if(browser)await browser.close();await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
