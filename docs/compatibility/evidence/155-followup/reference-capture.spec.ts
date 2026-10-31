import { test } from '@playwright/test';
import { launchDesktop } from './desktop';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('accepted reference capture', async () => {
 const user=await mkdtemp(join(tmpdir(),'escode-reference-')); const app=await launchDesktop(user);
 try {
  await app.evaluate(({BrowserWindow}) => { new BrowserWindow({webPreferences:{partition:'reference-only'}}).loadFile('/Users/elliotsharpe/Projects/escode/docs/prototypes/agents-ux/index.html'); });
 const page=(await app.waitForEvent('window')); 
  await page.goto('file:///Users/elliotsharpe/Projects/escode/docs/prototypes/agents-ux/index.html');
  for(const [width,height,zoom] of [[1000,700,1],[600,700,1],[1000,450,1],[1200,900,2]]){
   await page.setViewportSize({width,height});
   await app.evaluate(({BrowserWindow}, factor)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes("agents-ux"))!.webContents.setZoomFactor(factor),zoom);
   for(const scene of ['archived','error','editor']){
    await page.goto('file:///Users/elliotsharpe/Projects/escode/docs/prototypes/agents-ux/index.html?scene='+scene);
    await app.evaluate(({BrowserWindow}, factor)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes("agents-ux"))!.webContents.setZoomFactor(factor),zoom);
    
    
    if(scene==='editor') for(const mode of ['files','diff','chats']){
     await page.locator(`[data-mode="${mode}"]`).dispatchEvent('click');
     await page.screenshot({path:`test-results/reference-${mode}-${width}-${height}-${zoom}.png`});
    } else await page.screenshot({path:`test-results/reference-${scene}-${width}-${height}-${zoom}.png`});
   }
  }
 }finally{await app.process().kill();await rm(user,{recursive:true,force:true});}
});
