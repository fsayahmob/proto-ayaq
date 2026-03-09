#!/usr/bin/env node
/**
 * TSMA Ablation Study — Baselines + Component Analysis
 *
 * Runs 5 configurations × 4 profiles × 10 runs (stochastic averaging):
 *   1. TSMA full (IDF + contrastive γ=0.2)
 *   2. TSMA sans contrastif (γ=0)
 *   3. TSMA sans IDF (poids uniformes)
 *   4. TSMA sans IDF sans contrastif (Beta-Bernoulli pur)
 *   5. Random baseline (pas de Thompson Sampling)
 *
 * + Ablation sur γ ∈ {0, 0.05, 0.1, 0.2, 0.3, 0.5, 1.0}
 *
 * Output: tableau LaTeX-ready pour les articles
 *
 * Usage: node scripts/test-ablation.mjs
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(resolve(__dirname, '../data/isciacus-bundles.json'), 'utf-8'));

// ─── Algo core ────────────────────────────────────────────────────────

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
    for (const v of values) prefs[axis][v] = { alpha: 1, beta: 1 };
  }
  return prefs;
}

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

function extractBundleAxes(bundle) {
  const axes = { style: [], color: [], silhouette: [], formality: [], priceRange: [] };
  if (bundle.style && PREFERENCE_AXES.style.includes(bundle.style)) axes.style.push(bundle.style);
  if (bundle.silhouette && PREFERENCE_AXES.silhouette.includes(bundle.silhouette)) axes.silhouette.push(bundle.silhouette);
  if (bundle.formality && PREFERENCE_AXES.formality.includes(bundle.formality)) axes.formality.push(bundle.formality);
  const items = Object.values(bundle.items || {});
  for (const item of items) {
    for (const c of (item.colors || [])) {
      if (PREFERENCE_AXES.color.includes(c) && !axes.color.includes(c)) axes.color.push(c);
    }
    const price = item.price || 0;
    const range = price < 100 ? 'budget' : price > 200 ? 'premium' : 'mid';
    if (!axes.priceRange.includes(range)) axes.priceRange.push(range);
    if (item.silhouette && PREFERENCE_AXES.silhouette.includes(item.silhouette) && !axes.silhouette.includes(item.silhouette)) {
      axes.silhouette.push(item.silhouette);
    }
  }
  return axes;
}

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
      idf[axis][v] = count > 0 ? Math.log(1 + N / count) : 0;
    }
  }
  return { idf, freq };
}

const { idf: idfWeights, freq: valueFreq } = computeIDF(data.bundles);

// ─── Configurable update function ─────────────────────────────────────

function updatePreferencesConfig(prefs, bundleAxes, direction, { useIDF = true, gamma = 0.2 }) {
  for (const [axis, values] of Object.entries(bundleAxes)) {
    if (!prefs[axis]) continue;
    const credit = values.length > 0 ? 1.0 / values.length : 0;
    const allValues = PREFERENCE_AXES[axis] || [];

    for (const v of allValues) {
      if (!prefs[axis][v]) continue;
      if (!valueFreq[axis]?.[v] || valueFreq[axis][v] === 0) continue;

      const w = useIDF ? (idfWeights[axis]?.[v] || 1) : 1;
      const inBundle = values.includes(v);

      if (direction === 'right') {
        if (inBundle) {
          prefs[axis][v].alpha += credit * w;
        } else if (gamma > 0) {
          prefs[axis][v].beta += credit * gamma;
        }
      } else {
        if (inBundle) {
          prefs[axis][v].beta += credit * w;
        } else if (gamma > 0) {
          prefs[axis][v].alpha += credit * gamma;
        }
      }
    }
  }
  return prefs;
}

// ─── Virtual user ─────────────────────────────────────────────────────

function createVirtualUser(truePrefs) {
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

function thompsonScoreBundle(bundle, prefs) {
  const axes = extractBundleAxes(bundle);
  let score = 0, count = 0;
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

// ─── Info-gain scoring ────────────────────────────────────────────────
// Entropy of Beta(α,β) ≈ log(B(α,β)) - (α-1)ψ(α) - (β-1)ψ(β) + (α+β-2)ψ(α+β)
// Simplified: use variance as proxy for uncertainty
function axisEntropy(prefs, axis) {
  let totalVar = 0;
  for (const v of PREFERENCE_AXES[axis]) {
    const { alpha, beta } = prefs[axis][v];
    const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
    totalVar += variance;
  }
  return totalVar;
}

function infoGainScore(bundle, prefs, lambda = 0.3) {
  const axes = extractBundleAxes(bundle);
  // Reward component (standard Thompson)
  let reward = 0, count = 0;
  for (const [axis, values] of Object.entries(axes)) {
    for (const v of values) {
      if (prefs[axis]?.[v]) {
        reward += sampleBeta(prefs[axis][v].alpha, prefs[axis][v].beta);
        count++;
      }
    }
  }
  const rewardScore = count > 0 ? reward / count : 0.5;

  // Info-gain component: prefer bundles that touch high-entropy axes
  let entropyScore = 0;
  for (const axis of Object.keys(axes)) {
    if (axes[axis].length > 0) {
      entropyScore += axisEntropy(prefs, axis);
    }
  }

  return rewardScore * (1 - lambda) + entropyScore * lambda * 10; // Scale entropy to comparable range
}

// ─── Adaptive gamma ──────────────────────────────────────────────────
function adaptiveGamma(prefs, gammaStart = 0.5, gammaEnd = 0.1) {
  // Measure average certainty across all axes
  let totalConcentration = 0, count = 0;
  for (const axis of Object.keys(PREFERENCE_AXES)) {
    for (const v of PREFERENCE_AXES[axis]) {
      const { alpha, beta } = prefs[axis][v];
      totalConcentration += alpha + beta - 2; // Subtract prior
      count++;
    }
  }
  const avgConcentration = totalConcentration / count;
  // Decay γ as confidence grows: high concentration → low γ
  const decay = Math.exp(-avgConcentration / 3);
  return gammaEnd + (gammaStart - gammaEnd) * decay;
}

function getTopPreference(prefs, axis) {
  let best = null, bestMean = -1;
  for (const [v, { alpha, beta }] of Object.entries(prefs[axis])) {
    const mean = alpha / (alpha + beta);
    if (mean > bestMean) { bestMean = mean; best = v; }
  }
  return best;
}

function checkAccuracy(prefs, truePrefs) {
  let correct = 0;
  for (const [axis, trueValue] of Object.entries(truePrefs)) {
    if (getTopPreference(prefs, axis) === trueValue) correct++;
  }
  return correct;
}

// ─── Run one simulation ───────────────────────────────────────────────

function runOnce(truePrefs, matchThreshold, config) {
  const prefs = initPreferences();
  const user = createVirtualUser(truePrefs);
  const bundles = [...data.bundles];
  const useThompson = config.name !== 'Random';
  const useInfoGain = config.infoGain || false;
  const useAdaptiveGamma = config.adaptiveGamma || false;

  const totalBundles = bundles.length;
  const milestones = [5, 10, 20, 50, totalBundles];
  const accuracyAt = {};

  for (let t = 0; t < bundles.length; t++) {
    let bundle;
    if (!useThompson || t < 3) {
      // Random selection
      const idx = t + Math.floor(Math.random() * (bundles.length - t));
      [bundles[t], bundles[idx]] = [bundles[idx], bundles[t]];
      bundle = bundles[t];
    } else {
      const remaining = bundles.slice(t);
      const scoreFn = useInfoGain
        ? (b) => infoGainScore(b, prefs, config.infoGainLambda || 0.3)
        : (b) => thompsonScoreBundle(b, prefs);
      const scored = remaining.map(b => ({ b, score: scoreFn(b) }));
      scored.sort((a, b) => b.score - a.score);
      bundle = scored[0].b;
      const idx = bundles.indexOf(bundle);
      [bundles[t], bundles[idx]] = [bundles[idx], bundles[t]];
    }

    const direction = user(bundle, matchThreshold);
    if (config.name !== 'Random') {
      const bundleAxes = extractBundleAxes(bundle);
      const gamma = useAdaptiveGamma ? adaptiveGamma(prefs) : config.gamma;
      updatePreferencesConfig(prefs, bundleAxes, direction, { ...config, gamma });
    }

    if (milestones.includes(t + 1)) {
      accuracyAt[t + 1] = config.name === 'Random' ? checkRandomAccuracy(truePrefs) : checkAccuracy(prefs, truePrefs);
    }
  }

  const finalAccuracy = config.name === 'Random' ? checkRandomAccuracy(truePrefs) : checkAccuracy(prefs, truePrefs);
  return { finalAccuracy, accuracyAt };
}

// Random baseline: expected accuracy = 1/|V_a| for each axis
function checkRandomAccuracy(truePrefs) {
  let correct = 0;
  for (const [axis] of Object.entries(truePrefs)) {
    if (Math.random() < 1 / PREFERENCE_AXES[axis].length) correct++;
  }
  return correct;
}

// ─── Profiles ─────────────────────────────────────────────────────────

const profiles = [
  { label: 'A (Workwear)', prefs: { style: 'workwear', color: 'TERRE', silhouette: 'relaxed', formality: 'decontracte', priceRange: 'mid' }, threshold: 3 },
  { label: 'B (Minimal)',  prefs: { style: 'minimal', color: 'NOIR', silhouette: 'regular', formality: 'smart-casual', priceRange: 'mid' }, threshold: 3 },
  { label: 'C (Street)',   prefs: { style: 'street', color: 'VERT', silhouette: 'relaxed', formality: 'decontracte', priceRange: 'budget' }, threshold: 2 },
  { label: 'D (Heritage)', prefs: { style: 'heritage', color: 'MARINE', silhouette: 'regular', formality: 'decontracte', priceRange: 'mid' }, threshold: 3 },
  { label: 'E (Gorpcore)', prefs: { style: 'gorpcore', color: 'VERT', silhouette: 'regular', formality: 'decontracte', priceRange: 'mid' }, threshold: 3 },
  { label: 'F (Elevated)', prefs: { style: 'elevated', color: 'ROUGE', silhouette: 'regular', formality: 'smart-casual', priceRange: 'mid' }, threshold: 3 },
];

// ─── Configurations ───────────────────────────────────────────────────

// Progressive lever addition (each row adds one lever on top of the previous)
const configs = [
  { name: 'Random',                       useIDF: false, gamma: 0 },
  { name: '1. TS vanilla',                useIDF: false, gamma: 0 },
  { name: '2. +IDF',                      useIDF: true,  gamma: 0 },
  { name: '3. +Contrastive(γ=0.2)',       useIDF: true,  gamma: 0.2 },
  { name: '4. +γ=0.3',                   useIDF: true,  gamma: 0.3 },
  { name: '5. +γ=0.5',                   useIDF: true,  gamma: 0.5 },
  { name: '6. +γ=1.0',                   useIDF: true,  gamma: 1.0 },
  { name: '7. +InfoGain(λ=0.1)',          useIDF: true,  gamma: 1.0, infoGain: true, infoGainLambda: 0.1 },
  { name: '8. +InfoGain(λ=0.3)',          useIDF: true,  gamma: 1.0, infoGain: true, infoGainLambda: 0.3 },
  { name: '9. +InfoGain(λ=0.5)',          useIDF: true,  gamma: 1.0, infoGain: true, infoGainLambda: 0.5 },
];

const N_RUNS = 50; // Average over 50 stochastic runs for stability

// ─── Part 1: Ablation study ───────────────────────────────────────────

console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
console.log('║           TSMA ABLATION STUDY — Baselines & Components             ║');
console.log(`║           ${N_RUNS} runs per config × ${profiles.length} profiles                          ║`);
console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

const ablationResults = {};

for (const config of configs) {
  const profileResults = [];

  for (const profile of profiles) {
    let totalAccuracy = 0;
    const milestonesAcc = {};

    for (let run = 0; run < N_RUNS; run++) {
      const { finalAccuracy, accuracyAt } = runOnce(profile.prefs, profile.threshold, config);
      totalAccuracy += finalAccuracy;
      for (const [milestone, acc] of Object.entries(accuracyAt)) {
        milestonesAcc[milestone] = (milestonesAcc[milestone] || 0) + acc;
      }
    }

    profileResults.push({
      profile: profile.label,
      avgAccuracy: totalAccuracy / N_RUNS,
      milestones: Object.fromEntries(
        Object.entries(milestonesAcc).map(([k, v]) => [k, v / N_RUNS])
      ),
    });
  }

  const overallAvg = profileResults.reduce((s, r) => s + r.avgAccuracy, 0) / profileResults.length;
  ablationResults[config.name] = { profileResults, overallAvg };
}

// Print results table
const profHeaders = profiles.map(p => p.label.split(' ')[0]).join(' | ');
console.log(`  Configuration                  | ${profHeaders} | Avg    |`);
console.log('  ───────────────────────────────|' + profiles.map(() => '──────').join('|') + '|────────|');

for (const config of configs) {
  const r = ablationResults[config.name];
  const cells = r.profileResults.map(p => (p.avgAccuracy / 5 * 100).toFixed(0).padStart(4) + '%');
  const avg = (r.overallAvg / 5 * 100).toFixed(0);
  console.log(`  ${config.name.padEnd(31)} | ${cells.join(' | ')} | ${avg.padStart(4)}%  |`);
}

// ─── Part 2: Gamma sweep ──────────────────────────────────────────────

console.log('\n\n╔══════════════════════════════════════════════════════════════════════╗');
console.log('║           GAMMA (γ) SWEEP — Contrastive weight ablation            ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

const gammaValues = [0, 0.05, 0.1, 0.2, 0.3, 0.5, 1.0];
const gammaResults = {};

for (const gamma of gammaValues) {
  let totalAccuracy = 0;
  let totalCount = 0;

  for (const profile of profiles) {
    for (let run = 0; run < N_RUNS; run++) {
      const { finalAccuracy } = runOnce(profile.prefs, profile.threshold, { name: 'gamma-sweep', useIDF: true, gamma });
      totalAccuracy += finalAccuracy;
      totalCount++;
    }
  }

  gammaResults[gamma] = totalAccuracy / totalCount;
}

console.log('  γ     | Avg accuracy (axes/5) | Percentage |');
console.log('  ──────|───────────────────────|────────────|');

let bestGamma = 0, bestAcc = 0;
for (const gamma of gammaValues) {
  const acc = gammaResults[gamma];
  const pct = (acc / 5 * 100).toFixed(1);
  const bar = '█'.repeat(Math.round(acc / 5 * 30));
  const marker = gamma === 0.2 ? ' ← current' : '';
  console.log(`  ${String(gamma).padEnd(5)} | ${acc.toFixed(2).padStart(19)}   | ${pct.padStart(6)}%    | ${bar}${marker}`);
  if (acc > bestAcc) { bestAcc = acc; bestGamma = gamma; }
}

console.log(`\n  Best γ = ${bestGamma} with avg accuracy = ${(bestAcc / 5 * 100).toFixed(1)}%`);

// ─── Part 3: Convergence comparison ───────────────────────────────────

console.log('\n\n╔══════════════════════════════════════════════════════════════════════╗');
console.log('║           CONVERGENCE SPEED — Axes identified at each milestone     ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

const convergenceConfigs = [
  { name: 'Random',             useIDF: false, gamma: 0 },
  { name: '1. TS vanilla',      useIDF: false, gamma: 0 },
  { name: '3. +Contrastive',    useIDF: true,  gamma: 0.2 },
  { name: '6. +γ=1.0',         useIDF: true,  gamma: 1.0 },
];

const totalB = data.bundles.length;
const milestones = [5, 10, 20, 50, totalB];

console.log(`  Config          | @5    | @10   | @20   | @50   | @${totalB}  |`);
console.log('  ────────────────|───────|───────|───────|───────|───────|');

for (const config of convergenceConfigs) {
  const avgAtMilestone = {};
  for (const m of milestones) avgAtMilestone[m] = 0;

  let totalRuns = 0;
  for (const profile of profiles) {
    for (let run = 0; run < N_RUNS; run++) {
      const { accuracyAt } = runOnce(profile.prefs, profile.threshold, config);
      for (const m of milestones) {
        avgAtMilestone[m] += (accuracyAt[m] || 0);
      }
      totalRuns++;
    }
  }

  const cells = milestones.map(m => {
    const avg = avgAtMilestone[m] / totalRuns;
    return (avg / 5 * 100).toFixed(0).padStart(3) + '%';
  });
  console.log(`  ${config.name.padEnd(16)} | ${cells.join('  | ')}  |`);
}

// ─── LaTeX output ─────────────────────────────────────────────────────

console.log('\n\n─── LATEX TABLE (copy-paste into article) ───\n');
console.log('\\begin{table}[h]');
console.log('\\caption{Ablation study: contribution of each TSMA component (accuracy \\%, averaged over 4 profiles × 20 runs)}');
console.log('\\label{tab:ablation}');
console.log('\\begin{tabular}{lcccccc}');
console.log('\\toprule');
console.log('\\textbf{Configuration} & \\textbf{IDF} & \\textbf{$\\gamma$} & \\textbf{Prof.~A} & \\textbf{Prof.~B} & \\textbf{Prof.~C} & \\textbf{Prof.~D} & \\textbf{Avg} \\\\');
console.log('\\midrule');

for (const config of configs) {
  const r = ablationResults[config.name];
  const idf = config.useIDF ? '\\checkmark' : '\\texttimes';
  const gamma = config.gamma > 0 ? config.gamma.toString() : '0';
  const cells = r.profileResults.map(p => (p.avgAccuracy / 5 * 100).toFixed(0) + '\\%');
  const avg = (r.overallAvg / 5 * 100).toFixed(0) + '\\%';

  if (config.name === 'TSMA full') {
    console.log(`${config.name} & ${idf} & ${gamma} & ${cells.join(' & ')} & \\textbf{${avg}} \\\\`);
  } else {
    console.log(`${config.name} & ${idf} & ${gamma} & ${cells.join(' & ')} & ${avg} \\\\`);
  }
}

console.log('\\bottomrule');
console.log('\\end{tabular}');
console.log('\\end{table}');

console.log('\n  Done. Use these results in the articles.\n');
