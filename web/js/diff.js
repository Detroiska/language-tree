import { esc } from "./ui.js";

// Segment-level comparison for recorded vs. derived forms.
//
// The cognate explorer and the inherited check could only say "Differs" —
// which sound actually diverged was invisible. These helpers align the two
// forms with a minimal edit distance over the tokenizer's segments, so the
// UI can color exactly the segments that differ.
//
// `alignSegments` is DOM-free and returns data; `formDiffMarkup` renders one
// side and is shared by the cognate trace and the inherited-vocabulary table.

// Minimal-cost alignment of two segment lists. Costs: same segment 0,
// substitution/deletion/insertion 1. The result is a list of aligned pairs
// in display order: { left, right, kind }, where exactly one side may be
// null (a deletion on the left side or an insertion on the right side) and
// kind is "equal" | "sub" | "del" | "ins".
export function alignSegments(leftTokens = [], rightTokens = []) {
  const rows = leftTokens.length;
  const cols = rightTokens.length;
  // dp[i][j] = cost of aligning left[0..i) with right[0..j)
  const dp = [];
  for (let i = 0; i <= rows; i += 1) dp.push(new Array(cols + 1).fill(0));
  for (let j = 1; j <= cols; j += 1) dp[0][j] = j;
  for (let i = 1; i <= rows; i += 1) dp[i][0] = i;
  for (let i = 1; i <= rows; i += 1) {
    for (let j = 1; j <= cols; j += 1) {
      const substitute = dp[i - 1][j - 1] + (leftTokens[i - 1] === rightTokens[j - 1] ? 0 : 1);
      const remove = dp[i - 1][j] + 1;
      const insert = dp[i][j - 1] + 1;
      dp[i][j] = Math.min(substitute, remove, insert);
    }
  }
  // Backtrace, preferring diagonal steps so one differing segment reads as a
  // substitution rather than a delete+insert pair.
  const ops = [];
  let i = rows;
  let j = cols;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (leftTokens[i - 1] === rightTokens[j - 1] ? 0 : 1)) {
      ops.unshift({
        left: leftTokens[i - 1],
        right: rightTokens[j - 1],
        kind: leftTokens[i - 1] === rightTokens[j - 1] ? "equal" : "sub",
      });
      i -= 1;
      j -= 1;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.unshift({ left: leftTokens[i - 1], right: null, kind: "del" });
      i -= 1;
    } else if (j > 0) {
      ops.unshift({ left: null, right: rightTokens[j - 1], kind: "ins" });
      j -= 1;
    } else {
      break;
    }
  }
  return ops;
}

// One side of an aligned pair list as HTML. Segments that the other side does
// not share (a substitution, or the surviving side of a delete/insert) are
// wrapped in a colored span; identical segments pass through plain.
function sideMarkup(ops, side) {
  return ops
    .map((op) => {
      const token = op[side];
      if (!token) return "";
      return op.kind === "equal" ? `<span class="seg-same">${esc(token)}</span>` : `<span class="seg-diff" title="differs">${esc(token)}</span>`;
    })
    .join("");
}

// Markup for both forms when they differ as segment sequences, or null when
// they tokenize the same (callers then show the plain form). Inputs are
// already-tokenized segment lists; `context.tokenize(form)` is the app's
// normal path.
export function formDiffMarkup(leftTokens = [], rightTokens = []) {
  const same =
    leftTokens.length === rightTokens.length &&
    leftTokens.every((token, index) => token === rightTokens[index]);
  if (same) return null;
  const ops = alignSegments(leftTokens, rightTokens);
  return { left: sideMarkup(ops, "left"), right: sideMarkup(ops, "right") };
}

// Convenience for table cells: tokenize two form strings in one context and
// return `/…/`-wrapped per-segment markup for both sides, or null when there
// is nothing to color. An empty form still shows, spelled `∅`.
export function diffPairMarkup(leftText, rightText, context) {
  if (!context) return null;
  const leftTokens = context.tokenize(leftText || "");
  const rightTokens = context.tokenize(rightText || "");
  const markup = formDiffMarkup(leftTokens, rightTokens);
  if (!markup) return null;
  return {
    left: `/${markup.left || "∅"}/`,
    right: `/${markup.right || "∅"}/`,
  };
}
