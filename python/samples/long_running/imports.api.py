from __future__ import annotations

import time

from plat import Controller, POST, RouteContext

from samples.long_running.models import ImportCatalogInput, ImportCatalogOutput


@Controller("catalogImports", {"tag": "Catalog Imports"})
class CatalogImportsApi:
    @POST(
        {
            "summary": "Import a catalog",
            "description": "Simulate a long-running import with progress and logs.",
            "longRunning": True,
        }
    )
    def importCatalog(
        self,
        input: ImportCatalogInput,
        ctx: RouteContext,
    ) -> ImportCatalogOutput:
        if ctx.call:
            ctx.call["log"]({"message": f"Starting import from {input.source}"})

        for index in range(1, input.items + 1):
            if ctx.call and ctx.call["cancelled"]():
                ctx.call["log"]({"message": "Import cancelled"})
                raise RuntimeError("Import cancelled")

            time.sleep(0.1)
            if ctx.call:
                ctx.call["progress"](
                    {
                        "completed": index,
                        "total": input.items,
                        "pct": round(index / input.items * 100),
                    }
                )
                ctx.call["log"]({"message": f"Imported item {index}/{input.items}"})

        return ImportCatalogOutput(
            source=input.source,
            imported=input.items,
            status="completed",
        )
