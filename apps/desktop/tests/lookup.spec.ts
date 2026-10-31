import { test, expect, _electron } from '@playwright/test';
import { mkdtemp, realpath, mkdir, writeFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { FoundationState } from '../host/foundation-state';
import { Workspace } from '../host/workspace';
import { launchDesktop } from './desktop';
import { createServer } from 'vite-plus';
import electron from 'electron';

test('lookup ranks and highlights unloaded files, file changes converge and activation keeps the file', async () => {
 const dir=await realpath(await mkdtemp(join(tmpdir(),'escode-lookup-'))), root=join(dir,'repo');
 execFileSync('git',['init',root]); await mkdir(join(root,'deep')); await writeFile(join(root,'deep/workbench.ts'),'unloaded editor target');
 // Static metadata fixture: full retained history, including a closed root and default-glob targets.
 await mkdir(join(dir,'user'),{recursive:true});
 const foundation=FoundationState.open(join(dir,'user/foundation'));
 const {hostId,clientId}=foundation.read();foundation.close();
 const seeded=[{root:join(dir,'closed'),path:'closed-only.txt'},{root,path:'.DS_Store'},
   {root,path:'node_modules/.DS_Store'},{root,path:'node_modules/known.txt'},
   ...Array.from({length:196},(_,i)=>({root,path:`cap${String(i).padStart(3,'0')}.txt`}))];
 await new Workspace(join(dir,'user/client-workspace-v1.json'),{hostId,clientId}).write({projects:[],selected:'',views:{},drafts:[],recentFiles:seeded});
 await mkdir(join(root,'node_modules'));await writeFile(join(root,'node_modules/known.txt'),'ignored familiar file');
 await writeFile(join(root,'.gitignore'),'node_modules/\n');
 const server=process.env.ESCODE_LOOKUP_DEV ? await createServer({server:{host:'127.0.0.1',port:0,strictPort:true}}) : undefined;
 await server?.listen();
 const env: Record<string,string>={...process.env,ESCODE_DEV_URL:server?.resolvedUrls!.local[0] ?? ''};delete env.ELECTRON_RUN_AS_NODE;
 const launch=()=>server ? _electron.launch({executablePath:electron as unknown as string,args:['.',`--user-data-dir=${join(dir,'user')}`],env}) : launchDesktop(join(dir,'user'));
 let app=await launch();
 try { let page=await app.firstWindow();
 await app.evaluate(({dialog},root)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[root]});},root);
 await page.getByRole('button',{name:'Open project…',exact:true}).click();
 await expect(page.getByRole('treeitem',{name:'deep',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Find file',exact:true}).click();
 await page.getByLabel('Exact file path').fill('closed-only');
 await expect(page.getByRole('dialog',{name:'Find file',exact:true}).getByRole('status')).toContainText('No eligible matches');
 await page.getByLabel('Exact file path').fill('DS_Store');
 await expect(page.getByRole('dialog',{name:'Find file',exact:true}).getByRole('status')).toContainText('No eligible matches');
 await page.getByLabel('Exact file path').fill('known');
 await expect(page.getByRole('group',{name:'Recent files'}).getByRole('option')).toHaveText(['node_modules/known.txt']);
 await page.getByLabel('Exact file path').fill('wkb');
 const result=page.getByRole('option',{name:'deep/workbench.ts',exact:true}); await expect(result).toBeVisible();
 await expect(result.locator('mark')).toHaveText(['w','k','b']);
 await writeFile(join(root,'workbench.ts'),'basename wins');
 await expect(page.getByRole('option',{name:'workbench.ts',exact:true})).toBeVisible();
 await rename(join(root,'workbench.ts'),join(root,'deep/workbench-new.ts'));
 await expect(page.getByRole('option',{name:'workbench.ts',exact:true})).toHaveCount(0);
 await expect(page.getByRole('option',{name:'deep/workbench-new.ts',exact:true})).toBeVisible();
 await rm(join(root,'deep/workbench-new.ts'));
 await expect(page.getByRole('option',{name:'deep/workbench-new.ts',exact:true})).toHaveCount(0);
 await rename(root,root+'-away');
 await expect(page.getByRole('status').filter({hasText:'Live updates unavailable'})).toBeVisible();
 await rename(root+'-away',root);
 await page.getByRole('dialog',{name:'Find file',exact:true}).getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Live updates unavailable'})).toHaveCount(0);
 await page.evaluate(async root=>{ await window.escode.project('create-entry',root,'','workbench.ts','file'); },root);
 await expect(page.getByRole('option').first()).toHaveText('workbench.ts');
 await page.screenshot({path:'test-results/recursive-lookup.png'});
 await page.getByLabel('Exact file path').focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
 await expect(page.getByRole('dialog',{name:'Find file',exact:true})).toHaveCount(0);
 await expect(page.locator('.monaco-editor:visible')).toContainText('unloaded editor target');
 await expect(page.getByRole('tab',{name:'deep/workbench.ts',exact:true})).not.toHaveAccessibleDescription(/Preview/);
 await page.getByRole('button',{name:'Find file',exact:true}).click();
 await expect(page.getByLabel('Exact file path')).toHaveValue('');
 await expect(page.getByRole('group',{name:'Recent files'}).getByRole('option').first()).toHaveText('deep/workbench.ts');
 await expect(page.getByRole('dialog',{name:'Find file',exact:true}).getByRole('status')).toContainText('capped');
 await page.getByLabel('Exact file path').fill('wkb');
 await expect(page.getByRole('option',{name:'deep/workbench.ts',exact:true})).toHaveCount(1);
 await expect(page.getByRole('group',{name:'File results'}).getByRole('option')).toHaveText(['workbench.ts']);
 await page.getByLabel('Exact file path').fill('cap195');
 await expect(page.getByRole('dialog',{name:'Find file',exact:true}).getByRole('status')).toContainText('No eligible matches');
 await page.getByLabel('Exact file path').fill('cap194');
 await expect(page.getByRole('group',{name:'Recent files'}).getByRole('option')).toHaveText(['cap194.txt']);
 await page.getByLabel('Exact file path').fill('known');
 await expect(page.getByRole('option',{name:'node_modules/known.txt',exact:true})).toBeVisible();
 await page.keyboard.press('Enter');
 await expect(page.locator('.monaco-editor:visible')).toContainText('ignored familiar file');
 await page.getByRole('button',{name:'Find file',exact:true}).click();
 await page.getByLabel('Exact file path').fill('node_modules/missing.txt');
 await page.keyboard.press('Enter');
 await expect(page.getByRole('dialog',{name:'Find file',exact:true}).getByRole('status')).toContainText('retry');
 await expect(page.getByLabel('Exact file path')).toHaveValue('node_modules/missing.txt');
 await page.keyboard.press('Escape');
 await app.close();app=await launch();
 const restarted=await app.firstWindow();
 await restarted.getByRole('button',{name:'Find file',exact:true}).click();
 await expect(restarted.getByLabel('Exact file path')).toHaveValue('');
 await expect(restarted.getByRole('group',{name:'Recent files'}).getByRole('option').first()).toHaveText('node_modules/known.txt');
 await restarted.screenshot({path:'test-results/recent-lookup.png'});
 await restarted.getByLabel('Exact file path').press('Enter');
 await expect(restarted.locator('.monaco-editor:visible')).toContainText('ignored familiar file');
 const second=join(dir,'second');execFileSync('git',['init',second]);
 await mkdir(join(second,'node_modules'));await writeFile(join(second,'node_modules/known.txt'),'second checkout bytes');
 await app.evaluate(({dialog},root)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[root]});},second);
 await restarted.getByRole('button',{name:'Open project…',exact:true}).click();
 await expect(restarted.locator('header')).toContainText(second);
 await expect(restarted.locator('.view-nav:visible')).toContainText(second);
 await restarted.getByRole('button',{name:'Find file',exact:true}).click();
 await expect(restarted.getByRole('dialog',{name:'Find file',exact:true}).getByRole('status')).toContainText('No recent files');
 await restarted.getByLabel('Exact file path').fill('node_modules/known.txt');await restarted.getByLabel('Exact file path').press('Enter');
 await expect(restarted.locator('.monaco-editor:visible')).toContainText('second checkout bytes');
 await restarted.getByRole('button',{name:'Find file',exact:true}).click();
 await expect(restarted.getByRole('group',{name:'Recent files'}).getByRole('option')).toHaveText(['node_modules/known.txt']);
 await restarted.keyboard.press('Escape');
 await restarted.getByRole('navigation',{name:'Projects'}).locator('button[aria-pressed]').filter({hasText:'repo'}).click();
 await expect(restarted.locator('header')).toContainText(root);
 await restarted.getByRole('button',{name:'Find file',exact:true}).click();
 await restarted.getByLabel('Exact file path').fill('known');
 await expect(restarted.getByRole('option',{name:'node_modules/known.txt',exact:true})).toHaveCount(1);
 await restarted.getByLabel('Exact file path').press('Enter');
 await expect(restarted.locator('.monaco-editor:visible')).toContainText('ignored familiar file');
 page=restarted;
 // Multi-root ownership: linked worktrees remain distinct, closed tabs stay outside scope.
 execFileSync('git',['-C',root,'add','.']);
 execFileSync('git',['-C',root,'-c','user.name=Test','-c','user.email=test@example.com','commit','-m','fixture']);
 const linked=join(dir,'linked'), missing=join(dir,'missing');
 execFileSync('git',['-C',root,'worktree','add','-b','linked',linked]);
 await writeFile(join(linked,'deep/workbench.ts'),'linked editor target');
 execFileSync('git',['init',missing]);
 const open=async(root:string)=>{
   await app.evaluate(({dialog},root)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[root]});},root);
   await page.getByRole('button',{name:'Open project…',exact:true}).click();
   await expect(page.locator('header')).toContainText(root);
 };
 await open(linked); await open(missing);
 await rm(missing,{recursive:true});
 const agents=page.getByRole('button',{name:'Agents',exact:true});
 await agents.click(); await page.keyboard.press('Meta+p');
 await page.getByLabel('Exact file path').fill('wkb');
 await expect(page.getByRole('option')).toHaveCount(4);
 await expect(page.getByRole('dialog',{name:'Find file',exact:true}).getByRole('status')).toContainText('Unavailable');
 const linkedRow=page.getByRole('option').filter({hasText:linked}).filter({hasText:'deep/workbench.ts'});
 await expect(linkedRow).toContainText('repo');
 await page.screenshot({path:'test-results/agents-lookup.png'});
 await linkedRow.click();
 await expect(page.locator('header')).toContainText(linked);
 await expect(page.locator('.monaco-editor:visible')).toContainText('linked editor target');
 await page.locator('.project-tab[data-active="true"] .project-tab-close').click();
 await agents.click(); await page.getByRole('button',{name:'Find file',exact:true}).click();
 await page.getByLabel('Exact file path').fill(join(linked,'deep/workbench.ts'));
 await page.getByRole('button',{name:'Open file',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Find file',exact:true}).getByRole('status')).toContainText('could not');
 await expect(page.locator('header')).toContainText('agents');
 await page.keyboard.press('Escape');
 // Close the remaining tabs, then keep the command reachable with an explicit empty scope.
 for(let remaining=await page.locator('.project-tab-close').count();remaining>0;remaining--) {
   await page.locator('.project-tab-close').first().click();
   await expect(page.locator('.project-tab-close')).toHaveCount(remaining-1);
 }
 await page.getByRole('button',{name:'Find file',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Find file',exact:true})).toContainText('No open checkouts');
 await page.keyboard.press('Escape');
 // Aggregate limits differ from each root's own result budget.
 for(let index=0;index<9;index++) {
   const bounded=join(dir,`bounded-${index}`);
   execFileSync('git',['init',bounded]);
   for(let file=0;file<17;file++) await writeFile(join(bounded,`cap-${file}.txt`),'bounded');
   await open(bounded);
 }
 await agents.click(); await page.getByRole('button',{name:'Find file',exact:true}).click();
 await page.getByLabel('Exact file path').fill('cap');
 await expect(page.getByRole('option')).toHaveCount(100);
 await expect(page.getByRole('dialog',{name:'Find file',exact:true}).getByRole('status')).toContainText('Partial coverage');
 await expect(page.getByRole('option').filter({hasText:join(dir,'bounded-8')})).toHaveCount(0);
 await page.getByRole('button',{name:'Open file',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Find file',exact:true}).getByRole('status')).toContainText('capped at 8 checkouts');
 await page.keyboard.press('Escape');



 } finally {await app.close();await server?.close();await rm(dir,{recursive:true,force:true});}
});
