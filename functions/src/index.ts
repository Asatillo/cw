import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onDocumentCreated } from "firebase-functions/v2/firestore";

initializeApp();
const db = getFirestore();

const INFERENCE_SERVER_URL = process.env["INFERENCE_SERVER_URL"] ?? "http://127.0.0.1:8000";
const CONFIG_SERVICE_URL = process.env["CONFIG_SERVICE_URL"] ?? "http://127.0.0.1:3000";
const API_KEY = process.env["API_KEY"] ?? "";

const CONFIG_CACHE_TTL_MS = 60_000;

interface LoraConfig {
  lora_url: string;
  lora_weight: number;
  updated_at: string;
  expiresAt: number;
}

const configCache = new Map<string, LoraConfig>();

async function getUserConfig(
  userId: string
): Promise<Pick<LoraConfig, "lora_url" | "lora_weight"> | null> {
  const now = Date.now();
  const cached = configCache.get(userId);
  if (cached && cached.expiresAt > now) {
    return { lora_url: cached.lora_url, lora_weight: cached.lora_weight };
  }

  try {
    const res = await fetch(`${CONFIG_SERVICE_URL}/v1/config/${userId}`, {
      signal: AbortSignal.timeout(5_000),
    });

    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Config service returned ${res.status}`);

    const data = (await res.json()) as LoraConfig;
    configCache.set(userId, { ...data, expiresAt: now + CONFIG_CACHE_TTL_MS });
    return { lora_url: data.lora_url, lora_weight: data.lora_weight };
  } catch (err) {
    console.error("Failed to fetch user config:", err);
    return null;
  }
}

export const onGenerationRequestCreated = onDocumentCreated(
  {
    document: "generation_requests/{docId}",
    timeoutSeconds: 540,
  },
  async (event) => {
    const docId = event.params["docId"] as string;
    const docRef = db.collection("generation_requests").doc(docId);
    const data = event.data?.data();

    if (!data) {
      console.error(`No data for document ${docId}`);
      return;
    }

    const { user_id, prompt } = data as { user_id: string; prompt: string };

    await docRef.update({ status: "QUEUED" });

    const userConfig = await getUserConfig(user_id);

    const inferenceBody: Record<string, unknown> = { doc_id: docId, prompt };
    if (userConfig?.lora_url) {
      inferenceBody["lora_url"] = userConfig.lora_url;
      inferenceBody["lora_weight"] = userConfig.lora_weight;
    }

    try {
      const res = await fetch(`${INFERENCE_SERVER_URL}/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify(inferenceBody),
        signal: AbortSignal.timeout(300_000), // 5 min for generation
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Inference server error ${res.status}: ${errorText}`);
      }

      console.log(`Generation completed for doc ${docId}`);
    } catch (err) {
      console.error(`Inference failed for doc ${docId}:`, err);
      await docRef.update({
        status: "FAILED",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
);