import unittest,tempfile,sqlite3,json,sys,os,subprocess,threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler,HTTPServer
WORKER=Path(__file__).with_name('agent-context-store.py')
class ContextTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.home=Path(self.tmp.name);self.env=dict(os.environ)
 def tearDown(self):self.tmp.cleanup()
 def call(self,kind='chats',action='list',**kw):
  p=subprocess.run(['python3',str(WORKER)],input=json.dumps(dict(home=str(self.home),kind=kind,action=action,projects=[],**kw)),text=True,capture_output=True,env=self.env,timeout=30)
  self.assertEqual(p.returncode,0,p.stderr);return json.loads(p.stdout)
 def write(self,p,events):
  p=self.home/p;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('\n'.join(json.dumps(e) for e in events)+'\n');return p
 def codex(self,n=1):
  events=[dict(type='session_meta',payload=dict(id='native-id',cwd=str(self.home/'project'))),dict(type='response_item',payload=dict(type='message',role='system',content=[dict(type='input_text',text='HIDDEN_SYSTEM')])),dict(type='response_item',payload=dict(type='reasoning',summary=[dict(text='HIDDEN_REASONING')]))]
  for i in range(n):events.append(dict(type='response_item',payload=dict(type='message',role='user',content=[dict(type='input_text',text='Test message '+str(i)+' src/app.ts')])))
  return self.write(Path('.codex/sessions/2026/10/chat.jsonl'),events)
 def test_chat_search_pages_export_and_live_updates(self):
  p=self.codex(85);data=self.call();self.assertTrue(data['ok']);self.assertEqual(data['total'],1);sid=data['items'][0]['id']
  detail=self.call(action='detail',id=sid);self.assertEqual(len(detail['messages']),80);self.assertEqual(detail['next'],80)
  rest=self.call(action='detail',id=sid,offset=80);self.assertEqual(len(rest['messages']),5);self.assertIsNone(rest['next'])
  md=self.call(action='export',id=sid)['markdown'];self.assertIn('Test message 84',md);self.assertNotIn('HIDDEN_SYSTEM',md);self.assertNotIn('HIDDEN_REASONING',md);self.assertIn('src/app.ts',md)
  self.assertEqual(self.call(q='message')['total'],1);self.assertEqual(self.call(q='HIDDEN_SYSTEM')['total'],0)
  with p.open('a') as f:f.write(json.dumps(dict(type='response_item',payload=dict(type='message',role='assistant',content=[dict(type='output_text',text='newunique')])))+'\n')
  self.assertEqual(self.call(q='newunique')['total'],1)
 def test_claude_tools_gemini_and_incomplete_records(self):
  self.write(Path('.claude/projects/project/a.jsonl'),[dict(type='user',cwd='/work/app',message=dict(content='Hello Claude')),dict(type='assistant',message=dict(content=[dict(type='tool_use',name='Edit',input=dict(file_path='/work/app/main.ts'))]))])
  self.write(Path('.gemini/tmp/project/chats/session-test.jsonl'),[dict(sessionId='gemini',projectPath='/work/app'),{'$set':{'messages':[dict(type='user',content='Hello Gemini')]}},{'$set':{'messages':[dict(type='user',content='Hello Gemini'),dict(type='gemini',content='Reply')]}}])
  rows=self.call()['items'];self.assertEqual({r['agent'] for r in rows},{'claude','gemini'})
  for row in rows:
   d=self.call(action='detail',id=row['id']);self.assertTrue(d['messages']);self.assertIn('Hello',d['messages'][0]['text'])
  gemini=next(r for r in rows if r['agent']=='gemini');self.assertEqual(len(self.call(action='detail',id=gemini['id'])['messages']),2)
  claude=next(r for r in rows if r['agent']=='claude');self.assertIn('/work/app/main.ts',self.call(action='detail',id=claude['id'])['files'])
  memory=self.home/'.claude/projects/project/memory/MEMORY.md';memory.parent.mkdir(parents=True);memory.write_text('# Remember app')
  mem=self.call(kind='memories')['items'][0];self.assertEqual(mem['project'],'/work/app')
 def test_both_opencode_database_formats(self):
  p=self.home/'.local/share/opencode/opencode.db';p.parent.mkdir(parents=True);c=sqlite3.connect(p)
  c.executescript('create table session(id,directory,title,time_updated);create table session_v2(id,directory,title,time_updated);create table message(id,session_id,data,time_created);create table part(id,message_id,data,time_created);create table session_message(id,session_id,type,data,seq,time_created);')
  c.execute('insert into session values(?,?,?,?)',('old','/work/project','Old title',100))
  c.execute('insert into session_v2 values(?,?,?,?)',('new','/work/project','New title',200))
  c.execute('insert into message values(?,?,?,?)',('m','old',json.dumps(dict(role='user')),100))
  c.execute('insert into part values(?,?,?,?)',('p','m',json.dumps(dict(type='text',text='Legacy text')),100))
  c.execute('insert into session_message values(?,?,?,?,?,?)',('n','new','assistant',json.dumps(dict(content=[dict(type='text',text='V2 text')])),1,200));c.commit();c.close()
  rows=self.call()['items'];self.assertEqual(len(rows),2)
  for row in rows:self.assertIn('text',self.call(action='export',id=row['id'])['markdown'])
  c=sqlite3.connect(p);self.assertEqual(c.execute('select count(*) from session').fetchone()[0],1);c.close()
 def test_markdown_conflicts_backup_and_symlinks(self):
  p=self.home/'.codex/memories/MEMORY.md';p.parent.mkdir(parents=True);p.write_text('# Prior\nOriginal')
  row=self.call(kind='memories')['items'][0];sid=row['id'];detail=self.call(kind='memories',action='detail',id=sid)['item'];p.write_text('Other agent changed')
  stale=self.call(kind='memories',action='save',id=sid,revision=detail['revision'],content='overwrite');self.assertEqual(stale['status'],409);self.assertEqual(p.read_text(),'Other agent changed')
  revision=self.call(kind='memories',action='detail',id=sid)['item']['revision'];saved=self.call(kind='memories',action='save',id=sid,revision=revision,content='# Updated\nKept');self.assertTrue(saved['ok']);self.assertEqual(p.read_text(),'# Updated\nKept');self.assertEqual(Path(saved['backup']).read_text(),'Other agent changed')
  p.unlink();target=self.home/'outside.md';target.write_text('Private');p.symlink_to(target);self.assertEqual(self.call(kind='memories')['total'],0)
 def test_engram_patch_contract_with_backup(self):
  p=self.home/'.engram/engram.db';p.parent.mkdir();c=sqlite3.connect(p)
  c.executescript('create table observations(id,title,content,type,project,scope,topic_key,updated_at,revision_count,deleted_at);')
  c.execute('insert into observations values(1,?,?,?,?,?,?,?,?,null)',('Title','Original','decision','project','project','stable-topic','2026-10-04T00:00:00Z',1));c.commit();c.close()
  class Handler(BaseHTTPRequestHandler):
   def log_message(*args):pass
   def do_PATCH(handler):
    self.assertEqual(handler.path,'/observations/1');data=json.loads(handler.rfile.read(int(handler.headers['Content-Length'])))
    c=sqlite3.connect(p);c.execute('update observations set title=?,content=?,updated_at=?,revision_count=revision_count+1 where id=1',(data['title'],data['content'],'2026-10-04T01:00:00Z'));c.commit();c.close();handler.send_response(200);handler.end_headers();handler.wfile.write(b'{}')
  server=HTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever);thread.start();self.env['ENGRAM_PORT']=str(server.server_port)
  try:
   d=self.call(kind='memories',action='detail',id='engram-1')['item'];saved=self.call(kind='memories',action='save',id='engram-1',revision=d['revision'],title='New title',content='Updated');self.assertTrue(saved['ok']);self.assertEqual(saved['item']['content'],'Updated');self.assertEqual(json.loads(Path(saved['backup']).read_text())['content'],'Original');self.assertEqual(saved['item']['topic'],'stable-topic')
   stale=self.call(kind='memories',action='save',id='engram-1',revision=d['revision'],title='New title',content='stale');self.assertEqual(stale['status'],409)
  finally:server.shutdown();thread.join();server.server_close()
 def test_unknown_ids_and_actions_fail_closed(self):
  self.assertEqual(self.call(kind='memories',action='detail',id='../../etc/passwd')['status'],404)
  self.assertEqual(self.call(kind='chats',action='save',id='x')['status'],404)
  self.assertEqual(self.call(kind='unknown')['status'],404)
if __name__=='__main__':unittest.main()
