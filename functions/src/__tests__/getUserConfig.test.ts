import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: vi.fn(() => ({})) }));
vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: vi.fn(() => vi.fn()),
}));

import { getUserConfig, configCache } from '../index.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const MOCK_CONFIG = {
  lora_url: 'https://example.com/lora.safetensors',
  lora_weight: 0.8,
  updated_at: '2026-01-01T00:00:00Z',
};

function okResponse(body: object) {
  return { ok: true, status: 200, json: async () => body };
}

describe('getUserConfig', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    configCache.clear();
  });

  it('fetches and returns config on cache miss', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(MOCK_CONFIG));

    const result = await getUserConfig('user-1');

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(result).toEqual({
      lora_url: MOCK_CONFIG.lora_url,
      lora_weight: MOCK_CONFIG.lora_weight,
    });
  });

  it('returns cached value without fetching on cache hit', async () => {
    mockFetch.mockResolvedValue(okResponse(MOCK_CONFIG));

    await getUserConfig('user-2');
    const result = await getUserConfig('user-2');

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(result).toEqual({
      lora_url: MOCK_CONFIG.lora_url,
      lora_weight: MOCK_CONFIG.lora_weight,
    });
  });

  it('returns null on 404', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await getUserConfig('user-404');

    expect(result).toBeNull();
  });

  it('returns null and does not throw on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    const result = await getUserConfig('user-error');

    expect(result).toBeNull();
  });

  it('re-fetches after TTL expires', async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue(okResponse(MOCK_CONFIG));

    await getUserConfig('user-ttl');
    vi.advanceTimersByTime(61_000); // past the 60s TTL
    await getUserConfig('user-ttl');

    expect(mockFetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});