"""Real daemon proof in a private disposable home. No inference or login.

Reads existing credentials into private fixture files to verify native
account/read before/after daemon renewal. Never changes the real daemon.
"""
import asyncio
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def module(name, filename):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(filename))
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod


accounts=module('accounts','agent-accounts.py');desktop=module('desktop','codex-server-account.py')
actual=accounts.Store(Path.home());state=actual.load()['agents']['codex']
company=next(p['id'] for p in state['profiles'] if p['id']!='current')
paths=[actual.profile_home('codex',p)/'auth.json' for p in ['current',company]]
before=[hashlib.sha256(p.read_bytes()).digest() for p in paths]
personal_data=paths[0].read_bytes();company_data=paths[1].read_bytes()
personal_id=json.loads(personal_data)['tokens']['account_id'];company_id=json.loads(company_data)['tokens']['account_id']
assert personal_id!=company_id
cli=shutil.which('codex')
ssh_mode=os.environ.get('AXON_PROOF_SSH')=='1'
direct=None
with tempfile.TemporaryDirectory(prefix='axon-daemon-proof-') as tmp:
    home=Path(tmp);home.chmod(0o700);native=home/'.codex';native.mkdir(mode=0o700)
    accounts.atomic(native/'auth.json',personal_data.decode())
    accounts.atomic(native/'config.toml','cli_auth_credentials_store = "file"\n')
    env={**os.environ,'HOME':str(home),'CODEX_HOME':str(native)}
    for key in ['OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN']:env.pop(key,None)
    def daemon(action):
        result=subprocess.run([cli,'app-server','daemon',action],env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=25)
        if result.returncode:raise RuntimeError('Fixture daemon operation failed')
    try:
        store=accounts.Store(home)
        ident=store.change({'agent':'codex','action':'create','label':'Empresa QA','source':Path(__file__).with_name('agent-accounts.py').read_text(),'serverSource':Path(__file__).with_name('codex-server-account.py').read_text()})['createdId']
        accounts.atomic(store.profile_home('codex',ident)/'auth.json',company_data.decode())
        store.change({'agent':'codex','action':'activate','id':ident})
        store.schedule_desktop=lambda:None
        settings=native/'app-server-daemon';settings.mkdir(exist_ok=True,mode=0o700)
        accounts.atomic(settings/'settings.json',json.dumps({'featureOverrides':{'code_mode_host':True},'updater':{'autoUpdateEnabled':False}}))
        if ssh_mode:
            direct=subprocess.Popen([cli,'-c','features.code_mode_host=true','app-server','--listen','unix://'],env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
        else: daemon('restart')
        async def prove():
            for _ in range(50):
                if (native/'app-server-control/app-server-control.sock').exists():break
                await asyncio.sleep(.1)
            async with desktop.Desktop(home) as d:
                first=await d.account();assert first['accountId']==personal_id
                assert not await d.busy()
            store.change({'agent':'codex','action':'enable-server'})
            await desktop.reconcile(store,accounts.atomic,once=True)
            status=json.loads((store.root/'desktop-status.json').read_text())
            assert status['state']=='ready' and status['verified'],status
            async with desktop.Desktop(home) as d:
                second=await d.account();assert second['accountId']==company_id
            assert 'features.code_mode_host=true' in desktop.daemon_features(home)
            argv,environ,_=store.invocation('codex',None,[],server_default=True)
            assert environ['CODEX_HOME']==str(native) and '--no-daemon' not in argv
            assert (store.profile_home('codex','current')/'auth.json').read_bytes()==personal_data
        asyncio.run(prove())
        print(json.dumps({'isolatedRealDaemon':True,'sshCreatedServer':ssh_mode,'personalBefore':True,'companyAfter':True,'identityReadback':True,'defaultCLIUsesSameDaemon':True,'personalCredentialPreserved':True,'realInference':False,'realLogin':False}))
    finally:
        if direct and direct.poll() is None:
            direct.terminate();direct.wait(timeout=5)
        daemon('stop')
assert before==[hashlib.sha256(p.read_bytes()).digest() for p in paths]
