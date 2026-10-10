// Shared text and scoring for the Whisper spikes.

export const LECTURE = `Good morning, everyone. Today we're going to talk about opportunity cost, which is one of the most important ideas in the whole course. Every time you make a choice, you give something up. The opportunity cost of a decision is the value of the next best alternative that you didn't choose.

Let's start with a simple example. Suppose you have a free evening. You could go to a concert, or you could work a shift at the coffee shop and earn eighty dollars. If you go to the concert, the ticket is free, but you still pay a price. You give up the eighty dollars you would have earned. That's the opportunity cost of the concert.

Notice that opportunity cost isn't always money. If you spend Saturday studying for the midterm, you give up time with your friends, sleep, or a hike in the mountains. Economists try to put all of these on the same scale, but in everyday life we usually compare them in our heads without writing anything down.

Now, why does this matter for a whole economy? Because resources are scarce. A country has a limited number of workers, machines, and acres of farmland. If it uses more of them to build cars, it has fewer left over to grow wheat. We can draw this trade-off as a production possibilities frontier. Points on the curve are efficient. Points inside the curve mean some resources are sitting idle. Points outside the curve can't be reached with what we have today.

The frontier is usually bowed outward. That shape tells us that opportunity cost rises as we specialize. The first workers we move from farming into car factories are the ones who are best at building cars and worst at farming, so we lose very little wheat. But as we keep going, we have to move people who are excellent farmers and terrible mechanics, and each extra car costs us more and more wheat.

Before next class, please read chapter two and try the practice questions at the end. In particular, think about the opportunity cost of attending university instead of working full time. Don't forget to count the income you're giving up, not just tuition and books.`;

export function words(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
}

/** Word error rate by edit distance over words. */
export function wer(ref: string[], hyp: string[]): number {
  let prev = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i++) {
    const cur = [i];
    for (let j = 1; j <= hyp.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[hyp.length] / ref.length;
}

