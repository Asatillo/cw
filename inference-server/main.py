import os
import base64
import hashlib
import logging
from io import BytesIO
from pathlib import Path

import requests
import torch
from diffusers import DiffusionPipeline, LCMScheduler
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from firebase_admin import credentials as fb_credentials
from google.oauth2.credentials import Credentials as GoogleCredentials
import firebase_admin
from firebase_admin import firestore

load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

API_KEY = os.environ["API_KEY"]
FIRESTORE_EMULATOR_HOST = os.getenv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080")
FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "demo-local")

os.environ["FIRESTORE_EMULATOR_HOST"] = FIRESTORE_EMULATOR_HOST

class _EmulatorCredential(fb_credentials.Base):
    """Stub credential for local emulator"""
    def get_credential(self) -> GoogleCredentials:
        return GoogleCredentials(token="emulator")

firebase_admin.initialize_app(
    _EmulatorCredential(),
    {"projectId": FIREBASE_PROJECT_ID}
)
db = firestore.client()

app = FastAPI()

OUTPUTS_DIR = Path("outputs")
OUTPUTS_DIR.mkdir(exist_ok=True)

LORA_CACHE_DIR = Path("lora_cache")
LORA_CACHE_DIR.mkdir(exist_ok=True)

pipeline: DiffusionPipeline | None = None
current_lora_url: str | None = None
current_lora_weight: float = 0.8


def get_pipeline(lora_url: str | None = None, lora_weight: float = 0.8) -> DiffusionPipeline:
    global pipeline, current_lora_url

    if pipeline is None:
        logger.info("Loading base model SimianLuo/LCM_Dreamshaper_v7...")
        pipeline = DiffusionPipeline.from_pretrained(
            "SimianLuo/LCM_Dreamshaper_v7",
            torch_dtype=torch.float32,
        )
        pipeline.scheduler = LCMScheduler.from_config(pipeline.scheduler.config)
        pipeline = pipeline.to("cpu")

    if lora_url and lora_url != current_lora_url:
        lora_path = download_lora(lora_url)
        logger.info(f"Loading LoRA from {lora_path}")
        if current_lora_url is not None:
            pipeline.unload_lora_weights()
        try:
            pipeline.load_lora_weights(str(lora_path), low_cpu_mem_usage=False)
            current_lora_url = lora_url
            current_lora_weight = lora_weight
        except Exception as e:
            logger.warning(f"Failed to load LoRA, proceeding without it: {e}")
            current_lora_url = None
            current_lora_weight = 0.8
    elif not lora_url and current_lora_url is not None:
        pipeline.unload_lora_weights()
        current_lora_url = None

    return pipeline


def download_lora(url: str) -> Path:
    url_hash = hashlib.sha256(url.encode()).hexdigest()[:16]
    filename = url.split("/")[-1]
    cache_path = LORA_CACHE_DIR / f"{url_hash}_{filename}"

    if cache_path.exists():
        logger.info(f"LoRA cache hit: {cache_path}")
        return cache_path

    logger.info(f"Downloading LoRA from {url}")
    response = requests.get(url, timeout=120, stream=True)
    response.raise_for_status()
    with open(cache_path, "wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            f.write(chunk)

    return cache_path


class GenerateRequest(BaseModel):
    doc_id: str
    prompt: str
    lora_url: str | None = None
    lora_weight: float = 0.8


@app.post("/generate")
async def generate(request: Request, body: GenerateRequest) -> JSONResponse:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer ") or auth_header[len("Bearer "):] != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")

    doc_ref = db.collection("generation_requests").document(body.doc_id)
    doc_ref.update({"status": "PROCESSING"})

    try:
        pipe = get_pipeline(body.lora_url, body.lora_weight)

        logger.info(f"Generating image for doc {body.doc_id}: '{body.prompt}'")
        result = pipe(
            prompt=body.prompt,
            num_inference_steps=4,
            guidance_scale=8.0,
            cross_attention_kwargs={"scale": current_lora_weight} if current_lora_url else {},
        )
        image = result.images[0]

        output_path = OUTPUTS_DIR / f"{body.doc_id}.png"
        image.save(output_path)

        buffer = BytesIO()
        image.save(buffer, format="PNG")
        image_b64 = base64.b64encode(buffer.getvalue()).decode("utf-8")

        doc_ref.update({"status": "DONE"})
        logger.info(f"Done: {output_path}")

        return JSONResponse({"image": image_b64})

    except Exception as e:
        logger.error(f"Generation failed for doc {body.doc_id}: {e}")
        doc_ref.update({"status": "FAILED", "error": str(e)})
        raise HTTPException(status_code=500, detail=str(e))