// Builds small but realistic test documents in memory (nothing binary is committed).

import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const xml = (s: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${s}`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// ---------- PPTX ----------

interface SlideSpec {
  title: string;
  body?: string[];
  notes?: string;
  layout?: 'title' | 'secHead' | 'obj';
}

export async function buildPptx(slides: SlideSpec[], sections?: { name: string; slides: number[] }[]): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const ids = slides.map((_, i) => 256 + i);
  const sectionXml = sections
    ? `<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">${sections
        .map((s) => `<p14:section name="${esc(s.name)}" id="{${s.name}}"><p14:sldIdLst>${s.slides.map((n) => `<p14:sldId id="${ids[n - 1]}"/>`).join('')}</p14:sldIdLst></p14:section>`)
        .join('')}</p14:sectionLst></p:ext></p:extLst>`
    : '';
  zip.file('ppt/presentation.xml', xml(`<p:presentation ${P}><p:sldIdLst>${ids.map((id, i) => `<p:sldId id="${id}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst>${sectionXml}</p:presentation>`));
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`),
  );
  for (const layout of ['title', 'secHead', 'obj']) {
    zip.file(`ppt/slideLayouts/${layout}.xml`, xml(`<p:sldLayout ${P} type="${layout}"/>`));
  }
  const sp = (type: string | null, paras: string[]) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="x"/><p:cNvSpPr/><p:nvPr>${type ? `<p:ph type="${type}"/>` : ''}</p:nvPr></p:nvSpPr><p:txBody>${paras.map((t) => `<a:p><a:r><a:t>${esc(t)}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;
  slides.forEach((s, i) => {
    const n = i + 1;
    const shapes = [
      sp(s.layout === 'title' ? 'ctrTitle' : 'title', [s.title]),
      s.body?.length ? sp('body', s.body) : '',
      sp(null, ['ECON 1000 – Fall 2026']), // footer typed in a text box on every slide
      sp('sldNum', [String(n)]),
    ].join('');
    zip.file(`ppt/slides/slide${n}.xml`, xml(`<p:sld ${P}><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`));
    const rels = [`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/${s.layout ?? 'obj'}.xml"/>`];
    if (s.notes) {
      rels.push(`<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${n}.xml"/>`);
      zip.file(`ppt/notesSlides/notesSlide${n}.xml`, xml(`<p:notes ${P}><p:cSld><p:spTree>${sp('sldImg', [])}${sp('body', [s.notes])}${sp('sldNum', [String(n)])}</p:spTree></p:cSld></p:notes>`));
    }
    zip.file(`ppt/slides/_rels/slide${n}.xml.rels`, xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`));
  });
  return zip.generateAsync({ type: 'arraybuffer' });
}

// ---------- DOCX ----------

export async function buildDocx(paragraphs: { style?: string; text: string; footnote?: string }[]): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  zip.file(
    '[Content_Types].xml',
    xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`),
  );
  zip.file('_rels/.rels', xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`));
  zip.file(
    'word/_rels/document.xml.rels',
    xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
  );
  const styles = ['Heading1', 'Heading2', 'Title'].map((id) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id.replace(/(\d)/, ' $1').toLowerCase()}"/></w:style>`).join('');
  zip.file('word/styles.xml', xml(`<w:styles ${W}>${styles}</w:styles>`));
  let fn = 0;
  const notes: string[] = [];
  const body = paragraphs
    .map((p) => {
      const style = p.style ? `<w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>` : '';
      let runs = `<w:r><w:t xml:space="preserve">${esc(p.text)}</w:t></w:r>`;
      if (p.footnote) {
        fn++;
        runs += `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="${fn}"/></w:r>`;
        notes.push(`<w:footnote w:id="${fn}"><w:p><w:r><w:t>${esc(p.footnote)}</w:t></w:r></w:p></w:footnote>`);
      }
      return `<w:p>${style}${runs}</w:p>`;
    })
    .join('');
  zip.file('word/document.xml', xml(`<w:document ${W}><w:body>${body}</w:body></w:document>`));
  zip.file('word/footnotes.xml', xml(`<w:footnotes ${W}><w:footnote w:type="separator" w:id="-1"><w:p/></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p/></w:footnote>${notes.join('')}</w:footnotes>`));
  return zip.generateAsync({ type: 'arraybuffer' });
}

// ---------- EPUB ----------

export async function buildEpub(title: string, chapters: { title: string; html: string }[]): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', xml(`<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`));
  const items = chapters.map((_, i) => `<item id="c${i}" href="text/ch${i}.xhtml" media-type="application/xhtml+xml"/>`).join('');
  zip.file(
    'OEBPS/content.opf',
    xml(`<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(title)}</dc:title></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml"/>${items}</manifest><spine><itemref idref="cover"/>${chapters.map((_, i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>`),
  );
  const page = (body: string) => xml(`<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>x</title></head><body>${body}</body></html>`);
  zip.file('OEBPS/nav.xhtml', page(`<nav epub:type="toc"><ol>${chapters.map((c, i) => `<li><a href="text/ch${i}.xhtml">${esc(c.title)}</a></li>`).join('')}</ol></nav>`));
  zip.file('OEBPS/text/cover.xhtml', page(`<p>Cover</p>`));
  chapters.forEach((c, i) => zip.file(`OEBPS/text/ch${i}.xhtml`, page(c.html)));
  return zip.generateAsync({ type: 'arraybuffer' });
}

// ---------- PDF ----------

/** A 3-page "reading" with a running header, page numbers, a footnote, citations and a reference list. */
export async function buildReadingPdf(): Promise<ArrayBuffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Opportunity Cost Reading');
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const pages: { heading?: string; body: string[]; footnote?: string; refs?: string[] }[] = [
    {
      heading: '1. Opportunity cost',
      body: [
        'Every choice has a hidden price (Mankiw, 2021). When you spend an eve-',
        'ning studying, you give up whatever else you might have done.¹',
        'Economists call this the opportunity cost of a decision [3].',
      ],
      footnote: '1 This includes rest, which also has value.',
    },
    {
      heading: '2. Trade-offs',
      body: ['Firms face the same logic (Smith & Jones, 2019, p. 4). A factory', 'that makes chairs cannot also make tables with the same machines.'],
    },
    { heading: 'References', body: [], refs: ['Mankiw, N. G. (2021). Principles of Economics.', 'Smith, A., & Jones, B. (2019). Trade-offs. Journal 4(2).'] },
  ];
  pages.forEach((p, i) => {
    const page = pdf.addPage([612, 792]);
    page.drawText('ECON 1000 · Week 3 Reading', { x: 72, y: 760, size: 9, font });
    let y = 700;
    if (p.heading) {
      page.drawText(p.heading, { x: 72, y, size: 16, font: bold });
      y -= 30;
    }
    for (const line of [...p.body, ...(p.refs ?? [])]) {
      page.drawText(line, { x: 72, y, size: 11, font: font });
      y -= p.refs ? 20 : 14;
    }
    if (p.footnote) page.drawText(p.footnote, { x: 72, y: 90, size: 8, font });
    page.drawText(String(i + 1), { x: 300, y: 40, size: 9, font });
  });
  return (await pdf.save()).buffer as ArrayBuffer;
}
