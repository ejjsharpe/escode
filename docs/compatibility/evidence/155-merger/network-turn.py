from pathlib import Path
src=Path('docs/compatibility/evidence/155/provider.py').read_text().split('p=Peer();p.init()')[0]
src=src.replace("v=self.q.get(timeout=max(.01,end-time.monotonic()));m=", "v=self.q.get(timeout=max(.01,end-time.monotonic()));print(json.dumps(v),flush=True);m=")
exec(src)
p=Peer();p.init()
try:
 with tempfile.TemporaryDirectory(prefix='escode-network-',dir=os.path.expanduser('~')) as work:
  r=p.call('thread/start',{'cwd':work,'ephemeral':True,'model':'gpt-6-luna','approvalPolicy':'never','sandbox':'workspace-write'})
  print('START',json.dumps(r),flush=True)
  print(p.turn(r['thread']['id'],'Execute exactly /usr/bin/curl --noproxy "*" -I --max-time 5 https://example.com using the shell command tool. Do not use JavaScript fetch, browser, MCP or other networking tools. Do not escalate or retry. Report exit code.',{'effort':'low','approvalPolicy':'never','sandboxPolicy':{'type':'workspaceWrite','writableRoots':[],'networkAccess':False,'excludeTmpdirEnvVar':True,'excludeSlashTmp':True}}))
finally:p.stop()
