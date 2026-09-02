import app from './worker-entry-v2.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const response = await app.fetch(request, env);

    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) {
      return response;
    }

    const headers = new Headers(response.headers);
    const currentCsp = headers.get('content-security-policy');
    if (currentCsp) {
      headers.set(
        'content-security-policy',
        currentCsp.replace("connect-src 'self'", "connect-src 'self' https://api.bigdatacloud.net")
      );
    }

    if ((headers.get('content-type') || '').includes('text/html')) {
      headers.set('cache-control', 'no-cache, no-store, must-revalidate');
      const htmlResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });

      return new HTMLRewriter()
        .on('body', {
          element(element) {
            element.append('<script src="/location-city.js?v=20260902-2" defer></script>', { html: true });
          }
        })
        .transform(htmlResponse);
    }

    if (url.pathname === '/location-city.js') {
      headers.set('cache-control', 'no-cache, no-store, must-revalidate');
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};
