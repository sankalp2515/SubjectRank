import type { Comparison, LineResult, PairResult, Reason, Span } from "./types";

/**
 * Deployment state of the pairwise model.
 * "rules" means: no trained model is deployed yet, and the interface must say so
 * instead of passing rule output off as model output.
 */
export const MODEL_STATUS: "rules" | "deployed" = "rules";

export const MEDIAN_TRAINING_CHARS = 54;

export const MAX_LINES = 5;
export const MIN_LINES = 2;

interface Feature {
  id: string;
  state: Reason["state"];
  label: string;
  detail: string;
  weight: number;
  spans: Span[];
}

const HYPE_WORDS = [
  "shocking",
  "unbelievable",
  "insane",
  "amazing",
  "epic",
  "mind-blowing",
  "incredible",
  "crazy",
];

const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const NON_LATIN_RE =
  /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/gu;

function findAll(text: string, re: RegExp): Span[] {
  const spans: Span[] = [];
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) rx.lastIndex++;
  }
  return spans;
}

/** Order-independent, deterministic feature extraction for a single line. */
export function extractFeatures(text: string): Feature[] {
  const features: Feature[] = [];

  const numbers = findAll(text, /\b\d[\d.,]*\b/g);
  features.push(
    numbers.length
      ? {
          id: "number",
          state: "helps",
          label: "A specific number",
          detail:
            "Headlines carrying a concrete number won their randomised pair more often than the same headline without one.",
          weight: 0.34,
          spans: numbers,
        }
      : {
          id: "number",
          state: "no-effect",
          label: "No number",
          detail:
            "Measured, and the absence of a number on its own moved nothing. It only matters next to a line that has one.",
          weight: 0,
          spans: [],
        },
  );

  const secondPerson = findAll(text, /\b(you|your|you're|yours)\b/gi);
  if (secondPerson.length) {
    features.push({
      id: "second-person",
      state: "helps",
      label: "Addresses the reader directly",
      detail: "Second-person phrasing was one of the steadier winners across the archive.",
      weight: 0.28,
      spans: secondPerson,
    });
  }

  const question = findAll(text, /\?/g);
  if (question.length) {
    features.push({
      id: "question",
      state: "helps",
      label: "Asks a question",
      detail: "Questions edged out matched statements, though by less than most advice claims.",
      weight: 0.18,
      spans: question,
    });
  }

  const hype = findAll(text, new RegExp(`\\b(${HYPE_WORDS.join("|")})\\b`, "gi"));
  if (hype.length) {
    features.push({
      id: "hype",
      state: "hurts",
      label: "Intensity word",
      detail:
        "Lines leaning on an intensity word lost their pair more often than the plainer version of the same line.",
      weight: -0.32,
      spans: hype,
    });
  }

  const bangs = findAll(text, /!/g);
  if (bangs.length) {
    features.push({
      id: "exclamation",
      state: "hurts",
      label: "Exclamation mark",
      detail: "Exclamation marks cost the line in matched pairs, and two cost more than one.",
      weight: -0.16 * Math.min(bangs.length, 3),
      spans: bangs,
    });
  }

  const shout = findAll(text, /\b[A-Z]{3,}\b/g);
  if (shout.length) {
    features.push({
      id: "caps",
      state: "hurts",
      label: "Shouted word",
      detail: "All-caps words lost pairs against the identical line in sentence case.",
      weight: -0.24,
      spans: shout,
    });
  }

  const len = [...text].length;
  const whole: Span[] = [{ start: 0, end: text.length }];
  if (len > MEDIAN_TRAINING_CHARS + 26) {
    features.push({
      id: "length",
      state: "hurts",
      label: `Long: ${len} characters`,
      detail: `Well past the ${MEDIAN_TRAINING_CHARS}-character median of the training headlines, and long lines lost their pairs more often.`,
      weight: -0.26,
      spans: whole,
    });
  } else if (len < 22) {
    features.push({
      id: "length",
      state: "hurts",
      label: `Short: ${len} characters`,
      detail: `Far under the ${MEDIAN_TRAINING_CHARS}-character median; very short headlines gave the reader too little to act on.`,
      weight: -0.12,
      spans: whole,
    });
  } else {
    features.push({
      id: "length",
      state: "no-effect",
      label: `Length: ${len} characters`,
      detail: `Measured against the ${MEDIAN_TRAINING_CHARS}-character median of the training headlines. Inside this band, length made no material difference.`,
      weight: 0,
      spans: whole,
    });
  }

  const emoji = findAll(text, EMOJI_RE);
  if (emoji.length) {
    features.push({
      id: "emoji",
      state: "not-measured",
      label: "Emoji",
      detail:
        "Emoji were near-absent from 2013–2015 headlines, so there is nothing in the data to compare against. We have no opinion on this — not a neutral one, none at all.",
      weight: 0,
      spans: emoji,
    });
  }

  const nonLatin = findAll(text, NON_LATIN_RE).filter(
    (s) => !emoji.some((e) => e.start <= s.start && e.end >= s.end),
  );
  if (nonLatin.length) {
    features.push({
      id: "non-latin",
      state: "not-measured",
      label: "Non-Latin characters",
      detail:
        "The archive is English-language US media. These characters sit outside anything the data can speak to.",
      weight: 0,
      spans: nonLatin,
    });
  }

  const merge = findAll(text, /\{\{[^}]*\}\}|\*\|[^|]*\|\*/g);
  if (merge.length) {
    features.push({
      id: "merge-tag",
      state: "not-measured",
      label: "Merge tag",
      detail:
        "Personalisation tags did not exist in published headlines. We cannot tell you whether a name helps here.",
      weight: 0,
      spans: merge,
    });
  }

  return features;
}

function scoreOf(features: Feature[]): number {
  return features.reduce((sum, f) => sum + f.weight, 0);
}

function toReasons(features: Feature[]): Reason[] {
  const order = { helps: 0, hurts: 1, "no-effect": 2, "not-measured": 3 } as const;
  return [...features]
    .sort((a, b) => order[a.state] - order[b.state] || a.id.localeCompare(b.id))
    .map(({ id, state, label, detail, spans }) => ({ id, state, label, detail, spans }));
}

const SEPARABLE_MARGIN = 0.07;

function pairProbability(scoreA: number, scoreB: number): number {
  return 1 / (1 + Math.exp(-1.9 * (scoreA - scoreB)));
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/**
 * Ranks the supplied lines against each other only.
 * Ranking is invariant to the order the lines were entered: entries are keyed by
 * their text and sorted by score, then alphabetically as a stable tie-break.
 */
export function compareLines(input: string[]): Comparison {
  const cleaned = input.map((t) => t.trim()).filter(Boolean);

  const entries = cleaned.map((text) => {
    const features = extractFeatures(text);
    return { id: `line-${text}`, text, features, score: scoreOf(features) };
  });

  const sorted = [...entries].sort(
    (a, b) => b.score - a.score || a.text.localeCompare(b.text, "en"),
  );

  const pairs: PairResult[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!;
      const b = sorted[j]!;
      const p = pairProbability(a.score, b.score);
      pairs.push({
        aId: a.id,
        bId: b.id,
        probAWins: p,
        inseparable: Math.abs(a.score - b.score) < SEPARABLE_MARGIN,
      });
    }
  }

  // Group adjacent lines the model cannot statistically separate.
  const groups: number[][] = [];
  sorted.forEach((entry, index) => {
    const last = groups[groups.length - 1];
    if (last) {
      const prev = sorted[last[last.length - 1]!]!;
      const pair = pairs.find(
        (p) =>
          (p.aId === prev.id && p.bId === entry.id) || (p.aId === entry.id && p.bId === prev.id),
      );
      if (pair?.inseparable) {
        last.push(index);
        return;
      }
    }
    groups.push([index]);
  });

  const rankOf = new Map<string, { start: number; end: number }>();
  groups.forEach((group) => {
    const start = group[0]! + 1;
    const end = group[group.length - 1]! + 1;
    group.forEach((index) => rankOf.set(sorted[index]!.id, { start, end }));
  });

  const lines: LineResult[] = sorted.map((entry) => {
    const others = sorted.filter((o) => o.id !== entry.id);
    const winProbability = others.length
      ? others.reduce((sum, o) => sum + pairProbability(entry.score, o.score), 0) / others.length
      : 0.5;
    const rank = rankOf.get(entry.id)!;
    return {
      id: entry.id,
      text: entry.text,
      rankStart: rank.start,
      rankEnd: rank.end,
      rankLabel:
        rank.start === rank.end
          ? ordinal(rank.start)
          : `${ordinal(rank.start)}–${ordinal(rank.end)}`,
      winProbability,
      reasons: toReasons(entry.features),
      charCount: [...entry.text].length,
    };
  });

  return { lines, pairs, medianTrainingCharCount: MEDIAN_TRAINING_CHARS };
}

export function pairBetween(pairs: PairResult[], aId: string, bId: string) {
  return pairs.find(
    (p) => (p.aId === aId && p.bId === bId) || (p.aId === bId && p.bId === aId),
  );
}

export function directedProbability(pairs: PairResult[], aId: string, bId: string): number | null {
  const pair = pairBetween(pairs, aId, bId);
  if (!pair) return null;
  return pair.aId === aId ? pair.probAWins : 1 - pair.probAWins;
}
