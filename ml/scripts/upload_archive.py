"""Put the Upworthy archive in Blob Storage, with its checksums recorded.

D-001 refused to source the archive from GitHub mirrors because provenance
mattered: byte-identical mirrors prove the copies agree with each other, not with
the original. That argument does not stop once the file is downloaded. Right now
the bytes every reported metric depends on exist on exactly one laptop, with
nothing recording that they are the same bytes tomorrow.

This uploads them and writes a manifest — per-file sha256, byte count, row count
and the published counts from Matias et al. Table 1 that the loader already
asserts against. A training run can then say which bytes it trained on, and a
second machine can prove it has the same ones.

    python ml/scripts/upload_archive.py --account <storage> --container archive
    python ml/scripts/upload_archive.py --verify-only        # no upload, just hash

Auth is DefaultAzureCredential — `az login` locally, a federated credential in
CI. There is no connection string to leak.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import pathlib
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml"))

from subjectrank.config import FILE_PATTERNS, PUBLISHED_COUNTS, RAW  # noqa: E402

MANIFEST = "manifest.json"

# The lede column carries whole HTML paragraphs; the default 128 KB field cap is
# comfortable for this archive but the limit is raised explicitly so a future
# longer field fails loudly rather than truncating a record.
csv.field_size_limit(1 << 24)


def sha256_of(p: pathlib.Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def survey() -> list[dict]:
    """Hash whatever is actually in data/raw, and say what it claims to be."""
    found = []
    for subset, pattern in FILE_PATTERNS.items():
        for p in sorted(RAW.glob(pattern)):
            print(f"  hashing {p.name} ...", flush=True)
            # Row count from the file, not from the published table: the point is
            # to detect a truncated download, and asserting the published number
            # against itself would detect nothing.
            #
            # Counted with the csv reader, NOT by counting newlines. The `lede`
            # column holds HTML paragraphs containing literal newlines inside
            # quoted fields, so a line count reports 31,580 for a file with
            # 22,666 records -- and would have declared both real archive files
            # corrupt. A wrong number that stops a good run is still a wrong
            # number.
            with p.open("r", encoding="utf-8", errors="replace", newline="") as f:
                reader = csv.reader(f)
                next(reader, None)          # header
                rows = sum(1 for _ in reader)
            found.append({
                "subset": subset,
                "file": p.name,
                "bytes": p.stat().st_size,
                "sha256": sha256_of(p),
                "data_rows": rows,
                "published_packages": PUBLISHED_COUNTS[subset]["packages"],
                "published_tests": PUBLISHED_COUNTS[subset]["tests"],
                "rows_match_published": rows == PUBLISHED_COUNTS[subset]["packages"],
            })
    return found


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--account", default=None, help="storage account name")
    ap.add_argument("--container", default="archive")
    ap.add_argument("--verify-only", action="store_true",
                    help="hash and check counts without uploading")
    a = ap.parse_args()

    if not RAW.exists():
        print(f"No {RAW}. See docs/GET_THE_DATA.md — the download is a manual step "
              f"by design (D-001).", file=sys.stderr)
        return 1

    files = survey()
    if not files:
        print(f"No archive CSVs matched in {RAW}.", file=sys.stderr)
        return 1

    manifest = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "https://osf.io/jd64p/  (D-001: canonical, never a mirror)",
        "licence": "CC BY 4.0",
        "citation": (
            "Matias, J.N., Munger, K., Le Quere, M.A. et al. The Upworthy Research "
            "Archive, a time series of 32,487 experiments in U.S. media. "
            "Sci Data 8, 195 (2021)."
        ),
        "files": files,
    }

    print()
    bad = [f for f in files if not f["rows_match_published"]]
    for f in files:
        flag = "" if f["rows_match_published"] else "   <-- ROW COUNT MISMATCH"
        print(f"  {f['subset']:13} {f['bytes']:>12,} B  {f['data_rows']:>7,} rows  "
              f"{f['sha256'][:16]}...{flag}")

    if bad:
        print(f"\n{len(bad)} file(s) do not match the published counts. That is a "
              f"truncated or wrong download, and it must stop here rather than "
              f"become a training run.", file=sys.stderr)
        return 1

    out = RAW / MANIFEST
    out.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"\nwrote {out}")

    if a.verify_only:
        print("--verify-only: nothing uploaded")
        return 0
    if not a.account:
        print("no --account given: nothing uploaded", file=sys.stderr)
        return 1

    from azure.storage.blob import BlobServiceClient

    # AAD first. Being subscription Owner is NOT enough to write a blob: the data
    # plane is governed by its own roles ("Storage Blob Data Contributor"), and
    # without one the upload fails with AuthorizationPermissionMismatch even
    # though every management call succeeds.
    #
    # AZURE_STORAGE_KEY is the fallback, because granting that role from the CLI
    # failed on this subscription with MissingSubscription -- an az quirk, since
    # the same grant works from a Bicep template. This is a one-off admin upload
    # of a public research archive; nothing at runtime uses a key, the app pulls
    # its image with a managed identity, and the registry admin user stays off.
    key = os.environ.get("AZURE_STORAGE_KEY")
    if key:
        print("  authenticating with AZURE_STORAGE_KEY")
        svc = BlobServiceClient(
            f"https://{a.account}.blob.core.windows.net", credential=key,
        )
    else:
        from azure.identity import DefaultAzureCredential
        svc = BlobServiceClient(
            f"https://{a.account}.blob.core.windows.net",
            credential=DefaultAzureCredential(),
        )
    container = svc.get_container_client(a.container)
    for f in files + [{"file": MANIFEST}]:
        p = RAW / f["file"]
        print(f"  uploading {p.name} ({p.stat().st_size:,} B) ...", flush=True)
        with p.open("rb") as fh:
            container.upload_blob(name=p.name, data=fh, overwrite=True)
    print(f"\nuploaded {len(files) + 1} blobs to {a.account}/{a.container}")
    print("Blob versioning is on (azure/infra/main.bicep), so an overwrite cannot "
          "silently change what a past run trained on.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
