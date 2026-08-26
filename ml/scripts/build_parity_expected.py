"""Emit parity/expected.json: the Python extractor's output on the frozen corpus.

The TypeScript parity runner asserts element-wise equality against this file.
Values are serialised with repr-level precision so the comparison tolerance is
about genuine float arithmetic, not about JSON rounding.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml"))

from subjectrank.features import extract, feature_names, FEATURE_SPEC_VERSION  # noqa: E402

corpus = json.loads((ROOT / "parity" / "corpus.json").read_text(encoding="utf-8"))
names = feature_names()

rows = []
for e in corpus["entries"]:
    rows.append({"text": e["text"], "vector": [float(v) for v in extract(e["text"])]})

out = {
    "spec_version": FEATURE_SPEC_VERSION,
    "feature_names": names,
    "n_features": len(names),
    "count": len(rows),
    "rows": rows,
}
p = ROOT / "parity" / "expected.json"
p.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print(f"wrote {p.relative_to(ROOT)}: {len(rows)} rows x {len(names)} features")
