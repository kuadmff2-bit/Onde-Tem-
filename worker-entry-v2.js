import enhancedApi from './worker-entry.js';
import baseApp from './worker.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API, mídia e todas as rotas de sistema continuam usando o backend completo.
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) {
      return enhancedApi.fetch(request, env);
    }

    // Arquivos públicos são servidos diretamente. As melhorias visuais/JS
    // agora são referenciadas pela própria página, evitando injeção duplicada
    // e problemas de cache em navegadores móveis.
    const response = await baseApp.fetch(request, env);
    const headers = new Headers(response.headers);
    headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(self)');

    if ((headers.get('content-type') || '').includes('text/html')) {
      headers.set('cache-control', 'no-cache, no-store, must-revalidate');
      headers.set('pragma', 'no-cache');
      headers.set('expires', '0');
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};
