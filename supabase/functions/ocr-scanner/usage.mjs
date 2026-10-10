export function createTrackedFetch(db, userId, requestId, fetchImpl = fetch) {
  return async (provider, model, url, options) => {
    let outcome = 'error', input = null, output = null;
    try {
      const response = await fetchImpl(url, options);
      const result = await response.json();
      outcome = response.ok && !result.responses?.[0]?.error ? 'success' : 'error';
      if (provider === 'gemini' && result.usageMetadata) {
        input = result.usageMetadata.promptTokenCount ?? null;
        output = (result.usageMetadata.candidatesTokenCount ?? 0) + (result.usageMetadata.thoughtsTokenCount ?? 0);
      } else if (provider === 'vision' && outcome === 'success') { input = 0; output = 0; }
      return result;
    } finally {
      try {
        const { error } = await db.rpc('record_api_usage', { p_user: userId, p_request: requestId, p_provider: provider, p_model: model, p_outcome: outcome, p_input: input, p_output: output, p_units: provider === 'vision' ? 1 : 0 });
        if (error) console.error('Usage recording failed:', error.code);
      } catch { console.error('Usage recording unavailable'); }
    }
  };
}
