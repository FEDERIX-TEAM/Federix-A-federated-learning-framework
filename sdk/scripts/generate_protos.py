import re
import shutil
import sys
from pathlib import Path

from grpc_tools import protoc

ROOT = Path(__file__).resolve().parents[1]
PROTO_DIR = ROOT.parent / "backend" / "proto"
OUT = ROOT / "src" / "federix_sdk" / "_gen"
IMPORT = re.compile(r"^import (\w+_pb2) as (\w+)$", re.MULTILINE)
PYI_IMPORT = re.compile(r"^import (\w+_pb2) as (\w+)$|^import (\w+_pb2)$", re.MULTILINE)


def main():
    protos = sorted(PROTO_DIR.glob("*.proto"))
    if not protos:
        print(f"no .proto files in {PROTO_DIR}", file=sys.stderr)
        return 1
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    args = ["protoc", f"-I{PROTO_DIR}", f"--python_out={OUT}", f"--pyi_out={OUT}", *map(str, protos)]
    if protoc.main(args) != 0:
        print("protoc failed", file=sys.stderr)
        return 1
    for f in list(OUT.glob("*_pb2.py")) + list(OUT.glob("*_pb2.pyi")):
        text = f.read_text()
        text = IMPORT.sub(r"from . import \1 as \2", text)
        text = re.sub(r"^import (\w+_pb2)$", r"from . import \1", text, flags=re.MULTILINE)
        f.write_text(text)
    (OUT / "__init__.py").write_text("")
    print(f"generated {len(protos)} protos into {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
