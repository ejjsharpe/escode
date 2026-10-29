import { test, expect } from "vite-plus/test";
import { mkdtemp, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectCodex } from "./tools";
import { Chats } from "./chat";
import { ChatService } from "./chat-service";
test("project shutdown interrupts its turn and kills a resistant descendant, preserving other chats", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-shutdown-")));
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  let service: ChatService | undefined;
  try {
    const executable = join(dir, "codex");
    await writeFile(
      executable,
      `#!/usr/bin/env node
const {createInterface}=require('node:readline');
const {spawn}=require('node:child_process');
const {writeFileSync,appendFileSync}=require('node:fs');
if(process.argv.includes('--version')) { console.log('codex-cli 0.165.0'); process.exit(); }
const child=spawn(process.execPath,['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});
writeFileSync('pids-'+process.pid,JSON.stringify([process.pid,child.pid]));
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line); if(!m.id || !m.method)return;
 let result={};
 if(m.method==='initialize')result={userAgent:'codex/0.165.0'};
 if(m.method==='account/read')result={account:{}};
 if(m.method==='thread/start')result={thread:{id:'thread'},cwd:process.cwd(),model:'fixture',sandbox:{type:'readOnly'},approvalPolicy:'on-request'};
 if(m.method==='turn/start')result={turn:{id:'turn'}};
 if(m.method==='turn/interrupt')appendFileSync('interrupts','stopped\\n');
 send({id:m.id,result});
});
`,
      { mode: 0o700 },
    );
    const store = new Chats(join(dir, "chats.json"));
    service = new ChatService(store, (cwd, receive, disconnected) =>
      connectCodex(cwd, receive, disconnected, executable),
    );
    const first = await service.create("first", dir),
      second = await service.create("second", dir);
    await service.open("first", first.id);
    await service.open("second", second.id);
    await service.send("first", first.id, "run");
    await service.send("second", second.id, "run");
    const { readdir } = await import("node:fs/promises");
    const pids = (await readdir(dir)).filter((x) => x.startsWith("pids-"));
    const firstGroup: number[] = JSON.parse(await readFile(join(dir, pids[0]), "utf8"));
    const secondGroup: number[] = JSON.parse(await readFile(join(dir, pids[1]), "utf8"));
    await service.shutdown("first");
    expect(service.snapshot("second", second.id).busy).toBe(true);
    expect(await readFile(join(dir, "interrupts"), "utf8")).toBe("stopped\n");
    // One entire group is gone; the other remains alive until app shutdown.
    await expect.poll(() => [...firstGroup, ...secondGroup].filter(alive).length).toBe(2);
    await service.shutdown();
    await expect.poll(() => [...firstGroup, ...secondGroup].some(alive)).toBe(false);
    expect((await store.list("first"))[0].threadId).toBe("thread");
  } finally {
    await service?.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});

test("shutdown waits for an opening connection's resistant descendants before returning", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-opening-")));
  const executable = join(dir, "codex");
  let service: ChatService | undefined;
  try {
    await writeFile(
      executable,
      `#!/usr/bin/env node
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {writeFileSync}=require('node:fs');
if(process.argv.includes('--version')) { console.log('codex-cli 0.165.0'); process.exit(); }
const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});
writeFileSync('pids',JSON.stringify([process.pid,child.pid]));
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(m.id)process.stdout.write(JSON.stringify({id:m.id,result:{userAgent:'codex/0.165.0'}})+'\\n');
});
`,
      { mode: 0o700 },
    );
    let ready!: () => void, release!: () => void;
    const connected = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    service = new ChatService(
      new Chats(join(dir, "chats.json")),
      async (cwd, receive, disconnected) => {
        const rpc = await connectCodex(cwd, receive, disconnected, executable);
        ready();
        await gate;
        return rpc;
      },
    );
    const chat = await service.create(dir);
    const opening = service.open(dir, chat.id).catch(() => {});
    await connected;
    const stopping = service.shutdown();
    release();
    await stopping;
    await opening;
    const pids: number[] = JSON.parse(await readFile(join(dir, "pids"), "utf8"));
    await expect
      .poll(() =>
        pids.some((pid) => {
          try {
            process.kill(pid, 0);
            return true;
          } catch {
            return false;
          }
        }),
      )
      .toBe(false);
  } finally {
    await service?.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});

test("failed initialization finishes descendant cleanup before shutdown returns", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-init-failure-")));
  let service: ChatService | undefined;
  try {
    const executable = join(dir, "codex");
    await writeFile(
      executable,
      `#!/usr/bin/env node
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {writeFileSync}=require('node:fs');
if(process.argv.includes('--version')) { console.log('codex-cli 0.165.0'); process.exit(); }
const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});
writeFileSync('pids',JSON.stringify([process.pid,child.pid]));
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(m.id)setTimeout(()=>process.stdout.write(JSON.stringify({id:m.id,result:{}})+'\\n'),100);
});
`,
      { mode: 0o700 },
    );
    service = new ChatService(new Chats(join(dir, "chats.json")), (cwd, receive, disconnected) =>
      connectCodex(cwd, receive, disconnected, executable),
    );
    const chat = await service.create(dir);
    const opening = service.open(dir, chat.id).catch(() => {});
    await expect
      .poll(async () => {
        try {
          return JSON.parse(await readFile(join(dir, "pids"), "utf8")).length;
        } catch {
          return 0;
        }
      })
      .toBe(2);
    await service.shutdown();
    await opening;
    const pids: number[] = JSON.parse(await readFile(join(dir, "pids"), "utf8"));
    await expect
      .poll(() =>
        pids.some((pid) => {
          try {
            process.kill(pid, 0);
            return true;
          } catch {
            return false;
          }
        }),
      )
      .toBe(false);
  } finally {
    await service?.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});

test("shutdown cancels an open still reading saved-chat metadata before any process starts", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-metadata-close-")));
  let service: ChatService | undefined;
  let release!: () => void;
  try {
    const executable = join(dir, "codex");
    await writeFile(
      executable,
      `#!/usr/bin/env node
const {createInterface}=require('node:readline');
const {writeFileSync}=require('node:fs');
if(process.argv.includes('--version')) { console.log('codex-cli 0.165.0'); process.exit(); }
writeFileSync('server-pid',String(process.pid));
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line); if(!m.id || !m.method)return;
 let result={};
 if(m.method==='initialize')result={userAgent:'codex/0.165.0'};
 if(m.method==='account/read')result={account:{}};
 if(m.method==='thread/start')result={thread:{id:'thread'},cwd:process.cwd(),model:'fixture',sandbox:{type:'readOnly'},approvalPolicy:'on-request'};
 process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');
});
`,
      { mode: 0o700 },
    );
    const store = new Chats(join(dir, "chats.json"));
    const chat = await store.create(dir);
    let reading!: () => void;
    const started = new Promise<void>((resolve) => {
      reading = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const get = store.get.bind(store);
    store.get = async (project, id) => {
      reading();
      await gate;
      return get(project, id);
    };
    service = new ChatService(store, (cwd, receive, disconnected) =>
      connectCodex(cwd, receive, disconnected, executable),
    );
    const opening = service.open(dir, chat.id).then(
      () => "connected",
      () => "cancelled",
    );
    await started;
    const activeBeforeShutdown = service.active(dir);
    const shutdown = service.shutdown(dir);
    release();
    await shutdown;
    expect(await opening).toBe("cancelled");
    expect(activeBeforeShutdown).toBe(true);
    const { readdir } = await import("node:fs/promises");
    expect(await readdir(dir)).not.toContain("server-pid");
  } finally {
    release?.();
    await service?.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});
