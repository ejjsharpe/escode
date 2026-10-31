import type { ElectronApplication, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

// Opt-in instrumentation of the owning journey, never a separate acceptance suite.
export async function lookupMeasurement(app: ElectronApplication, page: Page, dataset: {dataset: number}) {
 const enabled=!!process.env.ESCODE_LOOKUP_MEASURE;
 const rows: {name:string;ms:number}[]=[];
 const resources=()=> {
   const pid=app.process().pid!;
   const files=execFileSync('/usr/sbin/lsof',['-p',String(pid),'-F','f'],{encoding:'utf8'}).split('\n').filter(line=>/^f\d/.test(line)).length;
   const children=execFileSync('/bin/ps',['-axo','ppid=,rss=,command='],{encoding:'utf8'}).split('\n').filter(line=>Number(line.trim().split(/\s+/)[0])===pid && /filesystem|ripgrep/.test(line));
   return {files,nativeChildren:children};
 };
 const before=enabled ? resources() : undefined;
 const checkpoints: unknown[]=[];
 if(enabled) {
   await app.evaluate(({app})=>{
     const state=globalThis as any;
     const histogram=process.getBuiltinModule('perf_hooks').monitorEventLoopDelay({resolution:10});histogram.enable();
     const samples: unknown[]=[];
     const sample=()=>samples.push(app.getAppMetrics().map(p=>({type:p.type,workingSetKiB:p.memory.workingSetSize})));
     sample();const timer=setInterval(sample,250);
     state.lookupMeasurement={histogram,samples,timer,versions:process.versions};
   });
   await page.evaluate(()=>{
     const gaps:number[]=[];let last=performance.now();
     const timer=setInterval(()=>{const now=performance.now();gaps.push(now-last);last=now;},20);
     (window as any).lookupMeasurement={gaps,timer};
   });
 }
 return {
   resources(label:string){if(enabled) checkpoints.push({label,...resources()});},
   record(name:string,ms:number){if(enabled) rows.push({name,ms});},
   async time(name:string,action:()=>Promise<void>){const start=performance.now();await action();if(enabled) rows.push({name,ms:performance.now()-start});},
   async finish(label:string){
     if(!enabled) return;
     // Let interrupted native work and popup disposers settle before the OS snapshot.
     await page.waitForTimeout(750);
     const renderer=await page.evaluate(()=>{const {gaps,timer}=(window as any).lookupMeasurement;clearInterval(timer);gaps.sort((a:number,b:number)=>a-b);return {maxGapMs:gaps.at(-1),p99GapMs:gaps[Math.floor(gaps.length*.99)],samples:gaps.length};});
     const main=await app.evaluate(()=>{const {histogram,samples,timer,versions}=(globalThis as any).lookupMeasurement;clearInterval(timer);histogram.disable();return {versions,maxDelayMs:histogram.max/1e6,p99DelayMs:histogram.percentile(99)/1e6,first:samples[0],last:samples.at(-1),peakWorkingSetKiB:Math.max(...samples.map((s:any[])=>s.reduce((n,p)=>n+p.workingSetKiB,0)))};});
     console.log('LOOKUP_MEASUREMENT '+JSON.stringify({label,mode:process.env.ESCODE_PACKAGED?'packaged':process.env.ESCODE_LOOKUP_DEV?'vite':'built',...dataset,rows,checkpoints,main,renderer,before,after:resources()}));
   },
 };
}
