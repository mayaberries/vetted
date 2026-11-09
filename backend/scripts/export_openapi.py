"""
Dump the API's OpenAPI schema to docs/openapi.json.

Run via `make openapi` from the repo root -- never edit docs/openapi.json by
hand. That file is the contract the admin dashboard's types and its tests/wip/
roadmap specs are written against, so a hand-edit (or a forgotten regeneration)
lets the documented API drift from the real one silently.

Imports the app rather than fetching /openapi.json off a running server, so no
database or uvicorn process is needed -- FastAPI builds the schema from the
route definitions alone.

Run from backend/:  python -m scripts.export_openapi
"""
import json
import pathlib
import sys

from app.api.server import app

OUTPUT = pathlib.Path(__file__).resolve().parents[2] / "docs" / "openapi.json"


def main() -> int:
    schema = json.dumps(app.openapi(), indent=2) + "\n"

    previous = OUTPUT.read_text() if OUTPUT.exists() else None
    OUTPUT.write_text(schema)

    if previous == schema:
        print(f"{OUTPUT} already up to date ({len(app.openapi()['paths'])} paths)")
    else:
        print(f"wrote {OUTPUT} ({len(app.openapi()['paths'])} paths)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
