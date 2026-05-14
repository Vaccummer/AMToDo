"""Encrypted envelope: seal (client) and open (server) — P-256 + AES-256-GCM."""

from __future__ import annotations

import base64
import json
import time
import uuid

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from amtodo_crypto.keys import load_private_key, load_public_key
from amtodo_crypto.session import (
    aes_gcm_decrypt,
    aes_gcm_encrypt,
    ecdh_derive_key,
    generate_nonce,
)

_ENVELOPE_VERSION = 1
_ALGORITHM = "ECDH-P256-HKDF-SHA256+A256GCM"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64url_decode(s: str) -> bytes:
    padding = 4 - len(s) % 4
    if padding != 4:
        s += "=" * padding
    return base64.urlsafe_b64decode(s)


def seal(payload: dict, public_key_pem: bytes, key_id: str) -> dict:
    """Encrypt *payload* into an envelope dict ready for JSON serialization."""
    server_public = load_public_key(public_key_pem)
    if not isinstance(server_public, ec.EllipticCurvePublicKey):
        raise TypeError("server public key must be P-256")

    ephemeral = ec.generate_private_key(ec.SECP256R1())
    data_key = ecdh_derive_key(ephemeral, server_public)
    nonce = generate_nonce()

    now = int(time.time())
    inner = json.dumps({
        "requestId": uuid.uuid4().hex,
        "timestamp": now,
        "payload": payload,
    }).encode("utf-8")

    ciphertext = aes_gcm_encrypt(inner, data_key, nonce)
    tag = ciphertext[-16:]
    ciphertext = ciphertext[:-16]

    ek_raw = ephemeral.public_key().public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )

    return {
        "version": _ENVELOPE_VERSION,
        "keyId": key_id,
        "alg": _ALGORITHM,
        "ek": _b64url(ek_raw),
        "nonce": _b64url(nonce),
        "data": _b64url(ciphertext),
        "tag": _b64url(tag),
    }


def open_envelope(envelope: dict, private_keys: dict[str, bytes]) -> dict:
    """Decrypt *envelope* and return the inner payload dict.

    *private_keys* maps key_id → private key PEM bytes.
    Raises ValueError on any decryption or format error.
    """
    if not isinstance(envelope, dict):
        raise ValueError("envelope must be a JSON object")

    key_id = envelope.get("keyId")
    if not key_id or key_id not in private_keys:
        raise ValueError(f"unknown or missing keyId: {key_id!r}")

    try:
        ek_raw = _b64url_decode(envelope["ek"])
        nonce = _b64url_decode(envelope["nonce"])
        ciphertext = _b64url_decode(envelope["data"])
        tag = _b64url_decode(envelope["tag"])
    except (KeyError, ValueError) as exc:
        raise ValueError(f"malformed envelope field: {exc}") from exc

    server_private = load_private_key(private_keys[key_id])
    if not isinstance(server_private, ec.EllipticCurvePrivateKey):
        raise TypeError("server private key must be P-256")

    try:
        client_public = ec.EllipticCurvePublicKey.from_encoded_point(
            ec.SECP256R1(), ek_raw
        )
    except Exception as exc:
        raise ValueError("invalid ephemeral public key") from exc

    try:
        data_key = ecdh_derive_key(server_private, client_public)
    except Exception as exc:
        raise ValueError("failed to derive data key") from exc

    try:
        plaintext = aes_gcm_decrypt(ciphertext + tag, data_key, nonce)
    except Exception as exc:
        raise ValueError("failed to decrypt data") from exc

    try:
        inner = json.loads(plaintext)
    except json.JSONDecodeError as exc:
        raise ValueError("inner payload is not valid JSON") from exc

    if not isinstance(inner, dict):
        raise ValueError("inner payload must be a JSON object")

    for field in ("requestId", "timestamp", "payload"):
        if field not in inner:
            raise ValueError(f"inner payload missing field: {field}")

    return inner


_ENVELOPE_REQUIRED = frozenset({"ek", "nonce", "data", "tag"})


def is_envelope(body: dict) -> bool:
    """Return True if *body* looks like an encrypted envelope."""
    return _ENVELOPE_REQUIRED.issubset(body.keys())
