#!/usr/bin/env python3
"""Local dev server with caching disabled, so edits always show on refresh.

Usage:  python serve.py         (serves this folder at http://localhost:5510)

This is only a local preview helper — it is not needed to deploy the site.
"""
import http.server
import os

PORT = 5510


class PreviewHTTPServer(http.server.ThreadingHTTPServer):
    # Native previews load module graphs in several frames at once.
    request_queue_size = 128


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_GET(self):
        # Mirror GitHub Pages: unknown paths (e.g. /work/edge) fall back to 404.html,
        # which bounces the SPA back home with the project id preserved.
        fs = self.translate_path(self.path)
        if not os.path.exists(fs):
            self.path = "/404.html"
        return super().do_GET()


if __name__ == "__main__":
    # Always serve this file's folder, regardless of where it was launched from.
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    # Threaded so one slow/stuck client (e.g. a keep-alive connection) never blocks other requests.
    PreviewHTTPServer.allow_reuse_address = True
    with PreviewHTTPServer(("", PORT), NoCacheHandler) as httpd:
        print(f"Serving http://localhost:{PORT}  (no-cache mode) — press Ctrl+C to stop")
        httpd.serve_forever()
