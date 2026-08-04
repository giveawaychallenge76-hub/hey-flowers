#!/usr/bin/env python3
"""Local dev server that replays the headers from vercel.json.

Plain `python3 -m http.server` serves without CSP, so a policy that would
break every gift on the live site looks perfectly fine locally. This applies
the same header rules Vercel will, so what we test is what ships.
"""
import http.server, json, os, re, socketserver, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RULES = []
for block in json.load(open(os.path.join(ROOT, 'vercel.json')))['headers']:
    # vercel source globs are close enough to regex for our purposes
    RULES.append((re.compile('^' + block['source'] + '$'), block['headers']))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        path = self.path.split('?')[0]
        for pattern, headers in RULES:
            if pattern.match(path):
                for h in headers:
                    self.send_header(h['key'], h['value'])
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


socketserver.TCPServer.allow_reuse_address = True
port = int(sys.argv[1]) if len(sys.argv) > 1 else 4176
with socketserver.TCPServer(("", port), Handler) as httpd:
    print(f"serving {ROOT} with vercel.json headers on :{port}")
    httpd.serve_forever()
