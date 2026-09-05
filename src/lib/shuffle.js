// Fisher-Yates (Durstenfeld) shuffle — sort() with a random comparator
// produces a biased distribution (comparator implementations don't call it
// evenly across all pairs, so some permutations come up far more often than
// others). This gives a uniformly random permutation of the input.
export function fisherYates(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
