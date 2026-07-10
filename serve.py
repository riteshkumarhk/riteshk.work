#!/usr/bin/env python3
"""Local dev server with caching disabled, so edits always show on refresh.

Usage:  python serve.py         (serves this folder at http://localhost:5510)

This is only a local preview helper — it is not needed to deploy the site.
"""
import http.server
import os
import socketserver

PORT = 5510


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
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
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), NoCacheHandler) as httpd:
        print(f"Serving http://localhost:{PORT}  (no-cache mode) — press Ctrl+C to stop")
        httpd.serve_forever()
