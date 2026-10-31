import { test, expect, _electron } from '@playwright/test';
import { mkdtemp, realpath, mkdir, writeFile, rm, rename, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { launchDesktop } from './desktop';
import { createServer } from 'vite-plus';
import electron from 'electron';

test('lookup ranks and highlights unloaded files, file and policy changes converge and activation keeps the file', async () => {
 test.setTimeout(90000);
 const dir=await realpath(await mkdtemp(join(tmpdir(),'escode-lookup-'))), root=join(dir,'repo'), repository=join(dir,'repository');
 execFileSync('git',['init',repository]);
 execFileSync('git',['-C',repository,'-c','user.name=Test','-c','user.email=test@example.com','commit','--allow-empty','-m','fixture']);
 execFileSync('git',['-C',repository,'worktree','add',root]); await mkdir(join(root,'deep')); await writeFile(join(root,'deep/workbench.ts'),'unloaded editor target');
 const server=process.env.ESCODE_LOOKUP_DEV ? await createServer({server:{host:'127.0.0.1',port:0,strictPort:true}}) : undefined;
 await server?.listen();
 const env: Record<string,string>={...process.env,ESCODE_DEV_URL:server?.resolvedUrls!.local[0] ?? ''};delete env.ELECTRON_RUN_AS_NODE;
 const app=server ? await _electron.launch({executablePath:electron as unknown as string,args:['.',`--user-data-dir=${join(dir,'user')}`],env}) : await launchDesktop(join(dir,'user'));
 try { const page=await app.firstWindow();
 await app.evaluate(({dialog},root)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[root]});},root);
 await page.getByRole('button',{name:'Open project…',exact:true}).click();
 await page.getByRole('button',{name:'Hide Git-ignored files',exact:true}).click();
 await page.getByRole('button',{name:'Find file',exact:true}).click();
 await page.getByLabel('Exact file path').fill('wkb');
 const result=page.getByRole('option',{name:'deep/workbench.ts',exact:true}); await expect(result).toBeVisible();
 await expect(result.locator('mark')).toHaveText(['w','k','b']);
 // Policy freshness belongs here alongside the ordinary file-change journey.
 for (const folder of ['', 'deep']) for (const name of ['.gitignore','.ignore','.rgignore']) {
   const policy=join(root,folder,name);
   await writeFile(policy,'workbench.ts\n');
   await expect(result).toHaveCount(0);
   await writeFile(policy+'.replacement','other.ts\n'); await rename(policy+'.replacement',policy);
   await expect(result).toBeVisible();
   await writeFile(policy,'workbench.ts\n'); await expect(result).toHaveCount(0);
   await rm(policy); await expect(result).toBeVisible();
 }
 const exclude=join(repository,'.git/info/exclude');
 await rm(exclude);
 await writeFile(exclude,'deep/workbench.ts\n'); await expect(result).toHaveCount(0);
 await writeFile(exclude+'.replacement','other.ts\n'); await rename(exclude+'.replacement',exclude);
 await expect(result).toBeVisible();
 await writeFile(exclude,'deep/workbench.ts\n'); await expect(result).toHaveCount(0);
 await rm(exclude); await expect(result).toBeVisible();
 // Unsafe policy coverage is disclosed, then Refresh and reopen both recover.
 await writeFile(join(dir,'outside-policy'),'workbench.ts\n');
 await symlink(join(dir,'outside-policy'),join(root,'deep/.ignore'));
 await expect(page.getByRole('status').filter({hasText:'ignore rules unavailable'})).toBeVisible();
 await rm(join(root,'deep/.ignore'));
 await page.getByRole('dialog',{name:'Find file',exact:true}).getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(result).toBeVisible();
 await symlink(join(dir,'outside-policy'),join(root,'deep/.ignore'));
 await expect(page.getByRole('status').filter({hasText:'ignore rules unavailable'})).toBeVisible();
 await page.keyboard.press('Escape'); await rm(join(root,'deep/.ignore'));
 await page.getByRole('button',{name:'Find file',exact:true}).click();
 await page.getByLabel('Exact file path').fill('wkb'); await expect(result).toBeVisible();
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
 } finally {await app.close();await server?.close();await rm(dir,{recursive:true,force:true});}
});
