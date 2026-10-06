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

    def test_flatpak_scope_origin_mask_and_full_commit_are_preserved(self):
        ctx={"uid":42,"user":"any","home":"/srv/home","env":{}}
        commit="a"*64
        def command(args,*unused,**kwargs):
            if args[1]=="list":return "org.unknown.App/x86_64/stable\t1.0\tmy-origin\n" if "--app" in args else ""
            if args[1]=="mask":return "org.unknown.App\n" if "--system" in args else ""
            if args[1]=="remote-ls":return "org.unknown.App/x86_64/stable\t"+commit+"\tmy-origin\n"
            raise AssertionError(args)
        with patch.object(host,"context",return_value=ctx),patch.object(host,"tool",side_effect=lambda name,*_:"/bin/flatpak" if name=="flatpak" else None),patch.object(host,"command",side_effect=command),patch.object(host,"enrich"),patch.object(host,"local_executables"),patch.object(host.os,"getuid",return_value=0):
            rows=host.scan({"user":"any","updates":True})["installations"]
        system,user=rows;self.assertNotEqual(system["id"],user["id"]);self.assertEqual(system["updateState"],"held");self.assertFalse(system["canUpdate"]);self.assertTrue(user["canUpdate"])
        self.assertEqual(user["targetCommit"],commit);tx=host.build_transaction([user]);self.assertIn("--user",tx["argv"]);self.assertIn("--commit="+commit,tx["argv"]);self.assertIn("--no-deps",tx["argv"])

    def test_uncatalogued_local_executable_is_discovered_without_running_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory=pathlib.Path(tmp)/".local/bin";directory.mkdir(parents=True)
            executable=directory/"not-in-any-catalog";marker=pathlib.Path(tmp)/"executed"
            executable.write_text("#!/bin/sh\ntouch '"+str(marker)+"'\n");executable.chmod(0o755)
            rows,sources=[],[]
            host.local_executables(rows,{"uid":42,"user":"any","home":tmp}, {},sources,systemdir=None)
            self.assertEqual(rows[0]["packageName"],"not-in-any-catalog");self.assertEqual(rows[0]["updateState"],"unmanaged");self.assertFalse(marker.exists());self.assertFalse(rows[0]["canUpdate"])

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

if __name__=="__main__":unittest.main()
