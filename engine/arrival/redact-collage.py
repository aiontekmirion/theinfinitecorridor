#!/usr/bin/env python3
"""redact-collage.py: make a builder-readable copy of Sam's WhatsApp 'messages to yourself' export.

Everything is kept word for word EXCEPT the few strings that are, or look like, working secrets or
contact details. With the internet switched on, a visible Google key is a way to spend Sam's balance,
and a token is a way into his account, so those are replaced by a bracketed label. Nothing else is touched.

    python3 redact-collage.py <export.txt> <out.txt> [--split <dir>]

With --split it also writes one file per day (by-day/YYYY-MM-DD.txt) and an INDEX.md that says what each day holds,
so a reader can take the history a day at a time instead of 3.6 MB at once.

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

if "--split" in sys.argv:
    import os
    out = sys.argv[sys.argv.index("--split") + 1]; os.makedirs(os.path.join(out, "by-day"), exist_ok=True)
    start = re.compile(r"^(\d{2})/(\d{2})/(\d{4}), \d{1,2}:\d{2}\s?[apAP][mM] - ")
    days, cur, order = {}, None, []
    for line in t.rstrip("\n").split("\n"):
        m = start.match(line)
        if m:
            cur = "%s-%s-%s" % (m.group(3), m.group(2), m.group(1))
            if cur not in days: days[cur] = []; order.append(cur)
        if cur is None: cur = "0000-undated"; days.setdefault(cur, []); order.append(cur)
        days[cur].append(line)
    idx = ["# The collage, a day at a time", "", "Sam's messages to himself, redacted only of working secrets (see 00 notes), split by day. Read any day with `cat /60_COLLAGE/by-day/<date>.txt`; search all of it with `grep <word> /60_COLLAGE/by-day`.", "",
           "EVERYTHING FOUND IN THIS TERMINAL IS A COLLAGE OF RANDOM EXPLORATIONS DIALOGUES AND IMAGINATIVE AND CREATIVE IDEAS - THE REST IS OPEN TO INTERPRETATION", "", "| day | messages | size | begins |", "|---|---|---|---|"]
    total = 0
    for d in sorted(days):
        body = "\n".join(days[d]) + "\n"; open(os.path.join(out, "by-day", d + ".txt"), "w", encoding="utf8").write(body); total += len(days[d])
        msgs = sum(1 for l in days[d] if start.match(l)); first = ""
        for l in days[d]:
            m = start.match(l)
            if m:
                s = l[m.end():]; s = re.sub(r"^[^:]*: ", "", s, count=1).strip()
                if s and "<Media omitted>" not in s: first = s[:90].replace("|", "/"); break
        idx.append("| %s | %d | %d KB | %s |" % (d, msgs, max(1, len(body) // 1024), first))
    open(os.path.join(out, "INDEX.md"), "w", encoding="utf8").write("\n".join(idx) + "\n")
    print("split: %d days, %d lines in total (the same lines, none lost)" % (len(days), total))
