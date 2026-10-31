from pathlib import Path
exec(Path(__file__).with_name('provider.py').read_text().split('p=Peer();p.init()')[0])
p=Peer();p.init()
try:
 with tempfile.TemporaryDirectory(prefix='escode-155-turn-',dir=os.path.expanduser('~')) as work:
  r=p.call('thread/start',{'cwd':work,'ephemeral':True,'model':'gpt-6-luna','approvalPolicy':'on-request','sandbox':'workspace-write'})
  print('settings',json.dumps({k:r.get(k) for k in ['model','sandbox','approvalPolicy']}),flush=True)
  result=p.turn(r['thread']['id'],'Use a shell command to write exactly probe to probe.txt in the current directory. Do not request escalation. Report success or failure.',{'model':'gpt-6-luna','effort':'low','approvalPolicy':'on-request','sandboxPolicy':{'type':'workspaceWrite','writableRoots':[],'networkAccess':False,'excludeTmpdirEnvVar':False,'excludeSlashTmp':False}})
  print('turn',json.dumps(result),'file_exists',os.path.exists(work+'/probe.txt'),flush=True)
finally:p.stop()
