import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { launchDesktop, writeChatFixture, readChats } from './desktop';

test('chat titles are shared and manual names survive restart', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'escode-titles-')));
  const user = join(dir, 'user');
  await mkdir(user);
  execFileSync('git', ['init', dir]);
  await writeChatFixture(join(user, 'host-chats-v1.json'), JSON.stringify({ chats: [
    { id: 'title-chat', project: dir, checkout: dir, phase: 'draft', threadId: null, draft: '', title: 'Fix checkout navigation' },
  ] }));
  await writeFile(join(dir, 'codex'), `#!/usr/bin/env node
if(process.argv.includes('--version')){console.log('codex-cli 0.165.0');process.exit(0)}
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(!m.id||!m.method)return;
 const result=m.method==='initialize'?{userAgent:'codex/0.165.0'}:m.method==='config/read'?{config:{}}:{};
 process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');
});`, { mode: 0o700 });
  let app = await launchDesktop(user, dir);
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
  try {
    let page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, dir);
    await page.getByRole('button', { name: 'Open project…' }).click();
    await page.getByRole('button', { name: 'Agents', exact: true }).click();
    await page.locator('.agent-row').filter({ hasText: 'Fix checkout navigation' }).click();
    await page.getByText('Chat actions', { exact: true }).click();
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await page.getByLabel('Chat title', { exact: true }).fill('My deliberately longer manual title that exceeds forty characters');
    await page.getByRole('button', { name: 'Save title', exact: true }).click();
    await expect(page.locator('.agent-row')).toContainText('My deliberately longer manual title');
    await page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: basename(dir), exact: true }).click();
    await page.getByRole('button', { name: 'Chats', exact: true }).click();
    await expect(page.locator('.chat-list li button')).toContainText('My deliberately longer manual title that exceeds forty characters');
    await app.close();
    app = await launchDesktop(user, dir);
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
    page = await app.firstWindow();
    await page.getByRole('button', { name: 'Agents', exact: true }).click();
    await expect(page.locator('.agent-row')).toContainText('My deliberately longer manual title that exceeds forty characters');
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});

