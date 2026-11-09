#!/usr/bin/env python3
"""The app's JavaScript bundle (Hermes bytecode, from `expo export`) as people download it in an
update: gzip-compressed KB, as JSON for perf/compare.py.

usage: bundle_size.py <export dir> <out.json>
"""

import glob
import gzip
import json
import sys

export, out = sys.argv[1], sys.argv[2]
files = glob.glob(f"{export}/_expo/static/js/*/*.hbc") + glob.glob(f"{export}/_expo/static/js/*/*.js")
if not files:
    sys.exit(f"no bundle under {export}/_expo/static/js")
size = max(len(gzip.compress(open(f, "rb").read(), compresslevel=9)) for f in files)
with open(out, "w") as f:
    json.dump({"bundle_kb": round(size / 1024, 1)}, f)
print(out, round(size / 1024, 1), "KB")
