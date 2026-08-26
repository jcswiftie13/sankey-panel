#!/usr/bin/env python3
"""Local dev server: python3 -m http.server, minus the caching.

The stock handler sends Last-Modified and no Cache-Control, so browsers apply
heuristic caching and happily keep serving a stale app.js after you edit it --
you change the code, reload, and see the old behaviour. Here every response is
no-store and conditional requests are ignored, so a reload always gets the file
that is on disk right now.
"""

from __future__ import annotations

import argparse
import http.server


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        # Without this the browser revalidates and gets a 304 -> it keeps
        # rendering the copy already in its cache.
        if "If-Modified-Since" in self.headers:
            del self.headers["If-Modified-Since"]
        if "If-None-Match" in self.headers:
            del self.headers["If-None-Match"]
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args(argv)
    srv = http.server.ThreadingHTTPServer((args.host, args.port), NoCacheHandler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
