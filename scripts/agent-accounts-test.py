import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import fcntl
import base64
import time

SOURCE=Path(__file__).with_name('agent-accounts.py')
spec=importlib.util.spec_from_file_location('accounts',SOURCE); mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

def auth(root,email):
    root.mkdir(parents=True,exist_ok=True)
    payload=base64.urlsafe_b64encode(json.dumps({'email':email}).encode()).decode().rstrip('=')
    (root/'auth.json').write_text(json.dumps({'tokens':{'id_token':'x.'+payload+'.x','access_token':'private-access','refresh_token':'private-refresh'}}))

class Accounts(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='axon-accounts-test-');self.home=Path(self.temp.name); self.store=mod.Store(self.home)
        auth(self.home/'.codex','original@example.test')
        (self.home/'.codex/config.toml').write_text('model = "fixture"\n')
        (self.home/'.codex/skills').mkdir();(self.home/'.codex/AGENTS.md').write_text('Keep instructions')
        (self.home/'.bashrc').write_text('# user shell\n')
        self.original={str(p):p.read_bytes() for p in (self.home/'.codex').iterdir() if p.is_file()}
    def tearDown(self):self.temp.cleanup()
    def create(self,agent='codex',name='Empresa'):
        r=self.store.change({'agent':agent,'action':'create','label':name,'source':SOURCE.read_text()});return r['createdId']
    def test_read_only_listing_and_no_secret_response(self):
        r=self.store.listing('codex');self.assertFalse(self.store.root.exists());self.assertTrue(r['profiles'][0]['connected']);self.assertEqual(r['profiles'][0]['email'],'original@example.test')
        self.assertNotIn('private-',json.dumps(r))
    def test_profiles_auth_configuration_history_and_shell_preservation(self):
        ident=self.create();root=self.store.profile_home('codex',ident)
        self.assertTrue((root/'config.toml').is_symlink());self.assertEqual((root/'AGENTS.md').read_text(),'Keep instructions')
        self.assertFalse((root/'auth.json').exists());self.assertFalse((root/'sessions').exists());self.assertEqual(self.store.load()['agents']['codex']['active'],'current')
        auth(root,'company@example.test');self.store.change({'agent':'codex','action':'activate','id':ident})
        self.assertEqual(self.store.listing('codex')['active'],ident)
        self.assertEqual({k:Path(k).read_bytes() for k in self.original},self.original)
        bash=(self.home/'.bashrc').read_text();self.assertTrue(bash.startswith('# user shell'));self.assertEqual(bash.count('# AXON: cuentas de agentes'),1)
        self.store.change({'agent':'codex','action':'install','source':SOURCE.read_text()});self.assertEqual((self.home/'.bashrc').read_text(),bash)
        self.assertEqual(self.store.registry.stat().st_mode & 0o777,0o600);self.assertEqual(root.stat().st_mode & 0o777,0o700)
        self.assertTrue(list(self.home.glob('.bashrc.axon-accounts-*.bak')))
    def test_reject_missing_login_duplicates_traversal_and_symlink(self):
        ident=self.create()
        for req in [{'action':'activate','id':ident},{'action':'rename','id':'../../outside','label':'No'},{'action':'create','label':'empresa','source':SOURCE.read_text()}]:
            with self.assertRaises(mod.Failure):self.store.change({'agent':'codex',**req})
        outside=self.home/'outside';outside.write_text('Keep')
        self.store.registry.unlink();self.store.registry.symlink_to(outside)
        with self.assertRaises(mod.Failure):self.store.listing('codex')
        self.assertEqual(outside.read_text(),'Keep')
    def test_login_lock_prevents_activation(self):
        ident=self.create();auth(self.store.profile_home('codex',ident),'company@example.test')
        fd=os.open(self.store.root/'codex'/(ident+'.login-lock'),os.O_CREAT|os.O_RDWR,0o600)
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);self.assertTrue(self.store.login_busy('codex',ident))
            with self.assertRaises(mod.Failure):self.store.change({'agent':'codex','action':'activate','id':ident})
        finally:os.close(fd)
    def test_cli_launch_reads_latest_default_and_explicit_profile(self):
        ident=self.create();root=self.store.profile_home('codex',ident);auth(root,'company@example.test')
        fake=self.home/'bin';fake.mkdir();exe=fake/'codex'
        exe.write_text('#!/usr/bin/env python3\nimport os,sys,json\nprint(json.dumps({"home":os.environ.get("CODEX_HOME"),"key":os.environ.get("OPENAI_API_KEY"),"args":sys.argv[1:]}))\n');exe.chmod(0o700)
        env={**os.environ,'HOME':str(self.home),'PATH':str(fake)+':'+os.environ['PATH'],'OPENAI_API_KEY':'should-be-removed'}
        self.store.change({'agent':'codex','action':'activate','id':ident})
        result=subprocess.run([str(self.home/'.local/bin/axon-agent'),'run','codex','exec','fixture'],env=env,capture_output=True,text=True,check=True)
        launched=json.loads(result.stdout);self.assertEqual(launched['home'],str(root));self.assertIsNone(launched['key']);self.assertIn('--no-daemon',launched['args']);self.assertIn('cli_auth_credentials_store="file"',launched['args'])
        self.store.change({'agent':'codex','action':'activate','id':'current'})
        result=subprocess.run([str(self.home/'.local/bin/axon-agent'),'run','codex','--version'],env=env,capture_output=True,text=True,check=True)
        self.assertEqual(json.loads(result.stdout)['home'],str(self.home/'.codex'))
        result=subprocess.run([str(self.home/'.local/bin/axon-agent'),'run-profile','codex',ident,'exec','fixture'],env=env,capture_output=True,text=True,check=True)
        self.assertEqual(json.loads(result.stdout)['home'],str(root))
    def test_claude_uses_independent_metadata_and_credentials(self):
        (self.home/'.claude').mkdir();(self.home/'.claude/settings.json').write_text('{}')
        ident=self.create('claude');root=self.store.profile_home('claude',ident)
        (root/'.credentials.json').write_text(json.dumps({'claudeAiOauth':{'accessToken':'secret'}}));(root/'.claude.json').write_text(json.dumps({'oauthAccount':{'emailAddress':'work@example.test'}}))
        listing=self.store.listing('claude');self.assertEqual(listing['profiles'][1]['email'],'work@example.test');self.assertNotIn('secret',json.dumps(listing))
        self.assertFalse((root/'.claude.json').is_symlink());self.assertTrue((root/'settings.json').is_symlink())
    def test_refresh_write_is_owned_by_profile(self):
        ident=self.create();root=self.store.profile_home('codex',ident);auth(root,'work@example.test')
        fake=self.home/'bin';fake.mkdir();exe=fake/'codex'
        exe.write_text('#!/usr/bin/env python3\nimport os,json,pathlib\np=pathlib.Path(os.environ["CODEX_HOME"])/"auth.json"\nd=json.loads(p.read_text());d["tokens"]["refresh_token"]="renewed";p.write_text(json.dumps(d))\n');exe.chmod(0o700)
        env={**os.environ,'HOME':str(self.home),'PATH':str(fake)+':'+os.environ['PATH']}
        subprocess.run([str(self.home/'.local/bin/axon-agent'),'run-profile','codex',ident,'exec','fixture'],env=env,check=True)
        self.assertEqual(json.loads((root/'auth.json').read_text())['tokens']['refresh_token'],'renewed')
        self.assertEqual((self.home/'.codex/auth.json').read_bytes(),self.original[str(self.home/'.codex/auth.json')])
    def test_running_session_keeps_its_account_when_default_changes(self):
        ident=self.create();root=self.store.profile_home('codex',ident);auth(root,'work@example.test')
        fake=self.home/'bin';fake.mkdir();exe=fake/'codex'
        exe.write_text('#!/usr/bin/env python3\nimport os,time,pathlib,json\nr=pathlib.Path(os.environ["CODEX_HOME"]);(r/".run-ready").write_text("ready");time.sleep(.4);print(json.dumps({"home":str(r),"email":json.loads((r/"auth.json").read_text())["tokens"]["id_token"]}))\n');exe.chmod(0o700)
        env={**os.environ,'HOME':str(self.home),'PATH':str(fake)+':'+os.environ['PATH']}
        self.store.change({'agent':'codex','action':'activate','id':ident})
        child=subprocess.Popen([str(self.home/'.local/bin/axon-agent'),'run','codex','exec','fixture'],env=env,stdout=subprocess.PIPE,text=True)
        deadline=time.monotonic()+3
        while not (root/'.run-ready').exists() and time.monotonic()<deadline:time.sleep(.01)
        self.assertTrue((root/'.run-ready').exists())
        self.store.change({'agent':'codex','action':'activate','id':'current'})
        output,_=child.communicate(timeout=3);self.assertEqual(child.returncode,0);self.assertEqual(json.loads(output)['home'],str(root))
    def test_native_claude_layout_and_pnpm_update_routing(self):
        (self.home/'.claude').mkdir();ident=self.create('claude')
        fake=self.home/'bin';fake.mkdir()
        for name in ['claude','sync-tool']:
            exe=fake/name;exe.write_text('#!/usr/bin/env python3\nimport os,sys,json\nprint(json.dumps({"config":os.environ.get("CLAUDE_CONFIG_DIR"),"args":sys.argv[1:]}))\n');exe.chmod(0o700)
        env={**os.environ,'HOME':str(self.home),'PATH':str(fake)+':'+os.environ['PATH'],'CLAUDE_CONFIG_DIR':'/unrelated'}
        native=subprocess.run([str(self.home/'.local/bin/axon-agent'),'run','claude','--version'],env=env,capture_output=True,text=True,check=True)
        self.assertIsNone(json.loads(native.stdout)['config'])
        update=subprocess.run([str(self.home/'.local/bin/axon-agent'),'run','claude','update','--check'],env=env,capture_output=True,text=True,check=True)
        self.assertEqual(json.loads(update.stdout)['args'],['--only','claude','--check'])

if __name__=='__main__':unittest.main()
