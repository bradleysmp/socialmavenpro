exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { api_key, connector, date_preset, fields, account_id, options } = JSON.parse(event.body);

    const params = new URLSearchParams();
    params.append('api_key', api_key);
    params.append('fields', fields);
    if (date_preset) params.append('date_preset', date_preset);

    if (account_id) {
      params.append('filter', JSON.stringify([['account_id', 'eq', account_id]]));
    }

    // Forward connector-specific options e.g. attribution_window, conversion_report_time
    if (options && typeof options === 'object') {
      Object.entries(options).forEach(([k, v]) => params.append(k, v));
    }

    const url = `https://connectors.windsor.ai/${connector}?${params}`;

    const response = await fetch(url);

    if (!response.ok) {
      const text = await response.text();
      return {
        statusCode: response.status,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: `Windsor returned ${response.status}`, detail: text }),
      };
    }

    const data = await response.json();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
