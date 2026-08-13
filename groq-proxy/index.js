export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = `https://api.groq.com${url.pathname}${url.search}`;

    const headers = new Headers(request.headers);
    for (const h of [
      'host',
      'content-length',
      'cf-connecting-ip',
      'cf-ray',
      'cf-visitor',
      'cf-ipcountry',
      'cf-worker',
      'x-forwarded-for',
      'x-real-ip',
    ]) {
      headers.delete(h);
    }

    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await request.arrayBuffer();
    if (body !== undefined) {
      headers.set('Content-Length', String(body.byteLength));
    }

    return fetch(target, {
      method: request.method,
      headers,
      body,
      redirect: 'follow',
    });
  },
};
