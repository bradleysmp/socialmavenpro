exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { api_key, connector, date_preset, fields, account_id } = JSON.parse(event.body);

    const params = new URLSearchParams({
      api_key,
      connector,
      fields,
      account_id,
    });

    if (date_preset) params.append('date_preset', date_preset);

    const response = await fetch(`https://connectors.windsor.ai/?${params}`);
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
      body: JSON.stringify({ error: err.message }),
    };
  }
};
