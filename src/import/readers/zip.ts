// Small helpers for zip-based formats (PPTX, EPUB).

import type JSZip from 'jszip';

export type Zip = JSZip;

export async function loadZip(data: ArrayBuffer): Promise<Zip> {
  const JSZipCtor = (await import('jszip')).default;
  return JSZipCtor.loadAsync(data);
}

export function parseXml(xml: string, type: DOMParserSupportedType = 'application/xml'): Document {
  const doc = new DOMParser().parseFromString(xml, type);
  if (doc.getElementsByTagName('parsererror').length && type !== 'text/html') {
    // Some EPUB chapters are sloppy XHTML; HTML parsing is forgiving.
    return new DOMParser().parseFromString(xml, 'text/html');
  }
  return doc;
}

/** "ppt/slides/slide1.xml" + "../slideLayouts/x.xml" → "ppt/slideLayouts/x.xml" */
export function resolvePath(from: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = from.split('/');
  parts.pop();
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/** Relationship id → resolved target path, from the part's _rels file. */
export async function relsOf(zip: Zip, partPath: string, optional = false): Promise<Map<string, string>> {
  const dir = partPath.split('/').slice(0, -1).join('/');
  const name = partPath.split('/').pop();
  const relsPath = `${dir ? `${dir}/` : ''}_rels/${name}.rels`;
  const f = zip.file(relsPath);
  const out = new Map<string, string>();
  if (!f) {
    if (optional) return out;
    throw new Error(`Missing ${relsPath}`);
  }
  const doc = parseXml(await f.async('string'));
  for (const r of Array.from(doc.getElementsByTagNameNS('*', 'Relationship'))) {
    if (r.getAttribute('TargetMode') === 'External') continue;
    out.set(r.getAttribute('Id') ?? '', resolvePath(partPath, r.getAttribute('Target') ?? ''));
  }
  return out;
}
