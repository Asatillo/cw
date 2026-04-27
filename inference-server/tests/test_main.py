"""
Tests for the inference server.
Run from the inference-server directory:  pytest tests/
"""
import hashlib
import os
from pathlib import Path
from unittest.mock import MagicMock, call, patch

import pytest
from fastapi.testclient import TestClient

# main.py's load_dotenv reads ../.env which contains API_KEY
import main

client = TestClient(main.app)
_TEST_KEY = os.environ["API_KEY"]
_VALID_HEADERS = {"Authorization": f"Bearer {_TEST_KEY}"}


@pytest.fixture(autouse=True)
def reset_pipeline_state(monkeypatch):
    """Reset global model state before every test."""
    monkeypatch.setattr(main, "pipeline", None)
    monkeypatch.setattr(main, "current_lora_url", None)
    monkeypatch.setattr(main, "current_lora_weight", 0.8)


@pytest.fixture()
def mock_db(monkeypatch):
    db_mock = MagicMock()
    monkeypatch.setattr(main, "db", db_mock)
    return db_mock


@pytest.fixture()
def mock_pipeline(monkeypatch):
    """Replace DiffusionPipeline and LCMScheduler with lightweight mocks."""
    pipe = MagicMock()
    pipe.to.return_value = pipe
    pipe.return_value.images = [MagicMock()]
    monkeypatch.setattr(
        main, "DiffusionPipeline",
        MagicMock(from_pretrained=MagicMock(return_value=pipe))
    )
    monkeypatch.setattr(main, "LCMScheduler", MagicMock())
    return pipe


# ── Auth ──────────────────────────────────────────────────────────────────────

def test_missing_auth_returns_401():
    resp = client.post("/generate", json={"doc_id": "doc1", "prompt": "a cat"})
    assert resp.status_code == 401


def test_invalid_auth_returns_401():
    resp = client.post(
        "/generate",
        json={"doc_id": "doc1", "prompt": "a cat"},
        headers={"Authorization": "Bearer wrong-key"},
    )
    assert resp.status_code == 401


# ── Status lifecycle ──────────────────────────────────────────────────────────

def test_successful_generation_status_lifecycle(mock_db, mock_pipeline):
    doc_ref = MagicMock()
    mock_db.collection.return_value.document.return_value = doc_ref

    resp = client.post(
        "/generate",
        json={"doc_id": "doc1", "prompt": "a forest cabin"},
        headers=_VALID_HEADERS,
    )

    assert resp.status_code == 200
    assert "image" in resp.json()
    assert doc_ref.update.call_args_list[0] == call({"status": "PROCESSING"})
    assert doc_ref.update.call_args_list[1] == call({"status": "DONE"})


def test_pipeline_failure_sets_failed_status(mock_db, mock_pipeline):
    doc_ref = MagicMock()
    mock_db.collection.return_value.document.return_value = doc_ref
    mock_pipeline.side_effect = RuntimeError("out of memory")

    resp = client.post(
        "/generate",
        json={"doc_id": "doc1", "prompt": "a forest cabin"},
        headers=_VALID_HEADERS,
    )

    assert resp.status_code == 500
    last_update = doc_ref.update.call_args_list[-1][0][0]
    assert last_update["status"] == "FAILED"
    assert "out of memory" in last_update["error"]


# ── LoRA weight global state ──────────────────────────────────────────────────

def test_lora_weight_updated_globally_after_successful_load(monkeypatch):
    """
    Regression: current_lora_weight must be in the global declaration so the
    value set here is visible to generate() when it builds cross_attention_kwargs.
    """
    pipe = MagicMock()
    pipe.to.return_value = pipe
    monkeypatch.setattr(
        main, "DiffusionPipeline",
        MagicMock(from_pretrained=MagicMock(return_value=pipe))
    )
    monkeypatch.setattr(main, "LCMScheduler", MagicMock())
    monkeypatch.setattr(main, "download_lora", lambda url: Path("/fake/lora.safetensors"))

    main.get_pipeline("https://example.com/lora.safetensors", lora_weight=0.9)

    assert main.current_lora_weight == 0.9
    assert main.current_lora_url == "https://example.com/lora.safetensors"


def test_lora_weight_resets_to_default_on_load_failure(monkeypatch):
    pipe = MagicMock()
    pipe.to.return_value = pipe
    pipe.load_lora_weights.side_effect = RuntimeError("bad weights")
    monkeypatch.setattr(
        main, "DiffusionPipeline",
        MagicMock(from_pretrained=MagicMock(return_value=pipe))
    )
    monkeypatch.setattr(main, "LCMScheduler", MagicMock())
    monkeypatch.setattr(main, "download_lora", lambda url: Path("/fake/lora.safetensors"))

    main.get_pipeline("https://example.com/lora.safetensors", lora_weight=0.9)

    assert main.current_lora_weight == 0.8  # must reset to default
    assert main.current_lora_url is None


# ── LoRA download cache ───────────────────────────────────────────────────────

def test_download_lora_skips_http_when_file_is_cached(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "LORA_CACHE_DIR", tmp_path)
    url = "https://example.com/style.safetensors"
    url_hash = hashlib.sha256(url.encode()).hexdigest()[:16]
    cached_file = tmp_path / f"{url_hash}_style.safetensors"
    cached_file.write_bytes(b"fake lora data")

    with patch.object(main, "requests") as mock_requests:
        result = main.download_lora(url)
        mock_requests.get.assert_not_called()

    assert result == cached_file