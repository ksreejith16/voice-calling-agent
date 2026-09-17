"""Mocked control-plane tests. No LiveKit server or paid provider is contacted."""

import asyncio
from dataclasses import replace
from datetime import datetime, timezone
import json
import time
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
import jwt
from livekit import api

from india_voice import browser


def config(**values):
    return replace(browser.BrowserConfig(
        livekit_url="wss://test-project.livekit.cloud",
        api_key="test-key", api_secret="test-secret-which-is-at-least-32-bytes",
    ), **values)


def sdk():
    return SimpleNamespace(
        room=SimpleNamespace(create_room=AsyncMock(), delete_room=AsyncMock()),
        agent_dispatch=SimpleNamespace(create_dispatch=AsyncMock()),
        aclose=AsyncMock(),
    )


class BrowserConfigurationTests(unittest.TestCase):
    def test_configuration_rejects_invalid_credentials_urls_and_resource_limits(self):
        invalid = (
            {"livekit_url": "https://server.example"},
            {"livekit_url": "wss://key:secret@server.example"},
            {"livekit_url": "wss://server.example?token=secret"},
            {"livekit_url": "wss://server.example#secret"},
            {"api_key": " "}, {"api_secret": ""}, {"agent_name": ""},
            {"port": 0}, {"token_ttl_seconds": 121}, {"token_ttl_seconds": 0},
            {"session_ttl_seconds": 601}, {"session_ttl_seconds": 119},
            {"max_sessions": 4}, {"max_sessions": 0},
        )
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                config(**value)

    def test_config_repr_never_contains_credentials(self):
        value = config()
        self.assertNotIn(value.api_key, repr(value))
        self.assertNotIn(value.api_secret, repr(value))


class BrowserHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.config = config()
        self.sdk = sdk()
        self.app = browser.create_app(self.config, livekit_client=self.sdk)
        self.client = TestClient(TestServer(self.app))
        await self.client.start_server()
        self.headers = {"Host": "127.0.0.1:8765", "Origin": "http://127.0.0.1:8765"}

    async def asyncTearDown(self):
        await self.client.close()

    async def post(self, path="/session", body=None, **kwargs):
        return await self.client.post(path, json={} if body is None else body,
                                      headers=kwargs.pop("headers", self.headers), **kwargs)

    async def test_same_origin_session_has_signed_room_scoped_microphone_only_token(self):
        response = await self.post()
        self.assertEqual(response.status, 200)
        value = await response.json()
        claims = jwt.decode(value["token"], self.config.api_secret, algorithms=["HS256"],
                            issuer=self.config.api_key)
        grants = claims["video"]
        self.assertEqual(grants["room"], value["room"])
        self.assertTrue(value["room"].startswith("iv-prototype-"))
        self.assertTrue(claims["sub"].startswith("browser-"))
        self.assertEqual(grants["canPublishSources"], ["microphone"])
        self.assertTrue(grants["roomJoin"])
        self.assertTrue(grants["canSubscribe"])
        for grant in ("canPublishData", "canUpdateOwnMetadata", "roomAdmin", "roomCreate", "roomList", "roomRecord"):
            self.assertFalse(grants[grant])
        self.assertLessEqual(claims["exp"] - claims["nbf"], 120)
        self.assertNotIn(self.config.api_secret, json.dumps(value))
        self.assertNotIn(self.config.api_key, json.dumps(value))
        self.assertEqual(set(value), {"url", "token", "room", "sessionHandle", "expiresAt", "agentName"})
        create_request = self.sdk.room.create_room.await_args.args[0]
        dispatch = self.sdk.agent_dispatch.create_dispatch.await_args.args[0]
        self.assertEqual(create_request.name, value["room"])
        self.assertEqual(create_request.max_participants, 2)
        self.assertEqual(dispatch.room, value["room"])
        self.assertEqual(dispatch.agent_name, "india-voice-prototype")

    async def test_non_same_origin_requests_and_dns_rebinding_hosts_are_rejected(self):
        headers_to_reject = (
            {"Host": "127.0.0.1:8765"},
            {"Host": "127.0.0.1:8765", "Origin": "https://untrusted.example"},
            {"Host": "untrusted.example:8765", "Origin": "http://untrusted.example:8765"},
            {"Host": "127.0.0.1:8765", "Origin": "null"},
            {"Host": "127.0.0.1:8765", "Origin": "http://localhost:8765"},
        )
        for headers in headers_to_reject:
            with self.subTest(headers=headers):
                response = await self.post(headers=headers)
                self.assertEqual(response.status, 403)
        self.sdk.room.create_room.assert_not_awaited()

    async def test_localhost_alias_is_accepted_only_with_matching_origin(self):
        response = await self.post(headers={"Host": "localhost:8765", "Origin": "http://localhost:8765"})
        self.assertEqual(response.status, 200)

    async def test_browser_cannot_supply_room_tenant_identity_or_dispatch_inputs(self):
        for body in ({"room": "production-room"}, {"organizationId": "tenant"},
                     {"identity": "admin"}, {"agentName": "production-worker"}, []):
            with self.subTest(body=body):
                response = await self.post(body=body)
                self.assertEqual(response.status, 400)
        self.sdk.room.create_room.assert_not_awaited()

    async def test_malformed_oversized_and_non_json_bodies_are_rejected(self):
        response = await self.client.post("/session", data="{}", headers=self.headers)
        self.assertEqual(response.status, 415)
        for body, expected in (("{", 400), ('{"extra":"' + "a" * 2000 + '"}', 413)):
            response = await self.client.post("/session", data=body,
                headers={**self.headers, "Content-Type": "application/json"})
            self.assertEqual(response.status, expected)
        self.sdk.room.create_room.assert_not_awaited()

    async def test_health_and_assets_are_local_and_do_not_claim_provider_connectivity(self):
        response = await self.client.get("/health", headers=self.headers)
        self.assertEqual(response.status, 200)
        self.assertFalse((await response.json())["providerConnectivityVerified"])
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertIn("frame-ancestors 'none'", response.headers["Content-Security-Policy"])
        response = await self.client.get("/", headers=self.headers)
        self.assertEqual(response.status, 200)
        self.assertIn("Start voice test", await response.text())
        self.sdk.room.create_room.assert_not_awaited()

    async def test_unknown_handle_is_idempotent_and_never_deletes_arbitrary_room(self):
        response = await self.post("/session/end", {"sessionHandle": "production-room-which-is-not-owned"})
        self.assertEqual(response.status, 200)
        self.sdk.room.delete_room.assert_not_awaited()
        for body in ({"room": "production-room"}, {"sessionHandle": "short"}):
            response = await self.post("/session/end", body)
            self.assertEqual(response.status, 400)

    async def test_dispatch_failure_is_sanitized_and_created_room_is_deleted(self):
        self.sdk.agent_dispatch.create_dispatch.side_effect = RuntimeError("provider-response-containing-test-secret")
        response = await self.post()
        self.assertEqual(response.status, 502)
        self.assertNotIn("test-secret", await response.text())
        self.sdk.room.delete_room.assert_awaited_once()
        self.assertEqual(len(self.app[browser.BROKER_KEY].sessions), 0)

    async def test_cleanup_failure_is_reported_and_background_reaper_retries(self):
        started = await (await self.post()).json()
        self.sdk.room.delete_room.side_effect = RuntimeError("unavailable")
        response = await self.post("/session/end", {"sessionHandle": started["sessionHandle"]})
        self.assertEqual(response.status, 503)
        self.sdk.room.delete_room.side_effect = None
        broker = self.app[browser.BROKER_KEY]
        broker.sessions[started["sessionHandle"]].token_expires_at = time.monotonic() - 1
        await broker.reap()
        self.assertEqual(len(broker.sessions), 0)
        self.assertEqual(self.sdk.room.delete_room.await_count, 2)


class BrokerLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.sdk = sdk()
        self.broker = browser.SessionBroker(config(), self.sdk)

    async def test_token_cleanup_window_starts_when_token_is_issued(self):
        clock = SimpleNamespace(monotonic=lambda: 100.0)

        async def slow_dispatch(_request):
            clock.monotonic = lambda: 109.0

        self.sdk.agent_dispatch.create_dispatch.side_effect = slow_dispatch
        with patch.object(browser, "time", clock):
            value = await self.broker.create_session()
            owned = self.broker.sessions[value["sessionHandle"]]
            self.assertEqual(owned.token_expires_at, 229)
            self.assertEqual(owned.expires_at, 700)
            remaining = (datetime.fromisoformat(value["expiresAt"]) - datetime.now(timezone.utc)).total_seconds()
            self.assertLessEqual(remaining, 591)
            self.assertGreater(remaining, 590)

    async def test_concurrent_provisioning_reserves_capacity_before_provider_calls(self):
        self.broker = browser.SessionBroker(config(max_sessions=1), self.sdk)
        entered, release = asyncio.Event(), asyncio.Event()

        async def pending(_request):
            entered.set()
            await release.wait()

        self.sdk.room.create_room.side_effect = pending
        task = asyncio.create_task(self.broker.create_session())
        await entered.wait()
        with self.assertRaises(web.HTTPTooManyRequests):
            await self.broker.create_session()
        release.set()
        await task
        self.sdk.room.create_room.assert_awaited_once()

    async def test_cancelled_provisioning_keeps_owned_room_for_cleanup(self):
        entered = asyncio.Event()

        async def pending(_request):
            entered.set()
            await asyncio.Event().wait()

        self.sdk.agent_dispatch.create_dispatch.side_effect = pending
        task = asyncio.create_task(self.broker.create_session())
        await entered.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertTrue(next(iter(self.broker.sessions.values())).closing)
        await self.broker.reap()
        self.sdk.room.delete_room.assert_awaited_once()
        self.assertEqual(len(self.broker.sessions), 0)

    async def test_provision_timeout_cleans_up_partial_room(self):
        async def pending(_request):
            await asyncio.Event().wait()

        self.sdk.room.create_room.side_effect = pending
        with patch.object(browser, "PROVISION_TIMEOUT_SECONDS", 0.01):
            with self.assertRaises(web.HTTPBadGateway):
                await self.broker.create_session()
        self.sdk.room.delete_room.assert_awaited_once()
        self.assertEqual(len(self.broker.sessions), 0)

    async def test_cleanup_timeout_retains_retry_state(self):
        value = await self.broker.create_session()

        async def pending(_request):
            await asyncio.Event().wait()

        self.sdk.room.delete_room.side_effect = pending
        with patch.object(browser, "CLEANUP_TIMEOUT_SECONDS", 0.01):
            self.assertFalse(await self.broker.end_session(value["sessionHandle"]))
        self.assertTrue(self.broker.sessions[value["sessionHandle"]].closing)

    async def test_ended_room_is_redeleted_until_join_token_expires(self):
        value = await self.broker.create_session()
        self.assertTrue(await self.broker.end_session(value["sessionHandle"]))
        self.assertIn(value["sessionHandle"], self.broker.sessions)
        await self.broker.reap()
        self.assertEqual(self.sdk.room.delete_room.await_count, 2)
        owned = self.broker.sessions[value["sessionHandle"]]
        owned.token_expires_at = time.monotonic() - 1
        await self.broker.reap()
        self.assertNotIn(value["sessionHandle"], self.broker.sessions)
        self.assertEqual(self.sdk.room.delete_room.await_count, 3)

    async def test_reaper_only_deletes_expired_owned_rooms(self):
        first = await self.broker.create_session()
        second = await self.broker.create_session()
        self.broker.sessions[first["sessionHandle"]].expires_at = time.monotonic() - 1
        await self.broker.reap()
        self.sdk.room.delete_room.assert_awaited_once()
        self.assertEqual(self.sdk.room.delete_room.await_args.args[0].room, first["room"])
        self.assertFalse(self.broker.sessions[second["sessionHandle"]].closing)

    async def test_already_deleted_room_is_successful_cleanup(self):
        value = await self.broker.create_session()
        self.broker.sessions[value["sessionHandle"]].token_expires_at = time.monotonic() - 1
        self.sdk.room.delete_room.side_effect = api.TwirpError("not_found", "room gone", status=404)
        self.assertTrue(await self.broker.end_session(value["sessionHandle"]))
        self.assertEqual(len(self.broker.sessions), 0)

    async def test_shutdown_deletes_owned_rooms_and_rejects_new_work(self):
        first = await self.broker.create_session()
        second = await self.broker.create_session()
        await self.broker.shutdown()
        deleted = {call.args[0].room for call in self.sdk.room.delete_room.await_args_list}
        self.assertEqual(deleted, {first["room"], second["room"]})
        with self.assertRaises(web.HTTPServiceUnavailable):
            await self.broker.create_session()

    async def test_shutdown_during_provisioning_cannot_dispatch_or_issue_token(self):
        entered, release = asyncio.Event(), asyncio.Event()

        async def pending(_request):
            entered.set()
            await release.wait()

        self.sdk.room.create_room.side_effect = pending
        task = asyncio.create_task(self.broker.create_session())
        await entered.wait()
        await self.broker.shutdown()
        release.set()
        with self.assertRaises(web.HTTPBadGateway):
            await task
        self.sdk.agent_dispatch.create_dispatch.assert_not_awaited()
        self.sdk.room.delete_room.assert_awaited_once()
        self.assertEqual(len(self.broker.sessions), 0)


if __name__ == "__main__":
    unittest.main()
