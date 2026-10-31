from pathlib import Path
exec(Path('docs/compatibility/evidence/155/provider.py').read_text().split('p=Peer();p.init()')[0])
p=Peer();p.init()
try:
 for policy in [{'type':'readOnly','networkAccess':False},{'type':'workspaceWrite','writableRoots':[os.getcwd()],'networkAccess':False,'excludeTmpdirEnvVar':True,'excludeSlashTmp':True}]:
  print(json.dumps({'policy':policy,'result':p.call('command/exec',{'cwd':os.getcwd(),'command':['/usr/bin/curl','--noproxy','*','-I','--max-time','5','https://example.com'],'sandboxPolicy':policy,'timeoutMs':7000})}),flush=True)
finally:p.stop()
