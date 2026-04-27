import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app, cache } from '../index';

const PREDEFINED_LORA_URLS = [
  'https://huggingface.co/vislupus/SD1.5-LoRA-Your-Name-Style/resolve/main/yn_style_v1-000039.safetensors',
  'https://huggingface.co/vislupus/SD1.5-LoRA-Loving-Vincent-Style/resolve/main/vg_style_v1-000048.safetensors',
  'https://huggingface.co/vislupus/SD1.5-LoRA-Wolfwalkers-Style/resolve/main/ww_style_final_v1-000046.safetensors',
  'https://huggingface.co/ampp/N64_style_sd1.5/resolve/main/N64%20Lowpoly.safetensors',
];

describe('GET /v1/config/:user_id', () => {
  beforeEach(() => {
    cache.clear();
  });

  it('returns 200 with correct schema', async () => {
    const res = await request(app).get('/v1/config/user-123');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      lora_url: expect.any(String),
      lora_weight: expect.any(Number),
      updated_at: expect.any(String),
    });
  });

  it('lora_url is from the predefined list', async () => {
    const res = await request(app).get('/v1/config/user-123');
    expect(PREDEFINED_LORA_URLS).toContain(res.body.lora_url);
  });

  it('lora_weight is a positive number not exceeding 1', async () => {
    const res = await request(app).get('/v1/config/user-123');
    expect(res.body.lora_weight).toBeGreaterThan(0);
    expect(res.body.lora_weight).toBeLessThanOrEqual(1);
  });

  it('returns the same config for the same user within TTL', async () => {
    const res1 = await request(app).get('/v1/config/user-cache');
    const res2 = await request(app).get('/v1/config/user-cache');
    expect(res1.body).toEqual(res2.body);
  });

  it('different users have independent cached entries', async () => {
    await request(app).get('/v1/config/user-a');
    await request(app).get('/v1/config/user-b');
    expect(cache.has('user-a')).toBe(true);
    expect(cache.has('user-b')).toBe(true);
  });
});