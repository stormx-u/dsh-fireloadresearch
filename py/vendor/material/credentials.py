"""Local OpenRouter credential storage using current-user Windows DPAPI.

The environment variable OPENROUTER_API_KEY takes precedence. No plaintext key
is written to disk. DPAPI ties saved keys to this Windows user and computer.
"""
from __future__ import annotations

import ctypes
from ctypes import wintypes
import os
from pathlib import Path
import tempfile


KEY_PATH = Path(__file__).resolve().parent / ".runtime" / "openrouter-key.bin"
_MAGIC = b"FMDPAPI1\0"
_ENTROPY = b"furniture-material-tool/openrouter/v1"
_MAX_BLOB_BYTES = 65536


class CredentialError(RuntimeError):
    """A display-safe credential error; never includes key material."""


def _validate_key(key: str) -> str:
    if not isinstance(key, str):
        raise CredentialError("请输入有效的 OpenRouter API 密钥。")
    key = key.strip()
    if not key or len(key) > 4096 or any(character.isspace() or ord(character) < 32 for character in key):
        raise CredentialError("请输入有效的 OpenRouter API 密钥。")
    return key


def _dpapi(data: bytes, *, protect: bool) -> bytes:
    if os.name != "nt":
        raise CredentialError("保存密钥需要 Windows 的本机加密服务。")

    class DataBlob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]

    def blob(value: bytes):
        buffer = ctypes.create_string_buffer(value)
        return DataBlob(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte))), buffer

    input_blob, input_buffer = blob(data)
    entropy_blob, entropy_buffer = blob(_ENTROPY)
    output_blob = DataBlob()
    try:
        crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        local_free = kernel32.LocalFree
        local_free.argtypes = [ctypes.c_void_p]
        local_free.restype = ctypes.c_void_p
        if protect:
            operation = crypt32.CryptProtectData
            operation.argtypes = [
                ctypes.POINTER(DataBlob), wintypes.LPCWSTR, ctypes.POINTER(DataBlob),
                ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(DataBlob),
            ]
            description = "Furniture Material Tool OpenRouter key"
        else:
            operation = crypt32.CryptUnprotectData
            operation.argtypes = [
                ctypes.POINTER(DataBlob), ctypes.c_void_p, ctypes.POINTER(DataBlob),
                ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(DataBlob),
            ]
            description = None
        operation.restype = wintypes.BOOL
        # CRYPTPROTECT_UI_FORBIDDEN, without CRYPTPROTECT_LOCAL_MACHINE.
        ok = operation(
            ctypes.byref(input_blob), description, ctypes.byref(entropy_blob),
            None, None, 0x1, ctypes.byref(output_blob),
        )
        if not ok:
            raise CredentialError("本机密钥加密服务无法完成操作。")
        try:
            return ctypes.string_at(output_blob.pbData, output_blob.cbData)
        finally:
            local_free(ctypes.cast(output_blob.pbData, ctypes.c_void_p))
    except CredentialError:
        raise
    except Exception:
        raise CredentialError("本机密钥加密服务无法完成操作。") from None
    finally:
        # Wipe the mutable input buffers after DPAPI finishes.
        ctypes.memset(input_buffer, 0, ctypes.sizeof(input_buffer))
        ctypes.memset(entropy_buffer, 0, ctypes.sizeof(entropy_buffer))


def get_key() -> str | None:
    """Return the environment key first, or decrypt the locally saved key."""
    environment_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if environment_key:
        return _validate_key(environment_key)
    try:
        if not KEY_PATH.exists():
            return None
        if KEY_PATH.stat().st_size > _MAX_BLOB_BYTES:
            raise CredentialError("本机保存的密钥无法解密，请重新保存。")
        encrypted = KEY_PATH.read_bytes()
        if not encrypted.startswith(_MAGIC) or len(encrypted) <= len(_MAGIC):
            raise CredentialError("本机保存的密钥无法解密，请重新保存。")
        return _validate_key(_dpapi(encrypted[len(_MAGIC):], protect=False).decode("utf-8"))
    except Exception:
        raise CredentialError("本机保存的密钥无法解密，请重新保存。") from None


def save_key(key: str) -> None:
    """Encrypt before opening any file; atomically replace the local key."""
    key = _validate_key(key)
    encrypted = _MAGIC + _dpapi(key.encode("utf-8"), protect=True)
    temporary_path = None
    try:
        KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(prefix=".key-", suffix=".tmp", dir=KEY_PATH.parent, delete=False) as output:
            temporary_path = Path(output.name)
            output.write(encrypted)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_path, KEY_PATH)
        temporary_path = None
    except Exception:
        raise CredentialError("无法保存本机加密密钥。") from None
    finally:
        if temporary_path is not None:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                pass


def clear_key() -> None:
    """Remove the local encrypted file; process environment is unchanged."""
    try:
        KEY_PATH.unlink(missing_ok=True)
    except OSError:
        raise CredentialError("无法删除本机保存的密钥。") from None
