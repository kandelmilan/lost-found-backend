const { cloudinaryDriver, cloudinarySignature } = require('../src/services/storage.service');

describe('Cloudinary storage driver', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('signs parameters the way Cloudinary documents', () => {
    // Example from https://cloudinary.com/documentation/authentication_signatures
    const params = { eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop', public_id: 'sample_image', timestamp: 1315060510 };
    expect(cloudinarySignature(params, 'abcd')).toBe('bfd09f95f331f558cbd1320e67aa8d488770583e');
  });

  it('uploads into the folder and returns the public id + https url', async () => {
    let sent;
    global.fetch = jest.fn(async (url, options) => {
      sent = { url, form: options.body };
      return { ok: true, json: async () => ({ public_id: 'lost-found/items/abc', secure_url: 'https://res.cloudinary.com/demo/abc.webp' }) };
    });
    const driver = cloudinaryDriver({ cloudName: 'demo', apiKey: 'key', apiSecret: 'secret', folder: 'lost-found' });

    const result = await driver.save('items', Buffer.from('fake'));

    expect(result).toEqual({ key: 'lost-found/items/abc', url: 'https://res.cloudinary.com/demo/abc.webp' });
    expect(sent.url).toBe('https://api.cloudinary.com/v1_1/demo/image/upload');
    expect(sent.form.get('folder')).toBe('lost-found/items');
    expect(sent.form.get('api_key')).toBe('key');
    const params = { folder: 'lost-found/items', public_id: sent.form.get('public_id'), timestamp: sent.form.get('timestamp') };
    expect(sent.form.get('signature')).toBe(cloudinarySignature(params, 'secret'));
    expect(sent.form.get('file')).toBeInstanceOf(Blob);
  });

  it('turns a Cloudinary failure into a friendly 502', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Invalid Signature' } }) }));
    const driver = cloudinaryDriver({ cloudName: 'demo', apiKey: 'key', apiSecret: 'wrong', folder: 'lost-found' });
    await expect(driver.save('items', Buffer.from('fake'))).rejects.toMatchObject({ statusCode: 502 });
  });

  it('deletes by public id', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ result: 'ok' }) }));
    const driver = cloudinaryDriver({ cloudName: 'demo', apiKey: 'key', apiSecret: 'secret', folder: 'lost-found' });
    await driver.remove('lost-found/items/abc');
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.cloudinary.com/v1_1/demo/image/destroy');
    expect(options.body.get('public_id')).toBe('lost-found/items/abc');
  });
});
