// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import { tidyGuide } from '../src/ui/reader';

function render(md: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = marked.parse(md) as string;
  tidyGuide(el);
  return el;
}

describe('reading view for study guides', () => {
  it('hides pause markers and hides answers until tapped', () => {
    const el = render('**Q:** Up or down?\n\n[pause 5s]\n\n**A:** Up, because wages rose.\n');
    expect(el.textContent).not.toMatch(/pause/);
    const answer = el.querySelector('.answer') as HTMLElement;
    expect(answer.textContent).toContain('Up, because');
    expect(answer.classList.contains('hidden-answer')).toBe(true);
    answer.click();
    expect(answer.classList.contains('hidden-answer')).toBe(false);
  });

  it('splits Q and A written in one paragraph', () => {
    const el = render('**Q:** Up or down? [pause 3s] **A:** Up.');
    const ps = el.querySelectorAll('p');
    expect(ps).toHaveLength(2);
    expect(ps[0].textContent?.trim()).toBe('Q: Up or down?');
    expect(ps[1].classList.contains('answer')).toBe(true);
  });

  it('leaves ordinary bold text alone', () => {
    const el = render('**Opportunity cost:** the value of the next best alternative.');
    expect(el.querySelector('.answer')).toBeNull();
  });
});
