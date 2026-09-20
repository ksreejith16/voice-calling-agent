"""Loopback-only browser harness. This is not a production authentication service.

API contracts verified against LiveKit's official Python API documentation:
https://docs.livekit.io/reference/python/livekit/api/access_token.html
https://docs.livekit.io/reference/python/livekit/api/agent_dispatch_service.html
https://docs.livekit.io/reference/python/livekit/api/room_service.html
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import secrets
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from aiohttp import ClientTimeout, web
from dotenv import load_dotenv
from livekit import api

LOGGER = logging.getLogger("india_voice.browser")
PROJECT_ROOT = Path(__file__).resolve().parents[4]
BROWSER_ROOT = Path(__file__).resolve().parents[2] / "browser"
CLIENT_BUNDLE = PROJECT_ROOT / "node_modules/livekit-client/dist/livekit-client.umd.js"
PROVISION_TIMEOUT_SECONDS = 15
CLEANUP_TIMEOUT_SECONDS = 10


@dataclass(frozen=True)
class BrowserConfig:
    livekit_url: str
    api_key: str = field(repr=False)
    api_secret: str = field(repr=False)
    agent_name: str = "india-voice-prototype"
    port: int = 8765
    session_ttl_seconds: int = 600
    token_ttl_seconds: int = 120
    max_sessions: int = 3

    def __post_init__(self) -> None:
        parsed = urlsplit(self.livekit_url)
        if (
            parsed.scheme not in {"ws", "wss"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("LIVEKIT_URL must be a ws:// or wss:// server URL without credentials or query parameters")
        if not self.api_key.strip() or not self.api_secret.strip():
            raise ValueError("LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required")
        if not self.agent_name.strip() or len(self.agent_name) > 100:
            raise ValueError("VOICE_AGENT_NAME must contain 1–100 characters")
        if not 1 <= self.port <= 65535:
            raise ValueError("Browser port is invalid")
        if not 1 <= self.token_ttl_seconds <= 120:
            raise ValueError("Token TTL must be between 1 and 120 seconds")
        if not self.token_ttl_seconds <= self.session_ttl_seconds <= 600:
            raise ValueError("Session TTL must cover the token TTL and be at most 600 seconds")
        if not 1 <= self.max_sessions <= 3:
            raise ValueError("The local harness permits at most three sessions")

    @classmethod
    def from_env(cls) -> BrowserConfig:
        return cls(
            livekit_url=os.environ.get("LIVEKIT_URL", ""),
            api_key=os.environ.get("LIVEKIT_API_KEY", ""),
            api_secret=os.environ.get("LIVEKIT_API_SECRET", ""),
            agent_name=os.environ.get("VOICE_AGENT_NAME", "india-voice-prototype"),
        )


@dataclass
class OwnedSession:
    room: str
    expires_at: float
    token_expires_at: float
    closing: bool = False
    provisioning: bool = True


class SessionBroker:
    """Owns only random rooms created during this process; never lists project rooms."""

    def __init__(self, config: BrowserConfig, livekit_client: Any) -> None:
        self.config = config
        self.client = livekit_client
        self.sessions: dict[str, OwnedSession] = {}
        self.lock = asyncio.Lock()
        self.stopping = False

    async def create_session(self) -> dict[str, Any]:
        async with self.lock:
            if self.stopping:
                raise web.HTTPServiceUnavailable(text="The local harness is stopping")
            if len(self.sessions) >= self.config.max_sessions:
                raise web.HTTPTooManyRequests(text="Three test sessions are already active or finishing. End a session or wait two minutes.")
            now = time.monotonic()
            handle = secrets.token_urlsafe(32)
            owned = OwnedSession(
                room="iv-prototype-" + secrets.token_hex(16),
                expires_at=now + self.config.session_ttl_seconds,
                # No join token exists until provisioning finishes successfully.
                token_expires_at=now,
            )
            self.sessions[handle] = owned
        try:
            async with asyncio.timeout(PROVISION_TIMEOUT_SECONDS):
                await self.client.room.create_room(api.CreateRoomRequest(
                    name=owned.room, empty_timeout=60, max_participants=2,
                    metadata=json.dumps({"purpose": "local-voice-prototype"}),
                ))
                if self.stopping or owned.closing:
                    raise RuntimeError("Session ended during provisioning")
                await self.client.agent_dispatch.create_dispatch(api.CreateAgentDispatchRequest(
                    room=owned.room,
                    agent_name=self.config.agent_name,
                    metadata=json.dumps({"prototype": True, "session_ttl_seconds": self.config.session_ttl_seconds}),
                ))
            if self.stopping or owned.closing or time.monotonic() >= owned.expires_at:
                raise RuntimeError("Session ended during provisioning")
            remaining_seconds = max(1, int(owned.expires_at - time.monotonic()))
            token_ttl = min(self.config.token_ttl_seconds, remaining_seconds)
            token = (
                api.AccessToken(self.config.api_key, self.config.api_secret)
                .with_identity("browser-" + secrets.token_hex(12))
                .with_name("Local voice tester")
                .with_ttl(timedelta(seconds=token_ttl))
                .with_grants(api.VideoGrants(
                    room_join=True,
                    room=owned.room,
                    can_publish=True,
                    can_publish_sources=["microphone"],
                    can_subscribe=True,
                    can_publish_data=False,
                    can_update_own_metadata=False,
                    room_admin=False,
                    room_create=False,
                    room_list=False,
                    room_record=False,
                ))
                .to_jwt()
            )
            owned.token_expires_at = time.monotonic() + token_ttl
            owned.provisioning = False
            return {
                "url": self.config.livekit_url,
                "token": token,
                "room": owned.room,
                "sessionHandle": handle,
                "expiresAt": (datetime.now(timezone.utc) + timedelta(seconds=max(0, owned.expires_at - time.monotonic()))).isoformat(),
                "agentName": self.config.agent_name,
            }
        except asyncio.CancelledError:
            owned.provisioning = False
            owned.closing = True
            raise
        except Exception as error:
            owned.provisioning = False
            owned.closing = True
            # Do not log provider responses, connection URLs, JWTs, or credentials.
            LOGGER.warning("LiveKit session provisioning failed (%s)", type(error).__name__)
            await self._delete_owned(handle, owned)
            raise web.HTTPBadGateway(text="LiveKit could not create or dispatch the test session. Check server configuration and the named worker.") from None

    async def end_session(self, handle: str) -> bool:
        async with self.lock:
            owned = self.sessions.get(handle)
            if owned is None:
                return True  # Idempotent; an unknown handle can never name a room.
            owned.closing = True
        return await self._delete_owned(handle, owned)

    async def _delete_owned(self, handle: str, owned: OwnedSession) -> bool:
        if owned.provisioning:
            return False
        try:
            async with asyncio.timeout(CLEANUP_TIMEOUT_SECONDS):
                await self.client.room.delete_room(api.DeleteRoomRequest(room=owned.room))
        except api.TwirpError as error:
            if error.code != "not_found":
                LOGGER.warning("Owned room cleanup failed (%s); retry scheduled", type(error).__name__)
                return False
        except Exception as error:
            LOGGER.warning("Owned room cleanup failed (%s); retry scheduled", type(error).__name__)
            return False
        # Retain ended rooms until the short join token expires. Repeated cleanup
        # catches reconnection with that token during this window; JWT expiry by
        # itself never disconnects an already-connected participant.
        if time.monotonic() >= owned.token_expires_at:
            async with self.lock:
                if self.sessions.get(handle) is owned:
                    self.sessions.pop(handle, None)
        return True

    async def reap(self) -> None:
        now = time.monotonic()
        due = []
        for handle, owned in list(self.sessions.items()):
            if not owned.provisioning and (owned.closing or owned.expires_at <= now):
                owned.closing = True
                due.append(self._delete_owned(handle, owned))
        if due:
            await asyncio.gather(*due)

    async def shutdown(self) -> None:
        self.stopping = True
        for owned in self.sessions.values():
            owned.closing = True
        await self.reap()


CONFIG_KEY = web.AppKey("browser_config", BrowserConfig)
BROKER_KEY = web.AppKey("session_broker", SessionBroker)


def create_app(config: BrowserConfig, *, livekit_client: Any = None) -> web.Application:
    """The injected SDK client is for tests; production uses the real LiveKit API."""
    allowed_hosts = {f"127.0.0.1:{config.port}", f"localhost:{config.port}"}

    @web.middleware
    async def local_security(request: web.Request, handler: Any) -> web.StreamResponse:
        try:
            # Fixed host allowlist also rejects DNS rebinding and forwarded hosts.
            if request.host not in allowed_hosts:
                raise web.HTTPForbidden(text="Use the loopback browser URL")
            if request.method not in {"GET", "HEAD"}:
                if request.headers.get("Origin") != f"http://{request.host}":
                    raise web.HTTPForbidden(text="Same-origin requests are required")
                if request.content_type != "application/json":
                    raise web.HTTPUnsupportedMediaType(text="Use an application/json request")
            response = await handler(request)
        except web.HTTPException as error:
            response = web.json_response({"error": error.text}, status=error.status)
        response.headers.update({
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "Cross-Origin-Resource-Policy": "same-origin",
            "Permissions-Policy": "microphone=(self), camera=(), display-capture=()",
            "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' ws: wss: https: http://127.0.0.1:7880; media-src 'self' blob:; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        })
        return response

    app = web.Application(middlewares=[local_security], client_max_size=1024)
    app[CONFIG_KEY] = config

    async def lifecycle(application: web.Application):
        sdk = livekit_client or api.LiveKitAPI(
            config.livekit_url, config.api_key, config.api_secret,
            timeout=ClientTimeout(total=10),
        )
        broker = SessionBroker(config, sdk)
        application[BROKER_KEY] = broker

        async def cleanup_loop() -> None:
            while True:
                await asyncio.sleep(15)
                await broker.reap()

        task = asyncio.create_task(cleanup_loop())
        try:
            yield
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
            await broker.shutdown()
            if livekit_client is None:
                await sdk.aclose()

    async def read_body(request: web.Request) -> dict[str, Any]:
        try:
            body = await request.json()
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise web.HTTPBadRequest(text="Expected a JSON object") from None
        if not isinstance(body, dict):
            raise web.HTTPBadRequest(text="Expected a JSON object")
        return body

    async def start_session(request: web.Request) -> web.Response:
        if await read_body(request) != {}:
            raise web.HTTPBadRequest(text="Session requests must be an empty JSON object; room and tenant inputs are not accepted")
        return web.json_response(await request.app[BROKER_KEY].create_session())

    async def end_session(request: web.Request) -> web.Response:
        body = await read_body(request)
        handle = body.get("sessionHandle")
        if set(body) != {"sessionHandle"} or not isinstance(handle, str) or not 20 <= len(handle) <= 100:
            raise web.HTTPBadRequest(text="A valid session handle is required")
        if not await request.app[BROKER_KEY].end_session(handle):
            raise web.HTTPServiceUnavailable(text="The browser disconnected, but room cleanup will retry. Keep the harness running.")
        return web.json_response({"ended": True})

    async def health(_request: web.Request) -> web.Response:
        return web.json_response({"status": "ok", "service": "india-voice-browser", "providerConnectivityVerified": False})

    async def favicon(_request: web.Request) -> web.Response:
        # Browsers request this automatically; no icon is needed by the harness.
        return web.Response(status=204)

    async def asset(request: web.Request) -> web.FileResponse:
        routes = {
            "/": BROWSER_ROOT / "index.html",
            "/app.js": BROWSER_ROOT / "app.js",
            "/styles.css": BROWSER_ROOT / "styles.css",
            "/vendor/livekit-client.umd.js": CLIENT_BUNDLE,
        }
        path = routes[request.path]
        if not path.is_file():
            raise web.HTTPServiceUnavailable(text="Browser assets are missing. Run npm install at the repository root.")
        return web.FileResponse(path)

    app.cleanup_ctx.append(lifecycle)
    app.router.add_get("/health", health)
    app.router.add_get("/favicon.ico", favicon)
    app.router.add_post("/session", start_session)
    app.router.add_post("/session/end", end_session)
    for path in ("/", "/app.js", "/styles.css", "/vendor/livekit-client.umd.js"):
        app.router.add_get(path, asset)
    return app


def main() -> None:
    load_dotenv(PROJECT_ROOT / ".env", override=False)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    try:
        config = BrowserConfig.from_env()
    except ValueError as error:
        raise SystemExit(str(error)) from None
    if not CLIENT_BUNDLE.is_file():
        raise SystemExit("Missing LiveKit browser bundle. Run npm install from the repository root.")
    web.run_app(create_app(config), host="127.0.0.1", port=config.port, access_log=None)


if __name__ == "__main__":
    main()