for (const initialMode of ['success', 'failure', 'empty', 'delay']) test(`title generation (${initialMode}) retains fallback and protects newer names`, async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'escode-title-generation-')));
  const user = join(dir, 'user');
  await mkdir(user);
  const { stat, readFile } = await import('node:fs/promises');
  const scratch = join(user, 'scratch', 'generation');
  await mkdir(scratch, { recursive: true });
  const identity = await stat(scratch);
  await writeChatFixture(join(user, 'host-chats-v1.json'), JSON.stringify({ chats: [
    { id: 'generation', createdAt: 123, project: null, checkout: scratch, threadId: 'task', phase: 'bound', hasSent: false, draft: '',
      scratch: { path: scratch, dev: identity.dev, ino: identity.ino }, directoryIdentity: { path: scratch, dev: identity.dev, ino: identity.ino } },
  ] }));
  await writeFile(join(dir, 'mode'), initialMode);
  await writeFile(join(dir, 'codex'), `#!/usr/bin/env node
const {createInterface}=require('node:readline');
const {readFileSync,appendFileSync,existsSync}=require('node:fs');
if(process.argv.includes('--version')){console.log('codex-cli 0.165.0');process.exit(0)}
let title=false,thread='task';
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(!m.id||!m.method)return;
 if(m.method==='thread/start'&&m.params.ephemeral){title=true;thread='title-'+process.pid;}
 appendFileSync(${JSON.stringify(join(dir, 'events'))},JSON.stringify({method:m.method,title,params:m.params})+'\\n');
 let result={};
 if(m.method==='initialize')result={userAgent:'codex/0.165.0'};
 if(m.method==='account/read')result={account:{}};
 if(m.method==='model/list')result={data:[{model:'gpt-6-luna'}],nextCursor:null};
 if(m.method==='thread/start'||m.method==='thread/resume')result={thread:{id:thread},cwd:process.cwd(),model:'fixture',reasoningEffort:'low',approvalPolicy:'never',sandbox:{type:'readOnly'}};
 if(m.method==='thread/turns/list')result={data:[],nextCursor:null};
 if(m.method==='turn/start'){
  result={turn:{id:'turn'}};
  const mode=readFileSync(${JSON.stringify(join(dir, 'mode'))},'utf8');
  if(title&&mode==='failure'){send({id:m.id,error:{code:-1,message:'unavailable'}});return;}
  const done=()=>{
   if(title)send({method:'item/completed',params:{threadId:thread,turnId:'turn',item:{id:'answer',type:'agentMessage',text:mode==='empty'?'':mode==='new'?'Improve checkout navigation':'Fix sidebar chat titles'}}});
   send({method:'turn/completed',params:{threadId:thread,turn:{id:'turn',status:'completed'}}});
  };
  if(title&&mode==='delay'){
   const timer=setInterval(()=>{if(existsSync(${JSON.stringify(join(dir, 'release'))})){clearInterval(timer);done();}},20);
  }else setTimeout(done,30);
 }
 send({id:m.id,result});
});`, { mode: 0o700 });
  const app = await launchDesktop(user, dir);
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Agents', exact: true }).click();
    await page.locator('.agent-row').click();
    await page.getByLabel('Message Codex').fill('Fix sidebar chat titles without losing drafts');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator('.agent-row')).toContainText('Fix sidebar chat titles');
    const events = async () => (await readFile(join(dir, 'events'), 'utf8')).trim().split('\n').map(s => JSON.parse(s));
    await expect.poll(async () => (await events()).filter(e => e.title && e.method === 'turn/start').length).toBe(1);
    await expect(page.locator('.agent-row strong')).toHaveText(initialMode === 'success' ? 'Fix sidebar chat titles' : 'Fix sidebar chat titles without losing drafts');
    if (initialMode === 'delay') {
      await expect(page.getByRole('status')).toHaveText('Ready');
      await writeFile(join(dir, 'release'), 'go');
      await expect(page.locator('.agent-row strong')).toHaveText('Fix sidebar chat titles');
      await rm(join(dir, 'release'));
    }
    await writeFile(join(dir, 'mode'), 'delay');
    await page.evaluate(() => window.escode.chat('regenerateTitle', null, 'generation'));
    await expect.poll(async () => (await events()).filter(e => e.title && e.method === 'turn/start').length).toBe(2);
    await page.evaluate(() => window.escode.chat('renameTitle', null, 'generation', 'Manual protected title'));
    await writeFile(join(dir, 'release'), 'go');
    await expect(page.locator('.agent-row strong')).toHaveText('Manual protected title');
    await rm(join(dir, 'release'));
    await writeFile(join(dir, 'mode'), 'delay');
    await page.evaluate(() => window.escode.chat('regenerateTitle', null, 'generation'));
    await expect.poll(async () => (await events()).filter(e => e.title && e.method === 'turn/start').length).toBe(3);
    await writeFile(join(dir, 'mode'), 'new');
    await page.evaluate(() => window.escode.chat('regenerateTitle', null, 'generation'));
    await expect(page.locator('.agent-row strong')).toHaveText('Improve checkout navigation');
    await writeFile(join(dir, 'release'), 'go');
    for (const mode of ['failure', 'empty']) {
      await writeFile(join(dir, 'mode'), mode);
      await page.evaluate(() => window.escode.chat('regenerateTitle', null, 'generation'));
      await expect.poll(async () => (await events()).filter(e => e.title && e.method === 'turn/start').length).toBe(mode === 'failure' ? 5 : 6);
      await expect(page.locator('.agent-row strong')).toHaveText('Improve checkout navigation');
    }
    expect((await page.evaluate(readChats, null))[0].createdAt).toBe(123);
    expect((await events()).filter(e => !e.title && e.method === 'turn/start')).toHaveLength(1);
    await page.screenshot({ path: 'test-results/chat-titles.png' });
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});
