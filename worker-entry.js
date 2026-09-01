import app from './worker.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/admin/pending' && request.method === 'GET') {
      const authResponse = await app.fetch(request, env);
      if (!authResponse.ok) return authResponse;

      const [listings, businesses, recoveries] = await Promise.all([
        env.DB.prepare(`
          SELECT
            l.id,
            l.title,
            l.category,
            l.price,
            l.condition_text AS condition,
            l.city,
            l.description,
            l.image_url,
            l.created_at,
            u.name AS owner,
            u.phone AS owner_phone
          FROM listings l
          JOIN users u ON u.id = l.user_id
          WHERE l.status = 'pending'
          ORDER BY l.created_at
        `).all(),
        env.DB.prepare(`
          SELECT
            b.id,
            b.kind,
            b.name,
            b.category,
            b.city,
            b.address,
            b.hours,
            b.description,
            b.image_url,
            b.created_at,
            u.name AS owner,
            u.phone AS owner_phone
          FROM businesses b
          JOIN users u ON u.id = b.user_id
          WHERE b.status = 'pending'
          ORDER BY b.created_at
        `).all(),
        env.DB.prepare(`
          SELECT rr.id, rr.created_at, u.name, u.phone
          FROM recovery_requests rr
          JOIN users u ON u.id = rr.user_id
          WHERE rr.status = 'pending'
          ORDER BY rr.created_at
        `).all()
      ]);

      const headers = new Headers(authResponse.headers);
      headers.set('content-type', 'application/json; charset=utf-8');
      headers.set('cache-control', 'no-store');

      return new Response(JSON.stringify({
        listings: listings.results,
        businesses: businesses.results,
        recoveries: recoveries.results
      }), { status: 200, headers });
    }

    return app.fetch(request, env);
  }
};
