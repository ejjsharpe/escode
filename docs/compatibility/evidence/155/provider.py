import subprocess,json,tempfile,queue,threading,time,os,sys
class Peer:
 def __init__(self):
  self.p=subprocess.Popen(['codex','app-server'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=open('/tmp/escode-155-provider.stderr','a'),text=True);self.q=queue.Queue();self.i=0
  threading.Thread(target=lambda:[self.q.put(json.loads(l)) for l in self.p.stdout],daemon=True).start()
 def call(self,m,a):
  self.i+=1;i=self.i;self.p.stdin.write(json.dumps(dict(id=i,method=m,params=a))+'\n');self.p.stdin.flush();end=time.monotonic()+20
  while time.monotonic()<end:
   v=self.q.get(timeout=max(.01,end-time.monotonic()))
   if v.get('id')==i:
    if 'error' in v:raise Exception(v['error'])
    return v['result']
  raise Exception('timeout '+m)
 def init(self):self.call('initialize',{'clientInfo':{'name':'escode-155','version':'1'}})
 def stop(self):self.p.terminate();self.p.wait(timeout=5)
 def turn(self,tid,text,extra={}):
  self.call('turn/start',dict(threadId=tid,input=[{'type':'text','text':text,'text_elements':[]}],**extra));end=time.monotonic()+50;out=''
  while time.monotonic()<end:
   v=self.q.get(timeout=max(.01,end-time.monotonic()));m=v.get('method','');p=v.get('params',{})
   if m=='item/agentMessage/delta':out+=p.get('delta','')
   if 'requestApproval' in m:raise Exception('approval requested; closing bounded probe')
   if m=='turn/completed':return {'status':p['turn'].get('status'),'text':out}
  raise Exception('turn timeout')
p=Peer();p.init()
try:
 catalog=p.call('model/list',{});print('catalog',json.dumps(catalog),flush=True)
 with tempfile.TemporaryDirectory(prefix='escode-155-',dir=os.path.expanduser('~')) as base:
  work=base+'/workspace';outside=base+'/outside';os.mkdir(work);os.mkdir(outside)
  code="import os,json; r={};\nfor n,p in [('workspace','probe'),('outside',"+repr(outside+'/probe')+")]:\n try:\n  open(p,'w').write('probe');r[n]='allowed'\n except OSError as e:r[n]=str(e)\nprint(json.dumps(r))"
  for policy in [{'type':'readOnly','networkAccess':False},{'type':'workspaceWrite','writableRoots':[],'networkAccess':False,'excludeTmpdirEnvVar':False,'excludeSlashTmp':False},{'type':'workspaceWrite','writableRoots':[work],'networkAccess':False,'excludeTmpdirEnvVar':False,'excludeSlashTmp':False},{'type':'dangerFullAccess'}]:
   print('enforcement',json.dumps({'policy':policy,'result':p.call('command/exec',{'cwd':work,'command':[sys.executable,'-c',code],'sandboxPolicy':policy,'timeoutMs':10000})}),flush=True)
  r=p.call('thread/start',{'cwd':work,'ephemeral':False,'approvalPolicy':'on-request','approvalsReviewer':'user','sandbox':'read-only'});tid=r['thread']['id']
  print('original',json.dumps({k:r.get(k) for k in ['model','reasoningEffort','sandbox','approvalPolicy']}),flush=True)
  print('turn',json.dumps(p.turn(tid,'Reply OK. Do not use tools.')),flush=True)
  p.stop();p=Peer();p.init()
  for mode in ['read-only','workspace-write','danger-full-access']:
   r=p.call('thread/resume',{'threadId':tid,'cwd':work,'excludeTurns':True,'approvalPolicy':'never' if mode=='danger-full-access' else 'on-request','approvalsReviewer':'user','sandbox':mode})
   print('resume',mode,json.dumps({k:r.get(k) for k in ['sandbox','approvalPolicy','reasoningEffort']}),flush=True)
  print('history_count',len(p.call('thread/turns/list',{'threadId':tid,'limit':10})['data']),flush=True)
  r=p.call('thread/start',{'cwd':work,'ephemeral':True,'model':'gpt-6-luna','approvalPolicy':'never','sandbox':'read-only'})
  print('title',json.dumps(p.turn(r['thread']['id'],'Generate only a 3–8 word chat title under 40 characters for this request: Fix sidebar keyboard resizing and preserve focus. Do not use tools.')),flush=True)
finally:p.stop()
