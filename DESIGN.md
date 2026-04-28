# DESIGN.md

## Architecture Overview

The system is a four-component pipeline. A **Publisher Client** authenticates anonymously and writes a generation request to **Firestore**. A **Cloud Function** triggers on every new document, marks it `QUEUED`, fetches the user's LoRA style config from the **Config Service**, then calls the **Inference Server** with the resolved settings. The inference server runs the diffusion model, updates the document status throughout (`PROCESSING` → `DONE` / `FAILED`), and returns the generated image as base64.

Everything is connected through Firestore as the source of truth for job state. No job state lives exclusively in memory.

---

## Technical Decisions

**Config cache in the Cloud Function (TTL 60s)**
The spec notes that the Config Service can add significant latency per request. Rather than calling it on every generation, the Cloud Function caches the result per user for 60 seconds in a module-level Map. This is a deliberate trade-off: a user's style might be slightly stale for up to a minute, but generation jobs don't block on a slow config lookup. For this local setup an in-memory Map is fine; in production this would move to Redis or Firestore itself so the cache survives function restarts.

**LoRA disk cache on the inference server**
LoRA files are 50–200 MB and downloading one per request would dominate latency. The server hashes the URL, saves the file to `lora_cache/`, and skips the download on cache hits. The currently-loaded LoRA is also kept on the pipeline to avoid repeated `load_lora_weights` calls.

**Synchronous Cloud Function → Inference Server call**
Simple and easy to reason about. The function timeout is set to 540 seconds to accommodate slow CPU inference. The trade-off is that each concurrent generation ties up one Cloud Function execution for the full duration — which is the main bottleneck at scale.

**Anonymous Firebase Auth + Firestore security rules**
Authentication is required before any write. The security rules enforce that `user_id` matches the authenticated UID and that the initial status is exactly `CREATED`. This means even a misbehaving client can't forge ownership or skip the lifecycle.

**Bearer token between Cloud Function and Inference Server**
Simple shared-secret auth. The token is set via environment variable and never hardcoded. Straightforward for a single-server setup; in production this would be replaced with a service account and IAM-based identity verification.

---

## GCP Deployment

| Service | Deployment target | Notes |
|---|---|---|
| Publisher Client | Local / Cloud Run Job | One-shot script; run as a Job for automation |
| Cloud Function | Cloud Functions v2 | Already structured for it; set min-instances=1 to avoid cold starts |
| Config Service | Cloud Run | Stateless, scales to zero; mount secrets via Secret Manager |
| Inference Server | Cloud Run with GPU (T4) or Vertex AI Prediction | GPU is essential for production throughput; containerise with CUDA image |

Firestore and Firebase Auth are managed services — no deployment needed beyond project setup.

---

## Reliability & Failure Handling

If the inference server returns an error or times out, the Cloud Function catches the exception and sets the document to `FAILED` with an error message. This prevents jobs from getting permanently stuck in `QUEUED`. The inference server also catches generation errors internally and sets `FAILED` before re-raising, so Firestore is always updated even if the HTTP response fails.

---

## Scaling & Future-Proofing

### 10x Traffic

The current design has a clear bottleneck: one inference server handles one request at a time (global pipeline state), and 100 simultaneous Cloud Function executions would all queue behind it, most timing out.

The fix is to decouple submission from processing with a queue. Cloud Functions write to a **Pub/Sub topic** instead of calling the inference server directly. A pool of inference workers each pull from the queue, process one job at a time, and update Firestore. Scaling becomes a matter of adding more worker instances. Cloud Run's concurrency controls make this straightforward — each worker container runs one job and signals Pub/Sub on completion. This also makes retries safe and observable.

### Frequent Config Updates

The current 60-second TTL cache means a config change takes up to a minute to propagate. If updates need to apply immediately, the Config Service can publish an invalidation event (via Pub/Sub or a Firestore write) and the Cloud Function subscribes to flush the relevant cache entry. Alternatively, shorten the TTL at the cost of more Config Service calls. If the Config Service itself becomes a latency bottleneck, caching in Firestore (as a document) gives durability and lets all function instances share the same cache.

---

## Additional Questions

**1. Synchronous architecture under load**

If 100 users submit simultaneously, 100 Cloud Function instances spawn and all try to POST to the inference server at once. The server processes one request at a time, so 99 of them either queue up and timeout, or get rejected. The function's 540-second timeout is not enough if each generation takes 2–3 minutes and requests are serialised.

Redesign: treat the Cloud Function as a dispatcher only. It writes the job to a Pub/Sub queue and returns immediately. A separate pool of inference workers consumes the queue at its own pace. Each worker signals completion by updating Firestore. This decouples ingestion rate from processing rate entirely.

**2. Idempotency on retry**

The risk is double-generation: if the Cloud Function retries after a timeout, the inference server might start processing the same `doc_id` again while the original is still running (or already done), wasting compute and potentially overwriting a completed image.

The fix is to make `/generate` idempotent on `doc_id`. At the start of the endpoint, read the document's current status. If it's already `DONE`, return the existing result immediately. If it's `PROCESSING`, check a `processing_started_at` timestamp — if it's recent, reject the duplicate with 409. Only proceed if the status is `QUEUED` or if `PROCESSING` is clearly stale. Firestore transactions make the check-and-set atomic.

**3. Stuck in PROCESSING**

Add a `processing_started_at` server timestamp when the status changes to `PROCESSING`. A **Cloud Scheduler** job runs every few minutes and queries Firestore for documents in `PROCESSING` where `processing_started_at` is older than a defined threshold (e.g. 10 minutes). For each stale document it resets the status to `QUEUED` (or `FAILED` after N retries) so the pipeline picks it up again. No human intervention needed — the scheduler acts as a watchdog.

**4. Per-user LoRA at scale**

With thousands of users and files up to 200 MB each, the inference server can't cache everything in memory or on a single disk. A few strategies layered together:

- **LRU disk eviction**: keep a bounded local cache (e.g. 10 GB), evict least-recently-used LoRAs when full. Downloads from GCS are fast within the same region.
- **Sticky routing**: route requests for the same user to the same worker instance where possible (consistent hashing on `user_id`). This maximises cache hit rate without shared storage.
- **Pre-warm on training completion**: when the training service finishes a LoRA, publish an event. Workers that are likely to serve that user can pre-fetch the file before the first request arrives.
- **GCS + regional buckets**: store LoRAs in the same GCP region as the inference workers to minimise download latency. Use signed URLs with short expiry for secure access.
- **Cost**: egress from GCS within the same region is free. The main cost driver is GPU time per generation, not storage or transfer. Keeping the disk cache warm is cheap relative to idle GPU time.