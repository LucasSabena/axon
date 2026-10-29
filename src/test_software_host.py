"""Fixtures exercise host boundaries without changing the machine's packages."""
import importlib.util
import json
import os
import pathlib
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("software_host", pathlib.Path(__file__).with_name("software-host.py"))
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)

class NativeContract(unittest.TestCase):
    def test_identity_keeps_manager_user_prefix_and_architecture(self):
        base = host.identity("pnpm", "user", 42, "/srv/a", "tool")
        for manager, uid, root, arch in [("bun",42,"/srv/a",""),("pnpm",43,"/srv/a",""),("pnpm",42,"/srv/b",""),("pnpm",42,"/srv/a","arm64")]:
            self.assertNotEqual(base, host.identity(manager,"user",uid,root,"tool",arch))

    def test_direct_globals_ignore_transitive_versions_and_parse_pnpm_notice(self):
        data = [{"path":"/custom/global","dependencies":{"unknown":{"version":"1.2.3","dependencies":{"nested":{"version":"99.0.0"}}}}}]
        records, root = host.global_dependencies("[WARN] Global project check skipped\n"+json.dumps(data))
        self.assertEqual(list(records),["unknown"]); self.assertEqual(root,"/custom/global")

    def test_apt_plan_contains_dependencies_and_blocks_removal(self):
        row = host.record("apt","system",None,"/","application","1.0",targetVersion="2.0")
        with patch.object(host,"command",return_value="Inst application [1.0] (2.0 repository [amd64])\nInst dependency (3.0 repository [amd64])\n"):
            tx = host.build_transaction([row])
            self.assertEqual([p["packageName"] for p in tx["simulation"]["changes"]],["application","dependency"])
            self.assertIn("application=2.0",tx["argv"]); self.assertIn("--no-remove",tx["argv"])
        with patch.object(host,"command",return_value="Remv important [1.0]\n"):
            with self.assertRaisesRegex(ValueError,"elimina"): host.build_transaction([row])

    def test_a_changed_installation_or_candidate_invalidates_plan(self):
        row = host.record("snap","system",None,"/var/lib/snapd","tool","1.0",canUpdate=True,targetVersion="2.0",targetRevision="22")
        with patch.object(host,"scan",return_value={"installations":[row]}):
            with self.assertRaisesRegex(ValueError,"instalación cambió"):host.plan({"user":"any","items":[{**row,"version":"0.9"}]})
            with self.assertRaisesRegex(ValueError,"candidato cambió"):host.plan({"user":"any","items":[{**row,"targetRevision":"21"}]})

    def test_pnpm_updates_the_same_prefix_with_an_exact_version(self):
        ctx={"uid":42,"user":"any"};row=host.record("pnpm","user",ctx,"/custom/prefix","@scope/tool","1.0.0",targetVersion="2.0.0")
        self.assertEqual(host.build_transaction([row])["argv"],["pnpm","--dir","/custom/prefix","add","-g","@scope/tool@2.0.0"])
        with self.assertRaises(ValueError):host.build_transaction([{**row,"packageName":"tool; touch /tmp/anything"}])

    def test_pnpm_updates_itself_with_self_update_in_its_own_transaction(self):
        ctx={"uid":42,"user":"any"};prefix="/custom/prefix"
        own=host.record("pnpm","user",ctx,prefix,"pnpm","12.9.1",targetVersion="12.14.0",canUpdate=True)
        other=host.record("pnpm","user",ctx,prefix,"tool","1.0.0",targetVersion="2.0.0",canUpdate=True)
        self.assertEqual(host.build_transaction([own])["argv"],["pnpm","self-update","12.14.0"])
        with self.assertRaises(ValueError):host.build_transaction([own,other])
        src={"id":"pnpm-src","complete":True}
        rows=[{**own,"sourceId":"pnpm-src"},{**other,"sourceId":"pnpm-src"}]
        with patch.object(host,"scan",return_value={"installations":rows,"sources":[src]}):
            txs=host.plan({"user":"any","items":rows})["transactions"]
        self.assertEqual(sorted(tx["argv"][1] for tx in txs),["--dir","self-update"])

    def test_flatpak_scope_origin_mask_and_full_commit_are_preserved(self):
        ctx={"uid":42,"user":"any","home":"/srv/home","env":{}}
        commit="a"*64
        def command(args,*unused,**kwargs):
            if args[1]=="list":return "org.unknown.App/x86_64/stable\t1.0\tmy-origin\n" if "--app" in args else ""
            if args[1]=="mask":return "org.unknown.App\n" if "--system" in args else ""
            if args[1]=="remote-ls":return "org.unknown.App/x86_64/stable\t"+commit+"\tmy-origin\n"
            raise AssertionError(args)
        with patch.object(host,"context",return_value=ctx),patch.object(host,"tool",side_effect=lambda name,*_:"/bin/flatpak" if name=="flatpak" else None),patch.object(host,"command",side_effect=command),patch.object(host,"enrich"),patch.object(host,"local_executables"),patch.object(host.os,"getuid",return_value=0):
            rows=host.scan({"user":"any","updates":True,"managers":["flatpak"]})["installations"]
        system,user=rows;self.assertNotEqual(system["id"],user["id"]);self.assertEqual(system["updateState"],"held");self.assertFalse(system["canUpdate"]);self.assertTrue(user["canUpdate"])
        self.assertEqual(user["targetCommit"],commit);tx=host.build_transaction([user]);self.assertIn("--user",tx["argv"]);self.assertIn("--commit="+commit,tx["argv"]);self.assertIn("--no-deps",tx["argv"])

    def test_flatpak_short_commit_is_resolved_to_the_full_hash(self):
        ctx={"uid":42,"user":"any","home":"/srv/home","env":{}}
        commit="c8dc11565887"+"b"*52
        def command(args,*unused,**kwargs):
            if args[1]=="list":return "runtime/org.unknown.Platform/x86_64/25.08\t1.0\tflathub\n" if "--runtime" in args and "--user" in args else ""
            if args[1]=="mask":return ""
            if args[1]=="remote-ls":return "runtime/org.unknown.Platform/x86_64/25.08\tc8dc11565887\tflathub\n" if "--user" in args else ""
            if args[1]=="remote-info":return commit+"\n"
            raise AssertionError(args)
        with patch.object(host,"context",return_value=ctx),patch.object(host,"tool",side_effect=lambda name,*_:"/bin/flatpak" if name=="flatpak" else None),patch.object(host,"command",side_effect=command),patch.object(host,"enrich"),patch.object(host,"local_executables"),patch.object(host.os,"getuid",return_value=0):
            row,=host.scan({"user":"any","updates":True,"managers":["flatpak"]})["installations"]
        self.assertTrue(row["canUpdate"]);self.assertEqual(row["targetCommit"],commit);self.assertIn("--commit="+commit,host.build_transaction([row])["argv"])

    def test_leftovers_preselect_caches_and_old_data_but_not_recent_or_shared_config(self):
        with tempfile.TemporaryDirectory() as home:
            uid=os.getuid();ctx={"uid":uid,"user":"any","home":home,"env":{}}
            for folder in [".cache/tool",".config/tool",".local/share/tool",".config/shared",".ssh",".tool","Documents/tool"]: os.makedirs(home+"/"+folder)
            old=0;os.utime(home+"/.local/share/tool",(old,old))
            row=host.record("pnpm","user",ctx,"/p","tool","1.0",executables=["shared"])
            other=host.record("apt","system",None,"/","shared","1.0")
            found={f["path"][len(home)+1:]:f for f in host.leftovers(row,[row,other],ctx)}
        self.assertEqual(set(found),{".cache/tool",".config/tool",".local/share/tool",".config/shared",".tool"})
        self.assertTrue(found[".cache/tool"]["selected"]);self.assertTrue(found[".local/share/tool"]["selected"])
        self.assertFalse(found[".config/tool"]["selected"]);self.assertIn("días",found[".config/tool"]["note"])
        self.assertFalse(found[".config/shared"]["selected"]);self.assertTrue(found[".config/shared"]["shared"])

    def test_removal_preview_blocks_protected_and_essential_apt_packages(self):
        row=host.record("apt","system",None,"/","bash","5.2")
        def command(args,*unused,**kwargs):
            if args[:2]==["apt-get","-s"]:return "Purg bash [5.2]\nRemv gdm3 [50]\n"
            if args[0]=="dpkg-query":return "bash\tyes\trequired\ngdm3\tno\toptional\n"
            raise AssertionError(args)
        with patch.object(host,"scan",return_value={"installations":[row]}),patch.object(host,"command",side_effect=command),patch.object(host,"context",return_value={"uid":0,"user":"root","home":"/nonexistent","env":{}}),patch.object(host.os,"getuid",return_value=0):
            preview=host.removal_preview({"user":"root","item":{"id":row["id"]}})["preview"]
        self.assertFalse(preview["canExecute"]);self.assertEqual(preview["commands"],[]);self.assertTrue(any("bash" in b for b in preview["blockers"]))

    def test_remove_rechecks_the_preview_runs_the_manager_and_trashes_only_chosen_leftovers(self):
        with tempfile.TemporaryDirectory() as home:
            uid=os.getuid();ctx={"uid":uid,"user":"any","home":home,"env":{"PATH":"/bin"}}
            os.makedirs(home+"/.cache/tool");os.makedirs(home+"/.config/tool")
            row=host.record("pnpm","user",ctx,"/p","tool","1.0")
            ran=[];state={"installed":True}
            def scan(req): return {"installations":[row] if state["installed"] else []}
            def command(argv,*unused,**kwargs): ran.append(argv);state["installed"]=False;return ""
            with patch.object(host,"scan",side_effect=scan),patch.object(host,"context",return_value=ctx),patch.object(host,"tool",return_value="/bin/pnpm"),patch.object(host,"command",side_effect=command),patch.object(host,"acquire",return_value=[]),patch.object(host.os,"chown"):
                preview=host.removal_preview({"user":"any","item":{"id":row["id"]}})["preview"]
                state["installed"]=True
                forged={"user":"any","preview":preview,"createdAt":host.time.time()*1000,"leftovers":[home+"/.ssh"]}
                with self.assertRaisesRegex(ValueError,"revisión"):host.remove(forged)
                self.assertEqual(ran,[])
                host.remove({**forged,"leftovers":[home+"/.cache/tool"]})
            self.assertEqual(ran,[["/bin/pnpm","remove","-g","tool"]])
            self.assertFalse(os.path.exists(home+"/.cache/tool"));self.assertTrue(os.path.isdir(home+"/.config/tool"))
            self.assertTrue(os.path.isdir(home+"/.local/share/Trash/files/tool"))
            self.assertIn("Path="+home+"/.cache/tool",open(home+"/.local/share/Trash/info/tool.trashinfo").read())

    def test_uncatalogued_local_executable_is_discovered_without_running_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory=pathlib.Path(tmp)/".local/bin";directory.mkdir(parents=True)
            executable=directory/"not-in-any-catalog";marker=pathlib.Path(tmp)/"executed"
            executable.write_text("#!/bin/sh\ntouch '"+str(marker)+"'\n");executable.chmod(0o755)
            rows,sources=[],[]
            host.local_executables(rows,{"uid":42,"user":"any","home":tmp}, {},sources,systemdir=None)
            self.assertEqual(rows[0]["packageName"],"not-in-any-catalog");self.assertEqual(rows[0]["updateState"],"unmanaged");self.assertFalse(marker.exists());self.assertFalse(rows[0]["canUpdate"])

    def test_dangling_global_executable_is_visible_instead_of_silently_disappearing(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory=pathlib.Path(tmp)/".local/bin";directory.mkdir(parents=True)
            (directory/"wrangler").symlink_to("../lib/node_modules/wrangler/bin/wrangler.js")
            rows,sources=[],[]
            host.local_executables(rows,{"uid":42,"user":"any","home":tmp},{},sources,systemdir=None)
            self.assertEqual(rows[0]["packageName"],"wrangler");self.assertIn("Acceso roto",rows[0]["reason"]);self.assertFalse(rows[0]["canUpdate"])

    def test_selected_manager_scan_does_not_wait_for_other_repositories(self):
        ctx={"uid":42,"user":"any","home":"/srv/home","env":{}}
        def command(argv,*a,**k):
            self.assertEqual(argv[0],"pacman")
            return "tool 1.0\n" if argv[1]=="-Q" else "tool 1.0 -> 2.0\n"
        with patch.object(host,"context",return_value=ctx),patch.object(host,"tool",side_effect=lambda name,*a:'/bin/'+name),patch.object(host,"command",side_effect=command):
            result=host.scan({"user":"any","managers":["pacman"],"updates":True})
        self.assertEqual(len(result["sources"]),1)
        self.assertEqual(result["installations"][0]["targetVersion"],"2.0")

    def test_icons_use_inherited_themes_and_do_not_escape_allowed_roots(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);(root/"custom").mkdir();(root/"hicolor/scalable/apps").mkdir(parents=True)
            (root/"custom/index.theme").write_text("[Icon Theme]\nInherits=hicolor\n")
            icon=root/"hicolor/scalable/apps/tool.svg";icon.write_text('<svg xmlns="http://www.w3.org/2000/svg"/>')
            self.assertEqual(host.resolve_icon("tool",[tmp],"custom"),str(icon))
            (root/"hicolor/scalable/apps/escape.svg").symlink_to("/etc/passwd")
            self.assertIsNone(host.resolve_icon("escape",[tmp]));self.assertIsNone(host.resolve_icon("../tool",[tmp]))

    def test_native_lock_blocks_a_second_instance(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(host,"lock_directory",return_value=pathlib.Path(tmp)):
            handles=host.acquire(["apt:system:root:/"])
            try:
                with self.assertRaisesRegex(RuntimeError,"Otra operación"):host.acquire(["apt:system:root:/"])
            finally:
                for fd in handles:os.close(fd)
            for fd in host.acquire(["apt:system:root:/"]):os.close(fd)

    def test_user_lock_namespace_is_shared_by_root_and_user_axons(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(host,"lock_directory",return_value=pathlib.Path(tmp)) as directory,patch.object(host.pwd,"getpwnam",return_value=SimpleNamespace(pw_uid=42)),patch.object(host.os,"fchown"):
            with patch.object(host.os,"getuid",return_value=0):handles=host.acquire(["pnpm:user:any:/custom/prefix"])
            try:
                with patch.object(host.os,"getuid",return_value=42):
                    with self.assertRaisesRegex(RuntimeError,"Otra operación"):host.acquire(["pnpm:user:any:/custom/prefix"])
                self.assertEqual([call.args for call in directory.call_args_list],[(42,),(42,)])
            finally:
                for fd in handles:os.close(fd)

    def test_executor_verifies_native_record_after_command_success(self):
        ctx={"uid":42,"user":"any","home":"/srv/home","env":{"PATH":"/bin"}}
        row=host.record("pnpm","user",ctx,"/custom/prefix","unknown-tool","1.0.0",targetVersion="2.0.0")
        tx=host.build_transaction([row])
        for installed in ["1.0.0", "2.0.0"]:
            with patch.object(host,"acquire",return_value=[]),patch.object(host,"plan",return_value={"transactions":[tx]}),patch.object(host,"context",return_value=ctx),patch.object(host,"tool",return_value="/bin/pnpm"),patch.object(host,"command",return_value=""),patch.object(host,"scan",return_value={"installations":[{**row,"version":installed}]}):
                req={"plan":{"createdAt":host.time.time()*1000,"transactions":[tx]}}
                if installed=="1.0.0":
                    with self.assertRaisesRegex(RuntimeError,"no coincide"):host.execute(req)
                else:self.assertTrue(host.execute(req)["verified"])

    def test_executor_does_not_run_if_dependency_simulation_changes(self):
        tx={"manager":"apt","scope":"system","user":"root","root":"/","items":[]}
        with patch.object(host,"acquire",return_value=[]),patch.object(host,"plan",return_value={"transactions":[{**tx,"different":True}]}),patch.object(host,"command") as command:
            with self.assertRaisesRegex(ValueError,"dependencias cambiaron"):host.execute({"plan":{"createdAt":host.time.time()*1000,"transactions":[tx]}})
            command.assert_not_called()

    def test_light_verification_scan_skips_metadata_and_integrations(self):
        ctx={"uid":42,"user":"any","home":"/srv/home","env":{}}
        with patch.object(host,"context",return_value=ctx),patch.object(host,"tool",return_value=None),patch.object(host,"enrich") as enrich,patch.object(host,"local_executables") as local:
            result=host.scan({"user":"any","updates":False,"light":True,"integrations":[{"id":"x","binary":"tool","package":"tool"}]})
        enrich.assert_not_called();local.assert_not_called();self.assertEqual(result["installations"],[])

    def test_systemd_unit_pids_reads_show_output(self):
        output="Id=a.service\nExecMainPID=1234\n\nId=b.service\nExecMainPID=0\n\nId=c.service\nExecMainPID=-\n"
        with patch.object(host,"command",return_value=output):
            self.assertEqual(host.systemd_unit_pids(["a.service","b.service","c.service"]),{"a.service":1234,"b.service":0})

    def test_restart_only_units_running_updated_package_binaries(self):
        calls=[]
        def command(argv,*a,**k):
            if argv[1]=="list-units":return "tailscaled.service loaded active running tailscaled\nother.service loaded active running other\n"
            if argv[1]=="show":return "Id=tailscaled.service\nExecMainPID=1234\n\nId=other.service\nExecMainPID=5678\n"
            if argv[0]=="dpkg-query":return "tailscale: /usr/sbin/tailscaled\notherpkg: /usr/bin/other\n"
            if argv[1]=="try-restart":calls.append(argv);return ""
            raise AssertionError(argv)
        with patch.object(host,"tool",return_value="/bin/systemctl"),patch.object(host,"command",side_effect=command),patch.object(host.os,"readlink",side_effect=lambda p:"/usr/sbin/tailscaled" if "1234" in p else "/usr/bin/other"):
            host.restart_services(["tailscale"])
        self.assertEqual(calls,[["systemctl","try-restart","tailscaled.service"]])

    def test_a_failed_service_restart_warns_without_failing_the_update(self):
        def command(argv,*a,**k):
            if argv[1]=="list-units":return "a.service loaded active running a\n"
            if argv[1]=="show":return "Id=a.service\nExecMainPID=42\n"
            if argv[0]=="dpkg-query":return "pkg: /usr/bin/a\n"
            if argv[1]=="try-restart":raise RuntimeError("denied")
            raise AssertionError(argv)
        with patch.object(host,"tool",return_value="/bin/systemctl"),patch.object(host,"command",side_effect=command),patch.object(host.os,"readlink",return_value="/usr/bin/a"):
            host.restart_services(["pkg"])

if __name__=="__main__":unittest.main()
