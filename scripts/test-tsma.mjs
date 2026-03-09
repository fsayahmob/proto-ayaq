#!/usr/bin/env node
/**
 * TSMA (Thompson Sampling Multi-Axes) — Standalone Validation Script
 *
 * Simulates a virtual user with KNOWN preferences swiping through the
 * 79 pre-curated bundles from isciacus-bundles.json.
 * Verifies that the algorithm correctly identifies the user's preferences
 * after N swipes, measuring convergence speed and accuracy.
 *
 * Usage: node scripts/test-tsma.mjs
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(resolve(__dirname, '../data/isciacus-bundles.json'), 'utf-8'));

// ─── Algo core (extracted from isciacus.html) ──────────────────────────

const PREFERENCE_AXES = {
  style: ['workwear','minimal','street','elevated','gorpcore','heritage','french-casual'],
  color: ['NOIR','BLANC','MARINE','VERT','TERRE','ROUGE','GRIS'],
  silhouette: ['relaxed','regular','structured'],
  formality: ['decontracte','smart-casual'],
  priceRange: ['budget','mid','premium'],
};

function initPreferences() {
  const prefs = {};
  for (const [axis, values] of Object.entries(PREFERENCE_AXES)) {
    prefs[axis] = {};
    for (const v of values) {
      prefs[axis][v] = { alpha: 1, beta: 1 };
    }
  }
  return prefs;
}

// Beta sampling via Gamma random variates (Marsaglia & Tsang)
function sampleBeta(alpha, beta) {
  function gammaRand(shape) {
    if (shape < 1) return gammaRand(shape + 1) * Math.pow(Math.random(), 1 / shape);
    const d = shape - 1/3;
    const c = 1 / Math.sqrt(9 * d);
    while (true) {
      let x, v;
      do { x = gaussRand(); v = Math.pow(1 + c * x, 3); } while (v <= 0);
      const u = Math.random();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }
  function gaussRand() {
    let u, v, s;
    do { u = Math.random() * 2 - 1; v = Math.random() * 2 - 1; s = u*u + v*v; } while (s >= 1 || s === 0);
    return u * Math.sqrt(-2 * Math.log(s) / s);
  }
  const x = gammaRand(alpha);
  const y = gammaRand(beta);
  return x / (x + y);
}

// Extract axes from a bundle (using the RAG JSON structure)
function extractBundleAxes(bundle) {
  const axes = { style: [], color: [], silhouette: [], formality: [], priceRange: [] };

  // Bundle-level attributes
  if (bundle.style && PREFERENCE_AXES.style.includes(bundle.style)) {
    axes.style.push(bundle.style);
  }
  if (bundle.silhouette && PREFERENCE_AXES.silhouette.includes(bundle.silhouette)) {
    axes.silhouette.push(bundle.silhouette);
  }
  if (bundle.formality && PREFERENCE_AXES.formality.includes(bundle.formality)) {
    axes.formality.push(bundle.formality);
  }

  // Item-level attributes
  const items = Object.values(bundle.items || {});
  for (const item of items) {
    // Colors
    for (const c of (item.colors || [])) {
      if (PREFERENCE_AXES.color.includes(c) && !axes.color.includes(c)) axes.color.push(c);
    }
    // Price range
    const price = item.price || 0;
    const range = price < 100 ? 'budget' : price > 200 ? 'premium' : 'mid';
    if (!axes.priceRange.includes(range)) axes.priceRange.push(range);
    // Silhouette from item if present
    if (item.silhouette && PREFERENCE_AXES.silhouette.includes(item.silhouette) && !axes.silhouette.includes(item.silhouette)) {
      axes.silhouette.push(item.silhouette);
    }
  }

  return axes;
}

// Compute inverse frequency weights (IDF) for each axis value across all bundles
function computeIDF(bundles) {
  const docFreq = {};
  for (const [axis, values] of Object.entries(PREFERENCE_AXES)) {
    docFreq[axis] = {};
    for (const v of values) docFreq[axis][v] = 0;
  }
  for (const bundle of bundles) {
    const axes = extractBundleAxes(bundle);
    for (const [axis, values] of Object.entries(axes)) {
      for (const v of values) {
        if (docFreq[axis]?.[v] !== undefined) docFreq[axis][v]++;
      }
    }
  }
  const idf = {};
  const freq = {};
  const N = bundles.length;
  for (const [axis, counts] of Object.entries(docFreq)) {
    idf[axis] = {};
    freq[axis] = {};
    for (const [v, count] of Object.entries(counts)) {
      freq[axis][v] = count;
      // Smoothed IDF: log(1 + N/count) ensures minimum weight even for common values
      idf[axis][v] = count > 0 ? Math.log(1 + N / count) : 0;
    }
  }
  return { idf, freq };
}

const { idf: idfWeights, freq: valueFreq } = computeIDF(data.bundles);

// Update preferences with contrastive credit assignment (IDF²-normalized)
const CONTRASTIVE_WEIGHT = 0.2;

function updatePreferences(prefs, bundleAxes, direction) {
  for (const [axis, values] of Object.entries(bundleAxes)) {
    if (!prefs[axis]) continue;
    const credit = values.length > 0 ? 1.0 / values.length : 0;
    const allValues = PREFERENCE_AXES[axis] || [];

    for (const v of allValues) {
      if (!prefs[axis][v]) continue;
      // Skip values that never appear in any bundle (no signal possible)
      if (!valueFreq[axis]?.[v] || valueFreq[axis][v] === 0) continue;

      const idf = idfWeights[axis]?.[v] || 0;
      const inBundle = values.includes(v);

      if (direction === 'right') {
        if (inBundle) {
          prefs[axis][v].alpha += credit * idf;
        } else {
          prefs[axis][v].beta += credit * CONTRASTIVE_WEIGHT;
        }
      } else {
        if (inBundle) {
          prefs[axis][v].beta += credit * idf;
        } else {
          prefs[axis][v].alpha += credit * CONTRASTIVE_WEIGHT;
        }
      }
    }
  }
  return prefs;
}

// Score a bundle for Thompson-based selection
function thompsonScoreBundle(bundle, prefs) {
  const axes = extractBundleAxes(bundle);
  let score = 0;
  let count = 0;
  for (const [axis, values] of Object.entries(axes)) {
    for (const v of values) {
      if (prefs[axis]?.[v]) {
        score += sampleBeta(prefs[axis][v].alpha, prefs[axis][v].beta);
        count++;
      }
    }
  }
  return count > 0 ? score / count : 0.5;
}

// ─── Virtual User: decides like/dislike based on known preferences ─────

function createVirtualUser(truePrefs) {
  /**
   * truePrefs = { style: 'workwear', color: 'VERT', silhouette: 'relaxed',
   *               formality: 'decontracte', priceRange: 'mid' }
   * Returns 'right' (like) if bundle matches >= matchThreshold axes, else 'left'
   */
  return function decide(bundle, matchThreshold = 3) {
    const axes = extractBundleAxes(bundle);
    let matches = 0;

    if (axes.style.includes(truePrefs.style)) matches++;
    if (axes.color.includes(truePrefs.color)) matches++;
    if (axes.silhouette.includes(truePrefs.silhouette)) matches++;
    if (axes.formality.includes(truePrefs.formality)) matches++;
    if (axes.priceRange.includes(truePrefs.priceRange)) matches++;

    return matches >= matchThreshold ? 'right' : 'left';
  };
}

