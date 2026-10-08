// Lock-screen and car artwork: a simple cover per collection (its name on a
// colour picked from the name), so ECON and POLS items look different at a glance.

const cache = new Map<string, string>();

function hue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** A 512×512 PNG data URL, or `fallback` where canvas isn't available. */
export function coverFor(collection: string, fallback: string): string {
  const hit = cache.get(collection);
  if (hit) return hit;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    if (!g) return fallback;
    const hh = hue(collection);
    const grad = g.createLinearGradient(0, 0, 512, 512);
    grad.addColorStop(0, `hsl(${hh} 55% 32%)`);
    grad.addColorStop(1, `hsl(${(hh + 40) % 360} 60% 18%)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 512);
    // Headphones mark
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 22;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(256, 250, 120, Math.PI, 0);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(118, 240, 44, 84);
    g.fillRect(350, 240, 44, 84);
    // Collection name, wrapped to two lines
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.font = 'bold 54px system-ui, sans-serif';
    const words = collection.split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (g.measureText(test).width > 440 && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    lines.push(line);
    lines.slice(0, 2).forEach((l, i) => g.fillText(l, 256, 400 + i * 60));
    const url = c.toDataURL('image/png');
    cache.set(collection, url);
    return url;
  } catch {
    return fallback;
  }
}
