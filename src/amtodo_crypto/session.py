"""ECDH, HKDF, and AES-256-GCM low-level operations (P-256)."""

from __future__ import annotations

import os

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.types import PrivateKeyTypes, PublicKeyTypes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

_NONCE_BYTES = 12
_KEY_BYTES = 32
_HKDF_INFO = b"amtodo-encryption"


def generate_nonce() -> bytes:
    return os.urandom(_NONCE_BYTES)


def _derive_key(shared_secret: bytes) -> bytes:
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=_KEY_BYTES,
        salt=None,
        info=_HKDF_INFO,
    )
    return hkdf.derive(shared_secret)


def ecdh_derive_key(
    private_key: PrivateKeyTypes, peer_public_key: PublicKeyTypes
) -> bytes:
    """Perform P-256 ECDH and derive a symmetric key via HKDF."""
    if not isinstance(private_key, ec.EllipticCurvePrivateKey):
        raise TypeError("expected EllipticCurvePrivateKey (P-256)")
    if not isinstance(peer_public_key, ec.EllipticCurvePublicKey):
        raise TypeError("expected EllipticCurvePublicKey (P-256)")
    shared = private_key.exchange(ec.ECDH(), peer_public_key)
    return _derive_key(shared)


def aes_gcm_encrypt(plaintext: bytes, key: bytes, nonce: bytes) -> bytes:
    """Encrypt with AES-256-GCM. Returns ciphertext || 16-byte-tag."""
    aesgcm = AESGCM(key)
    return aesgcm.encrypt(nonce, plaintext, None)


def aes_gcm_decrypt(ciphertext_with_tag: bytes, key: bytes, nonce: bytes) -> bytes:
    """Decrypt AES-256-GCM. Raises on authentication failure."""
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(nonce, ciphertext_with_tag, None)
