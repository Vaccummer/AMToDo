"""Reverse-proxy support middleware.

The server can run plain HTTP behind a local HTTPS reverse proxy. These
middlewares make that setup explicit: only trusted proxy addresses can supply
forwarded client metadata, and security headers are applied at the app edge.
"""

from __future__ import annotations

import ipaddress
from collections.abc import Iterable
from typing import TYPE_CHECKING

from starlette.datastructures import Headers, MutableHeaders

if TYPE_CHECKING:
    from starlette.types import ASGIApp, Message, Receive, Scope, Send


class ForwardedHeadersMiddleware:
    """Trust X-Forwarded-* headers only from configured proxy IPs."""

    def __init__(self, app: ASGIApp, trusted_proxy_ips: Iterable[str]) -> None:
        self.app = app
        self._trusted = tuple(_parse_network(value) for value in trusted_proxy_ips if value)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in {"http", "websocket"}:
            await self.app(scope, receive, send)
            return

        client = scope.get("client")
        client_host = client[0] if client else ""
        if not _is_trusted(client_host, self._trusted):
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        real_ip = _first_header_ip(headers.get("x-real-ip")) or _first_header_ip(
            headers.get("x-forwarded-for")
        )
        if real_ip and client:
            scope["client"] = (real_ip, client[1])
            scope.setdefault("state", {})["client_ip"] = real_ip

        forwarded_proto = _first_header_value(headers.get("x-forwarded-proto"))
        if forwarded_proto in {"http", "https", "ws", "wss"}:
            scope["scheme"] = "https" if forwarded_proto == "wss" else (
                "http" if forwarded_proto == "ws" else forwarded_proto
            )

        await self.app(scope, receive, send)


class SecurityHeadersMiddleware:
    """Attach conservative browser security headers."""

    def __init__(
        self,
        app: ASGIApp,
        *,
        hsts_enabled: bool = False,
        hsts_max_age_seconds: int = 15_552_000,
    ) -> None:
        self.app = app
        self.hsts_enabled = hsts_enabled
        self.hsts_max_age_seconds = hsts_max_age_seconds

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers.setdefault("X-Content-Type-Options", "nosniff")
                headers.setdefault("Referrer-Policy", "no-referrer")
                headers.setdefault("X-Frame-Options", "DENY")
                headers.setdefault(
                    "Permissions-Policy",
                    "camera=(), microphone=(), geolocation=()",
                )
                if self.hsts_enabled and scope.get("scheme") == "https":
                    headers.setdefault(
                        "Strict-Transport-Security",
                        f"max-age={self.hsts_max_age_seconds}",
                    )
            await send(message)

        await self.app(scope, receive, send_with_headers)


def _parse_network(value: str) -> ipaddress.IPv4Network | ipaddress.IPv6Network:
    return ipaddress.ip_network(value, strict=False)


def _is_trusted(
    host: str,
    trusted: tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...],
) -> bool:
    if not trusted:
        return False
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return any(ip in network for network in trusted)


def _first_header_value(value: str | None) -> str:
    if not value:
        return ""
    return value.split(",", 1)[0].strip().lower()


def _first_header_ip(value: str | None) -> str:
    candidate = _first_header_value(value)
    if not candidate:
        return ""
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return ""
