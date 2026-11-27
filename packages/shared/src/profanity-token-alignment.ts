export const MAX_LOCAL_TOKENS = 240;

// An LCS maps exact dialogue tokens while allowing insertions and omissions. A token
// is unique only if every optimal alignment maps it to the same position.
export function alignTokens(left: { key: string }[], right: { key: string }[]) {
  if (left.length > MAX_LOCAL_TOKENS || right.length > MAX_LOCAL_TOKENS) {
    return { positions: left.map(() => [] as number[]), unique: left.map(() => -1), count: 0 };
  }
  const n = left.length;
  const m = right.length;
  const width = m + 1;
  const prefix = new Uint16Array((n + 1) * width);
  const suffix = new Uint16Array(prefix.length);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      prefix[(i + 1) * width + j + 1] = left[i].key === right[j].key
        ? prefix[i * width + j] + 1
        : Math.max(prefix[i * width + j + 1], prefix[(i + 1) * width + j]);
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      suffix[i * width + j] = left[i].key === right[j].key
        ? suffix[(i + 1) * width + j + 1] + 1
        : Math.max(suffix[(i + 1) * width + j], suffix[i * width + j + 1]);
    }
  }

  const count = suffix[0];
  const positions: number[][] = [];
  const unique: number[] = [];
  for (let i = 0; i < n; i++) {
    const candidates: number[] = [];
    let skippable = false;
    for (let j = 0; j <= m; j++) {
      const before = prefix[i * width + j];
      if (before + suffix[(i + 1) * width + j] === count) skippable = true;
      if (j < m && left[i].key === right[j].key && before + 1 + suffix[(i + 1) * width + j + 1] === count) {
        candidates.push(j);
      }
    }
    positions.push(candidates);
    unique.push(!skippable && candidates.length === 1 ? candidates[0] : -1);
  }
  return { positions, unique, count };
}
