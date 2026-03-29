from __future__ import annotations


def to_snake_case(value: str) -> str:
    return "".join(
        f"_{char.lower()}" if char.isupper() else char
        for char in value
    )


def to_kebab_case(value: str) -> str:
    return "".join(
        f"-{char.lower()}" if char.isupper() else char
        for char in value
    )


def get_case_variants(method_name: str) -> list[str]:
    return [method_name, to_snake_case(method_name), to_kebab_case(method_name)]


def get_flexible_methods(http_method: str) -> list[str]:
    method = http_method.upper()
    if method == "GET":
        return ["GET", "POST"]
    if method == "POST":
        return ["POST", "GET"]
    if method == "PUT":
        return ["PUT", "PATCH", "POST"]
    if method == "DELETE":
        return ["DELETE", "POST"]
    return [method]


def generate_route_variants(method_name: str, http_method: str) -> list[dict[str, str]]:
    routes: list[dict[str, str]] = []
    for case_variant in get_case_variants(method_name):
        for method in get_flexible_methods(http_method):
            routes.append(
                {
                    "path": f"/{case_variant}",
                    "method": method,
                }
            )
    return routes
