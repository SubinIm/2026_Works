from __future__ import annotations

import argparse
import http.server
import mimetypes
import os
import time
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


mimetypes.add_type("application/vnd.apple.mpegurl", ".m3u8")
mimetypes.add_type("application/dash+xml", ".mpd")
mimetypes.add_type("video/mp2t", ".ts")
mimetypes.add_type("video/iso.segment", ".m4s")


class FixtureHandler(http.server.SimpleHTTPRequestHandler):
    server_version = "PSD-Fixture/1"

    def log_message(self, format: str, *args: object) -> None:
        safe_args = tuple(urlsplit(str(value)).path if "token=" in str(value) else value for value in args)
        super().log_message(format, *safe_args)

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        if parsed.path == "/auth/set-cookie":
            self.send_response(204)
            self.send_header("Set-Cookie", "session=fixture-ok; Path=/; SameSite=Lax")
            self.end_headers()
            return
        if parsed.path == "/auth/referer.m3u8":
            expected = f"http://127.0.0.1:{self.server.server_port}/player/"
            if self.headers.get("Referer") != expected:
                return self._forbidden("Referer required")
            return self._manifest()
        if parsed.path == "/auth/cookie.m3u8":
            if "session=fixture-ok" not in self.headers.get("Cookie", ""):
                return self._forbidden("Cookie required")
            return self._manifest()
        if parsed.path == "/auth/signed.m3u8":
            if parse_qs(parsed.query).get("token") != ["valid-fixture-token"]:
                return self._forbidden("Signed URL expired or invalid")
            return self._manifest()
        if parsed.path == "/slow/stream.m3u8":
            return self._manifest(prefix="/slow/hls-")
        if parsed.path.startswith("/slow/hls-") and parsed.path.endswith(".ts"):
            time.sleep(3.0)
            self.path = "/generated/" + parsed.path.rsplit("/", 1)[-1]
            return super().do_GET()
        super().do_GET()

    def _manifest(self, prefix: str = "/generated/hls-") -> None:
        source = Path(self.directory or os.getcwd()) / "generated" / "stream.m3u8"
        body = source.read_text(encoding="utf-8").replace("hls-", prefix).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.apple.mpegurl")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _forbidden(self, reason: str) -> None:
        body = reason.encode("utf-8")
        self.send_response(403)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--directory", type=Path, default=Path(__file__).parent)
    args = parser.parse_args()
    handler = lambda *values, **kwargs: FixtureHandler(*values, directory=str(args.directory), **kwargs)
    with http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        print(f"Server URL: http://127.0.0.1:{server.server_port}/", flush=True)
        print(f"Test page: http://127.0.0.1:{server.server_port}/player/", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