// ─── Metrics ───────────────────────────────────────────────────────────

function getTopPreference(prefs, axis) {
  const entries = Object.entries(prefs[axis]);
  let best = null, bestMean = -1;
  for (const [v, { alpha, beta }] of entries) {
    const mean = alpha / (alpha + beta);
    if (mean > bestMean) { bestMean = mean; best = v; }
  }
  return { value: best, mean: bestMean };
}

function getDistributionSummary(prefs, axis) {
  return Object.entries(prefs[axis])
    .map(([v, { alpha, beta }]) => {
      const mean = alpha / (alpha + beta);
      const bar = '█'.repeat(Math.round(mean * 20)) + '░'.repeat(20 - Math.round(mean * 20));
      return `    ${v.padEnd(15)} α=${alpha.toFixed(1)} β=${beta.toFixed(1)}  E=${mean.toFixed(3)}  ${bar}`;
    })
    .join('\n');
}

function checkAccuracy(prefs, truePrefs) {
  let correct = 0;
  for (const [axis, trueValue] of Object.entries(truePrefs)) {
    const top = getTopPreference(prefs, axis);
    if (top.value === trueValue) correct++;
  }
  return correct;
}

// ─── Simulation ────────────────────────────────────────────────────────

function runSimulation(truePrefs, label, matchThreshold = 3) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  SIMULATION: ${label}`);
  console.log(`  True preferences: ${JSON.stringify(truePrefs)}`);
  console.log(`  Match threshold: ${matchThreshold}/5 axes to like`);
  console.log(`${'═'.repeat(70)}\n`);

  const prefs = initPreferences();
  const user = createVirtualUser(truePrefs);
  const bundles = [...data.bundles];
  const totalAxes = Object.keys(truePrefs).length;

  let likes = 0, dislikes = 0;
  const convergenceLog = [];

  // Simulate swipes
  for (let t = 0; t < bundles.length; t++) {
    // Select next bundle via Thompson Sampling (after first few random ones)
    let bundle;
    if (t < 3) {
      // First 3: random to bootstrap
      bundle = bundles[t];
    } else {
      // Score all remaining bundles, pick the best
      const remaining = bundles.slice(t);
      const scored = remaining.map(b => ({ b, score: thompsonScoreBundle(b, prefs) }));
      scored.sort((a, b) => b.score - a.score);
      bundle = scored[0].b;
      // Move picked bundle to current position
      const idx = bundles.indexOf(bundle);
      [bundles[t], bundles[idx]] = [bundles[idx], bundles[t]];
    }

    // User decides
    const direction = user(bundle, matchThreshold);
    if (direction === 'right') likes++; else dislikes++;

    // Update preferences
    const bundleAxes = extractBundleAxes(bundle);
    updatePreferences(prefs, bundleAxes, direction);

    // Log accuracy at key milestones
    const accuracy = checkAccuracy(prefs, truePrefs);
    if ([1,3,5,7,10,15,20,30,50,79].includes(t + 1)) {
      convergenceLog.push({ swipe: t + 1, accuracy, likes, dislikes });
      console.log(`  Swipe ${String(t+1).padStart(2)}: ${direction.padEnd(5)} | bundle=${bundle.style}/${bundle.occasion} | accuracy=${accuracy}/${totalAxes} | likes=${likes} dislikes=${dislikes}`);
    }
  }

  // Final results
  console.log(`\n  ─── CONVERGENCE TIMELINE ───`);
  console.log(`  ${'Swipe'.padEnd(8)} ${'Accuracy'.padEnd(12)} ${'Status'}`);
  for (const { swipe, accuracy } of convergenceLog) {
    const pct = (accuracy / totalAxes * 100).toFixed(0);
    const status = accuracy === totalAxes ? '✅ CONVERGED' : accuracy >= totalAxes - 1 ? '🔶 CLOSE' : '🔍 EXPLORING';
    console.log(`  ${String(swipe).padEnd(8)} ${(accuracy + '/' + totalAxes).padEnd(12)} ${status} (${pct}%)`);
  }

  console.log(`\n  ─── FINAL DISTRIBUTIONS (after ${bundles.length} swipes) ───\n`);
  for (const axis of Object.keys(PREFERENCE_AXES)) {
    const top = getTopPreference(prefs, axis);
    const isCorrect = top.value === truePrefs[axis];
    console.log(`  ${axis.toUpperCase()} (true: ${truePrefs[axis]}) → top: ${top.value} ${isCorrect ? '✅' : '❌'}`);
    console.log(getDistributionSummary(prefs, axis));
    console.log();
  }

  const finalAccuracy = checkAccuracy(prefs, truePrefs);
  return { finalAccuracy, totalAxes, likes, dislikes };
}

// ─── Run multiple user profiles ────────────────────────────────────────

console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
console.log('║     TSMA VALIDATION — Thompson Sampling Multi-Axes Bayesien       ║');
console.log('║     Testing against 79 pre-curated bundles from RAG JSON          ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝');

const profiles = [
  {
    label: 'PROFIL A — Workwear fan, couleurs terre, relaxed',
    prefs: { style: 'workwear', color: 'TERRE', silhouette: 'relaxed', formality: 'decontracte', priceRange: 'mid' },
    threshold: 3,
  },
  {
    label: 'PROFIL B — Minimal chic, noir, structured',
    prefs: { style: 'minimal', color: 'NOIR', silhouette: 'structured', formality: 'smart-casual', priceRange: 'premium' },
    threshold: 3,
  },
  {
    label: 'PROFIL C — Street/gorpcore, vert, relaxed',
    prefs: { style: 'street', color: 'VERT', silhouette: 'relaxed', formality: 'decontracte', priceRange: 'budget' },
    threshold: 2,  // More lenient — street+gorpcore user likes variety
  },
  {
    label: 'PROFIL D — Heritage classique, marine, regular',
    prefs: { style: 'heritage', color: 'MARINE', silhouette: 'regular', formality: 'decontracte', priceRange: 'mid' },
    threshold: 3,
  },
];

const results = [];

for (const { label, prefs, threshold } of profiles) {
  const result = runSimulation(prefs, label, threshold);
  results.push({ label, ...result });
}

// ─── Summary ───────────────────────────────────────────────────────────

console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
console.log('║                        RESULTS SUMMARY                             ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

for (const r of results) {
  const pct = (r.finalAccuracy / r.totalAxes * 100).toFixed(0);
  const status = r.finalAccuracy === r.totalAxes ? '✅ PASS' : '⚠️  PARTIAL';
  console.log(`  ${status}  ${r.label}`);
  console.log(`         Accuracy: ${r.finalAccuracy}/${r.totalAxes} (${pct}%) — Likes: ${r.likes}, Dislikes: ${r.dislikes}\n`);
}

const avgAccuracy = results.reduce((s, r) => s + r.finalAccuracy / r.totalAxes, 0) / results.length;
console.log(`  ─── Overall accuracy: ${(avgAccuracy * 100).toFixed(1)}% ───`);

if (avgAccuracy >= 0.8) {
  console.log('\n  ✅ TSMA VALIDATED — L\'algorithme converge correctement sur les préférences connues.\n');
} else {
  console.log('\n  ⚠️  TSMA NEEDS TUNING — Convergence insuffisante, ajuster le credit ou les axes.\n');
}
