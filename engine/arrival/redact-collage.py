#!/usr/bin/env python3
"""redact-collage.py: make a builder-readable copy of Sam's WhatsApp 'messages to yourself' export.

Everything is kept word for word EXCEPT the few strings that are, or look like, working secrets or
contact details. With the internet switched on, a visible Google key is a way to spend Sam's balance,
and a token is a way into his account, so those are replaced by a bracketed label. Nothing else is touched.

    python3 redact-collage.py <export.txt> <out.txt>

Prints counts only, never a value.
"""
import re, sys, collections
src, dst = sys.argv[1], sys.argv[2]
t = open(src, encoding="utf8", errors="replace").read()
rules = [
  ("api key",      r"AIza[0-9A-Za-z_\-]{30,}|AQ\.[0-9A-Za-z_\-]{30,}"),
  ("access token", r"gh[pousr]_[0-9A-Za-z]{20,}|github_pat_\w{20,}|xox[bap]-[0-9A-Za-z\-]{10,}|AKIA[0-9A-Z]{16}"),
  ("secret key",   r"\bsk-[A-Za-z0-9_\-]{20,}"),
  ("email",        r"[\w.+-]+@[\w-]+\.[\w.-]+"),
  # a real phone number: standalone, with a + country code or a UK 07 mobile; never digits inside a web address or hash
  ("phone",        r"(?<![\w/.\-=])(?:\+\d{1,3}[ \-]?\d[\d \-]{8,13}\d|0[1-9]\d{2}[ \-]?\d{3}[ \-]?\d{3,4})(?![\w/.\-])"),
]
count = collections.Counter()
for label, pat in rules:
    t, n = re.subn(pat, "[" + label + " removed]", t)
    count[label] = n
open(dst, "w", encoding="utf8").write(t)
print("lines:", t.count("\n"), "| removed:", dict(count))
