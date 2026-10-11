// Every JSON API response uses the same shape:
// { success: true, message, data, meta? }  or  { success: false, message, errors? }

function ok(res, data = null, message = 'OK', meta = undefined) {
  return res.status(200).json({ success: true, message, data, ...(meta && { meta }) });
}

function created(res, data = null, message = 'Created') {
  return res.status(201).json({ success: true, message, data });
}

module.exports = { ok, created };
