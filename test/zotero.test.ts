import { describe, expect, it } from 'vitest';
import { ZoteroClient, ZoteroError } from '../src/zotero/client';

/** A tiny stand-in for api.zotero.org (recorded shapes, made-up content). */
function fakeZotero(validKey = 'k1') {
  const calls: string[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    if (new Headers(init?.headers).get('Zotero-API-Key') !== validKey) return json({}, 403);
    if (url.pathname === '/keys/current') return json({ userID: 4242, username: 'rob', access: { user: { library: true, files: true } } });
    if (url.pathname === '/users/4242/collections') return json([{ key: 'C1', data: { name: 'ECON 1000', parentCollection: false } }]);
    if (url.pathname.endsWith('/items/top'))
      return json([
        {
          key: 'I1',
          meta: { numChildren: 1, parsedDate: '2021-03-01' },
          data: { itemType: 'journalArticle', title: 'Opportunity Cost Revisited', creators: [{ firstName: 'Greg', lastName: 'Mankiw' }, { name: 'World Bank' }], publicationTitle: 'J. Econ' },
        },
      ]);
    if (url.pathname === '/users/4242/items/I1/children')
      return json([
        { key: 'A1', data: { itemType: 'attachment', contentType: 'application/pdf', filename: 'mankiw2021.pdf', linkMode: 'imported_file' } },
        { key: 'A2', data: { itemType: 'attachment', contentType: 'text/html', title: 'Snapshot', linkMode: 'linked_url' } },
        { key: 'N1', data: { itemType: 'note' } },
      ]);
    if (url.pathname === '/users/4242/items/A1/file') return new Response(new Uint8Array([37, 80, 68, 70]), { headers: { 'Content-Type': 'application/pdf' } });
    return json({}, 404);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('Zotero client', () => {
  it('connects with just the API key and finds the user', async () => {
    const z = fakeZotero();
    expect(await ZoteroClient.connect(' k1 ', z.fetchImpl)).toEqual({ apiKey: 'k1', userId: '4242', username: 'rob' });
    await expect(ZoteroClient.connect('wrong', z.fetchImpl)).rejects.toThrow(ZoteroError);
  });

  it('lists collections and items with authors and year, and finds the stored PDF', async () => {
    const z = fakeZotero();
    const client = new ZoteroClient({ apiKey: 'k1', userId: '4242' }, z.fetchImpl);
    expect(await client.collections()).toEqual([{ key: 'C1', name: 'ECON 1000', parent: undefined }]);
    const [item] = await client.items({ collection: 'C1', q: 'opportunity' });
    expect(item).toMatchObject({ key: 'I1', title: 'Opportunity Cost Revisited', authors: 'Greg Mankiw, World Bank', year: '2021', hasChildren: true });
    expect(z.calls.some((c) => c.startsWith('/users/4242/collections/C1/items/top') && c.includes('q=opportunity'))).toBe(true);
    const atts = await client.attachments('I1');
    expect(atts.map((a) => [a.key, a.downloadable])).toEqual([
      ['A1', true],
      ['A2', false],
    ]);
    const file = await client.download(atts[0]);
    expect([file.name, file.type, file.size]).toEqual(['mankiw2021.pdf', 'application/pdf', 4]);
  });
});
