// Main Worker entry point with route dispatch
import { handleAuth } from './routes/auth.js';
import { handleProxies } from './routes/proxies.js';
import { handleChainedProxies } from './routes/chained-proxies.js';
import { handlePaidSubs } from './routes/paid-subs.js';
import { handleTemplates } from './routes/templates.js';
import { handleCustomRules } from './routes/custom-rules.js';
import { handleProfiles } from './routes/profiles.js';
import { handlePublic } from './routes/public.js';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function addCorsHeaders(response) {
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders())) {
    newHeaders.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      let response;
      
      if (path.startsWith('/api/auth')) {
        response = await handleAuth(request, env, path);
      } else if (path.startsWith('/api/proxies')) {
        response = await handleProxies(request, env, path);
      } else if (path.startsWith('/api/chained-proxies')) {
        response = await handleChainedProxies(request, env, path);
      } else if (path.startsWith('/api/paid-subs')) {
        response = await handlePaidSubs(request, env, path);
      } else if (path.startsWith('/api/templates')) {
        response = await handleTemplates(request, env, path);
      } else if (path.startsWith('/api/custom-rules')) {
        response = await handleCustomRules(request, env, path);
      } else if (path.startsWith('/api/profiles')) {
        response = await handleProfiles(request, env, path);
      } else if (path === '/subscribes' || path === '/profiles') {
        response = await handlePublic(request, env, path);
      } else if (path === '/' || path === '/health') {
        response = new Response(JSON.stringify({
          service: 'mihomo-sub-manager',
          status: 'ok',
          version: '1.0.0',
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        response = new Response('Not Found', { status: 404 });
      }
      
      return addCorsHeaders(response);
    } catch (err) {
      console.error('Unhandled error:', err);
      return new Response(JSON.stringify({
        error: 'Internal server error',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }
  },
};
