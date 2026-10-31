from pathlib import Path
exec(Path(__file__).parent.joinpath('../155/provider.py').read_text().split('p=Peer();p.init()')[0])
p=Peer();p.init()
try:
 with tempfile.TemporaryDirectory(prefix='escode-155-approval-',dir=os.path.expanduser('~')) as work:
  r=p.call('thread/start',{'cwd':work,'ephemeral':True,'model':'gpt-6-luna','sandbox':'read-only','approvalPolicy':'on-request','approvalsReviewer':'user'})
  tid=r['thread']['id']
  p.call('turn/start',{'threadId':tid,'model':'gpt-6-luna','effort':'low','approvalPolicy':'on-request','approvalsReviewer':'user','sandboxPolicy':{'type':'readOnly','networkAccess':False},'input':[{'type':'text','text':'Use the shell to create approval-probe.txt here. If denied, request escalation once through the shell tool, then stop if declined.','text_elements':[]}]})
  end=time.monotonic()+50;seen=False
  while time.monotonic()<end:
   v=p.q.get(timeout=max(.01,end-time.monotonic()))
   if 'requestApproval' in v.get('method',''):
    print('approval',json.dumps(v),flush=True);seen=True
    p.p.stdin.write(json.dumps({'id':v['id'],'result':{'decision':'decline'}})+'\n');p.p.stdin.flush()
   if v.get('method')=='turn/completed':break
  print('approval_seen',seen,'file_exists',os.path.exists(work+'/approval-probe.txt'),flush=True)
  assert seen and not os.path.exists(work+'/approval-probe.txt')
finally:p.stop()
