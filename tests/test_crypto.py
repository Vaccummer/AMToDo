"""Unit tests for the crypto module."""

from __future__ import annotations

import json
import time

import pytest

from amtodo_crypto import (
    ReplayProtector,
    generate_keypair,
    is_envelope,
    open_envelope,
    seal,
)


@pytest.fixture
def keypair() -> tuple[bytes, bytes]:
    return generate_keypair()


class TestKeyGeneration:
    def test_generates_pem_format(self, keypair):
        private_pem, public_pem = keypair
        assert private_pem.startswith(b"-----BEGIN PRIVATE KEY-----")
        assert public_pem.startswith(b"-----BEGIN PUBLIC KEY-----")

    def test_keys_are_different(self, keypair):
        private_pem, public_pem = keypair
        assert private_pem != public_pem


class TestSealAndOpen:
    def test_roundtrip(self, keypair):
        private_pem, public_pem = keypair
        payload = {"title": "hello", "priority": 3, "description": None}
        envelope, _ = seal(payload, public_pem, "server-key-v1")
        inner, _ = open_envelope(envelope, {"server-key-v1": private_pem})
        assert inner["payload"] == payload

    def test_roundtrip_complex_payload(self, keypair):
        private_pem, public_pem = keypair
        payload = {
            "targets": [1, 2, 3],
            "nested": {"a": 1, "b": [True, False]},
            "empty_list": [],
            "zero": 0,
        }
        envelope, _ = seal(payload, public_pem, "server-key-v1")
        inner, _ = open_envelope(envelope, {"server-key-v1": private_pem})
        assert inner["payload"] == payload

    def test_envelope_has_required_fields(self, keypair):
        _, public_pem = keypair
        envelope, _ = seal({"x": 1}, public_pem, "server-key-v1")
        for field in ("version", "keyId", "alg", "ek", "nonce", "data", "tag"):
            assert field in envelope

    def test_envelope_fields_are_strings(self, keypair):
        _, public_pem = keypair
        envelope, _ = seal({"x": 1}, public_pem, "server-key-v1")
        assert isinstance(envelope["version"], int)
        assert isinstance(envelope["keyId"], str)
        assert isinstance(envelope["alg"], str)
        assert isinstance(envelope["ek"], str)
        assert isinstance(envelope["nonce"], str)
        assert isinstance(envelope["data"], str)
        assert isinstance(envelope["tag"], str)

    def test_wrong_private_key_fails(self, keypair):
        _, public_pem = keypair
        other_priv, _ = generate_keypair()
        envelope, _ = seal({"x": 1}, public_pem, "server-key-v1")
        with pytest.raises(ValueError, match="decrypt"):
            open_envelope(envelope, {"server-key-v1": other_priv})

    def test_unknown_key_id_fails(self, keypair):
        _, public_pem = keypair
        envelope, _ = seal({"x": 1}, public_pem, "server-key-v1")
        with pytest.raises(ValueError, match="unknown"):
            open_envelope(envelope, {"other-key": b""})

    def test_malformed_ek_fails(self, keypair):
        private_pem, public_pem = keypair
        envelope, _ = seal({"x": 1}, public_pem, "server-key-v1")
        envelope["ek"] = "!!!not-base64!!!"
        with pytest.raises(ValueError, match="malformed"):
            open_envelope(envelope, {"server-key-v1": private_pem})

    def test_missing_field_fails(self, keypair):
        private_pem, public_pem = keypair
        envelope, _ = seal({"x": 1}, public_pem, "server-key-v1")
        del envelope["data"]
        with pytest.raises(ValueError, match="malformed"):
            open_envelope(envelope, {"server-key-v1": private_pem})

    def test_not_a_dict_fails(self, keypair):
        private_pem, _ = keypair
        with pytest.raises(ValueError, match="JSON object"):
            open_envelope("not a dict", {"k": private_pem})  # type: ignore[arg-type]

    def test_non_overlapping_nonces(self, keypair):
        _, public_pem = keypair
        e1, _ = seal({"a": 1}, public_pem, "server-key-v1")
        e2, _ = seal({"b": 2}, public_pem, "server-key-v1")
        assert e1["nonce"] != e2["nonce"]

    def test_non_overlapping_ek(self, keypair):
        _, public_pem = keypair
        e1, _ = seal({"a": 1}, public_pem, "server-key-v1")
        e2, _ = seal({"b": 2}, public_pem, "server-key-v1")
        assert e1["ek"] != e2["ek"]


class TestIsEnvelope:
    def test_valid_envelope_is_detected(self, keypair):
        _, public_pem = keypair
        envelope, _ = seal({"x": 1}, public_pem, "server-key-v1")
        assert is_envelope(envelope) is True

    def test_plain_body_is_not_envelope(self):
        assert is_envelope({"title": "hello"}) is False

    def test_empty_body_is_not_envelope(self):
        assert is_envelope({}) is False

    def test_plain_business_body_is_not_envelope(self):
        assert is_envelope({"title": "hello", "priority": 1, "due_at": None}) is False


class TestReplayProtector:
    def test_first_request_accepted(self):
        rp = ReplayProtector(tolerance_seconds=300)
        rp.check_and_record("req-1", int(time.time()))

    def test_duplicate_request_rejected(self):
        rp = ReplayProtector(tolerance_seconds=300)
        now = int(time.time())
        rp.check_and_record("req-1", now)
        with pytest.raises(ValueError, match="duplicate"):
            rp.check_and_record("req-1", now)

    def test_expired_timestamp_rejected(self):
        rp = ReplayProtector(tolerance_seconds=60)
        old = int(time.time()) - 120
        with pytest.raises(ValueError, match="drift"):
            rp.check_and_record("req-1", old)

    def test_future_timestamp_rejected(self):
        rp = ReplayProtector(tolerance_seconds=60)
        future = int(time.time()) + 120
        with pytest.raises(ValueError, match="drift"):
            rp.check_and_record("req-1", future)

    def test_different_ids_accepted(self):
        rp = ReplayProtector(tolerance_seconds=300)
        now = int(time.time())
        rp.check_and_record("req-1", now)
        rp.check_and_record("req-2", now)

    def test_same_id_after_expiry_accepted(self):
        rp = ReplayProtector(tolerance_seconds=1)
        old = int(time.time())
        rp.check_and_record("req-1", old)
        time.sleep(1.5)
        # Expiry is now + tolerance, so after tolerance passes the entry is cleaned
        # Force cleanup by checking a new id
        now = int(time.time())
        rp.check_and_record("req-2", now)
        # The old "req-1" should have been cleaned up
        rp.check_and_record("req-1", now)
