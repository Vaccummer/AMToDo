"""P-256 key generation and loading helpers."""

from __future__ import annotations

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.types import PrivateKeyTypes, PublicKeyTypes


def _private_to_pem(private_key) -> bytes:
    return private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )


def _public_to_pem(public_key) -> bytes:
    return public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )


def generate_keypair() -> tuple[bytes, bytes]:
    """Generate a P-256 (secp256r1) ECDH key pair. Returns (private_pem, public_pem)."""
    private_key = ec.generate_private_key(ec.SECP256R1())
    return _private_to_pem(private_key), _public_to_pem(private_key.public_key())


def load_private_key(pem: bytes) -> PrivateKeyTypes:
    return serialization.load_pem_private_key(pem, password=None)


def load_public_key(pem: bytes) -> PublicKeyTypes:
    return serialization.load_pem_public_key(pem)


def public_key_spki(pem: bytes) -> bytes:
    """Return P-256 public key as SubjectPublicKeyInfo DER bytes."""
    key = load_public_key(pem)
    if not isinstance(key, ec.EllipticCurvePublicKey):
        raise TypeError(f"unsupported key type: {type(key)}")
    return key.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
