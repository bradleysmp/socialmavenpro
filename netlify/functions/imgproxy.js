exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
      body: '',
    };
  }

  const imageUrl = event.queryStringParameters?.url;
  if (!imageUrl) return { statusCode: 400, body: 'Missing url parameter' };

  // Only allow Facebook CDN domains
  const allowed = ['fbcdn.net', 'facebook.com', 'fbsbx.com'];
  const isAllowed = allowed.some(domain => imageUrl.includes(domain));
  if (!isAllowed) return { statusCode: 403, body: 'Domain not allowed' };

  try {
    const response = await fetch(imageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    if (!response.ok) {
      return { statusCode: response.status, body: 'Image fetch failed' };
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
      body: base64,
      isBase64Encoded: true,
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
