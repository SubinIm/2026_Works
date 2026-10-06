"""Check ZIP integrity, hashes, declared extension assets and packaged Host hello."""
from pathlib import Path
import hashlib
import json
import os
import struct
import subprocess
import tempfile
import zipfile

root = Path(__file__).resolve().parents[1]
packages = root / "packages"
for line in (packages / "SHA256SUMS.txt").read_text().splitlines():
    expected, name = line.split("  ", 1)
    archive = packages / name
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == expected, name
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None, name
        names = set(z.namelist())
        assert not any(".." in Path(p).parts or p.startswith("/") or "\\" in p for p in names)
        assert not any(set(p.split("/")) & {"_metadata", "node_modules", ".MATLABDriveTag", ".rollback"} for p in names)
        manifests = [p for p in names if p.endswith("/manifest.json") and "/filters/" not in p]
        assert len(manifests) == 1, manifests
        manifest_path = manifests[0]
        prefix = manifest_path.rsplit("/", 1)[0] + "/"
        manifest = json.loads(z.read(manifest_path))
        assets = list(manifest.get("icons", {}).values())
        assets += [manifest["background"]["service_worker"]] if "background" in manifest else []
        assets += [manifest["action"]["default_popup"]]
        if "options_page" in manifest:
            assets += [manifest["options_page"]]
        if "options_ui" in manifest:
            assets += [manifest["options_ui"]["page"]]
        if "side_panel" in manifest:
            assets += [manifest["side_panel"]["default_path"].split("?")[0]]
        for script in manifest.get("content_scripts", []):
            assets += script.get("js", []) + script.get("css", [])
        for rules in manifest.get("declarative_net_request", {}).get("rule_resources", []):
            assets += [rules["path"]]
            assert isinstance(json.loads(z.read(prefix + rules["path"])), list)
        for asset in assets:
            assert prefix + asset in names, (name, asset)
        if "native-host/dist/stream_host.exe" in names:
            assert os.name == "nt", "Run Host smoke check on Windows"
            with tempfile.TemporaryDirectory(prefix="psd-package-") as temporary:
                executable = Path(temporary) / "stream_host.exe"
                executable.write_bytes(z.read("native-host/dist/stream_host.exe"))
                message = json.dumps({"protocolVersion": 1, "messageId": "package-check", "type": "hello", "payload": {}}).encode()
                env = {**os.environ, "PSD_STATE_ROOT": str(Path(temporary) / "state"), "PSD_DOWNLOAD_ROOT": str(Path(temporary) / "downloads")}
                completed = subprocess.run([str(executable)], input=struct.pack("<I", len(message)) + message, capture_output=True, env=env, timeout=15, check=True)
                length = struct.unpack("<I", completed.stdout[:4])[0]
                response = json.loads(completed.stdout[4:4 + length])
                assert response["type"] == "hello_result", response
                assert response["payload"]["hostVersion"] == manifest["version"], response
        print(f"OK: {name} ({len(names)} files, extension {manifest['version']})")
