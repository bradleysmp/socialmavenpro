// Resolves a thumbnail for TikTok Spark Ads, where the Ads API returns no
// video_thumbnail_url because the video belongs to the creator's account.
// Takes the TikTok post ID (Windsor field: item_id), looks up the post via
// TikTok's public oEmbed API, then fetches and returns the thumbnail image.
// The @_ username placeholder works because TikTok resolves posts by video ID.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

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

  const itemId = event.queryStringParameters?.item_id;
  if (!itemId || !/^\d{5,25}$/.test(itemId)) {
    return { statusCode: 400, body: 'Invalid item_id' };
  }

  try {
    const postUrl = `https://www.tiktok.com/@_/video/${itemId}`;
    const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(postUrl)}`;
    const oRes = await fetch(oembedUrl, { headers: { 'User-Agent': BROWSER_UA, 'Accept': 'application/json' } });
    if (!oRes.ok) return { statusCode: 404, body: 'oEmbed lookup failed' };

    const meta = await oRes.json();
    if (!meta.thumbnail_url) return { statusCode: 404, body: 'No thumbnail in oEmbed response' };

    const imgRes = await fetch(meta.thumbnail_url, { headers: { 'User-Agent': BROWSER_UA, 'Accept': 'image/*,*/*;q=0.8' } });
    if (!imgRes.ok) return { statusCode: imgRes.status, body: 'Thumbnail fetch failed' };

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    const buffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        // Post thumbnails are stable — cache aggressively at the CDN edge
        // so repeat dashboard loads don't re-hit TikTok.
        'Cache-Control': 'public, max-age=86400',
      },
      body: base64,
      isBase64Encoded: true,
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
