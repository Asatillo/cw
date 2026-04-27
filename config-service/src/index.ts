import express, { Request, Response } from "express";

export const app = express();
const PORT = process.env.PORT ?? 3000;

const LORA_CONFIGS = [
  {
    lora_url:
      "https://huggingface.co/vislupus/SD1.5-LoRA-Your-Name-Style/resolve/main/yn_style_v1-000039.safetensors",
    lora_weight: 0.8,
  },
  {
    lora_url:
      "https://huggingface.co/vislupus/SD1.5-LoRA-Loving-Vincent-Style/resolve/main/vg_style_v1-000048.safetensors",
    lora_weight: 0.9,
  },
  {
    lora_url:
      "https://huggingface.co/vislupus/SD1.5-LoRA-Wolfwalkers-Style/resolve/main/ww_style_final_v1-000046.safetensors",
    lora_weight: 0.7,
  },
  {
    lora_url:
      "https://huggingface.co/ampp/N64_style_sd1.5/resolve/main/N64%20Lowpoly.safetensors",
    lora_weight: 0.8,
  },
];

const CACHE_TTL_MS = 60_000; // 60 seconds

interface CacheEntry {
  value: (typeof LORA_CONFIGS)[number] & { updated_at: string };
  expiresAt: number;
}

export const cache = new Map<string, CacheEntry>();

app.get("/v1/config/:user_id", (req: Request, res: Response) => {
  const user_id = req.params["user_id"] as string;

  const now = Date.now();
  const cached = cache.get(user_id);
  if (cached && cached.expiresAt > now) {
    res.json(cached.value);
    return;
  }

  const randomIndex = Math.floor(Math.random() * LORA_CONFIGS.length);
  const config = LORA_CONFIGS[randomIndex];

  if (!config) {
    res.status(404).json({ error: "No config available" });
    return;
  }

  const entry = {
    ...config,
    updated_at: new Date().toISOString(),
  };

  cache.set(user_id, { value: entry, expiresAt: now + CACHE_TTL_MS });

  res.json(entry);
});

if (process.env['NODE_ENV'] !== 'test') {
  app.listen(PORT, () => {
    console.log(`Config service running on port ${PORT}`);
  });
}