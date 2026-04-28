# Codeway Barcelona Backend Case

A backend platform for AI image generation with LoRA style adapters, running entirely on a local machine using Firebase emulators.

## Architecture

```
Publisher Client
      │  writes generation_requests doc (CREATED)
      ▼
Firestore Emulator
      │  onDocumentCreated trigger
      ▼
Cloud Function ──── GET /v1/config/{user_id} ────► Config Service
      │  POST /generate
      ▼
Inference Server (FastAPI + LCM Diffusion)
      │  updates doc status: PROCESSING → DONE / FAILED
      ▼
Firestore Emulator
```

## Prerequisites

- Node.js 20+
- Python 3.11+
- Java (required by Firebase emulators)
- Firebase CLI: `npm install -g firebase-tools`

## Setup

```powershell
# Copy and configure environment variables
cp .env.example .env
# Edit .env and set a secure API_KEY

# Install all dependencies
.\setup.ps1
```

## Running

```powershell
.\start.ps1
```

This runs all tests first, then opens three service windows:

| Service | URL |
|---|---|
| Config Service | http://127.0.0.1:3000 |
| Firebase Emulators (UI) | http://127.0.0.1:4000 |
| Inference Server | http://127.0.0.1:8000 |

Once all services are up, publish generation requests:

```powershell
cd publisher
npm start
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `API_KEY` | Shared secret between Cloud Function and Inference Server | — |
| `INFERENCE_SERVER_URL` | Base URL of the inference server | `http://127.0.0.1:8000` |
| `CONFIG_SERVICE_URL` | Base URL of the config service | `http://127.0.0.1:3000` |
| `FIREBASE_PROJECT_ID` | Firebase project ID (use `demo-*` for emulators) | `demo-local` |
| `AUTH_EMULATOR_HOST` | Firebase Auth emulator host:port | `127.0.0.1:9099` |
| `FIRESTORE_EMULATOR_HOST` | Firestore emulator host:port | `127.0.0.1:8080` |

## Running Tests

```powershell
# Cloud Function
cd functions && npm test

# Config Service
cd config-service && npm test

# Inference Server
cd inference-server
.\venv\Scripts\Activate.ps1   # source venv/bin/activate on Linux/macOS
pytest tests/
```

---

## API Reference

### Config Service — `http://127.0.0.1:3000`

#### `GET /v1/config/{user_id}`

Returns a LoRA style configuration for the given user. Results are cached per user for 60 seconds.

**Response `200 OK`:**
```json
{
  "lora_url": "https://huggingface.co/vislupus/SD1.5-LoRA-Loving-Vincent-Style/resolve/main/vg_style_v1-000048.safetensors",
  "lora_weight": 0.9,
  "updated_at": "2026-04-28T10:00:00.000Z"
}
```

**Response `404 Not Found`** — no configuration available for that user.

---

### Inference Server — `http://127.0.0.1:8000`

All endpoints require the header:
```
Authorization: Bearer <API_KEY>
```

#### `POST /generate`

Generates an image from a text prompt with an optional LoRA adapter. Updates the Firestore document status throughout the lifecycle (`PROCESSING` → `DONE` / `FAILED`).

**Request body:**
```json
{
  "doc_id": "firestore-document-id",
  "prompt": "a forest cabin in winter, oil painting style",
  "lora_url": "https://example.com/lora.safetensors",
  "lora_weight": 0.8
}
```

`lora_url` and `lora_weight` are optional. If omitted, the base model runs without a LoRA adapter.

**Response `200 OK`:**
```json
{
  "image": "<base64-encoded-PNG>"
}
```

The generated image is also saved to `inference-server/outputs/{doc_id}.png`.

**Error responses:**

| Status | Reason |
|---|---|
| `401 Unauthorized` | Missing or invalid `Authorization` header |
| `500 Internal Server Error` | Generation failed; Firestore doc updated to `FAILED` with an `error` field |

---

## Status Lifecycle

| Status | Set by |
|---|---|
| `CREATED` | Publisher Client |
| `QUEUED` | Cloud Function |
| `PROCESSING` | Inference Server |
| `DONE` / `FAILED` | Inference Server |

## Project Structure

```
.
├── config-service/     # Express — GET /v1/config/:user_id
├── functions/          # Firebase Cloud Function (v2) — onDocumentCreated
├── inference-server/   # FastAPI — POST /generate
├── publisher/          # One-shot script — writes requests to Firestore
├── firestore.rules     # Firestore security rules
├── firebase.json       # Firebase emulator config
├── setup.ps1           # Install all dependencies
└── start.ps1           # Run tests then start all services
```
