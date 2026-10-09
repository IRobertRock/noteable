import { describe, expect, it } from 'vitest';
import { claudeLinkPrompt, sharedLink, sharedNote } from '../src/share/shared';

describe('Share to Noteable', () => {
  it('finds the link even when Android puts it inside the text', () => {
    expect(sharedLink({ url: '', text: 'Great read https://example.com/a?b=1' })).toBe('https://example.com/a?b=1');
    expect(sharedLink({ url: 'https://x.org', text: 'hi' })).toBe('https://x.org');
  });

  it('turns a shared link into an Inbox reminder for Claude', () => {
    const n = sharedNote({ title: 'Why rents rise: an explainer', text: 'https://news.example/rents', url: '' });
    expect(n.isLink).toBe(true);
    expect(n.name).toBe('Shared link - Why rents rise  an explainer.md'.replace('  ', ' '));
    expect(n.markdown).toContain('Shared link: https://news.example/rents');
    expect(n.markdown).toMatch(/^---\ntitle: Why rents rise - an explainer\n/);
    expect(claudeLinkPrompt('https://news.example/rents')).toContain('Noteable/Inbox');
  });

  it('turns plain shared text into a narratable Inbox file', () => {
    const n = sharedNote({ title: '', text: 'Lecture notes\nSupply and demand basics.', url: '' });
    expect(n).toMatchObject({ isLink: false, name: 'Lecture notes.md' });
    expect(n.markdown).toContain('## Lecture notes');
  });
});
