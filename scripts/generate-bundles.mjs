#!/usr/bin/env node
/**
 * ISCIACUS Bundle Generator
 *
 * Fetches all products from Shopify Storefront API, analyzes them,
 * tags them with style/occasion/silhouette/season metadata,
 * and generates coherent bundles with alternatives.
 *
 * Output: ../data/isciacus-bundles.json (compact RAG for Gemini)
 *
 * Usage: node scripts/generate-bundles.mjs
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '..', 'data');
const OUTPUT_FILE = join(OUTPUT_DIR, 'isciacus-bundles.json');

// ─── Shopify Config ──────────────────────────────────────────────────
const SHOPIFY_DOMAIN = 'isciacus-store.myshopify.com';
const STOREFRONT_TOKEN = '09f1f52ca2f16b7e1a115cc2d41b1b78';
const API_VERSION = '2024-01';
const ENDPOINT = `https://${SHOPIFY_DOMAIN}/api/${API_VERSION}/graphql.json`;

// ─── GraphQL ─────────────────────────────────────────────────────────
const PRODUCTS_QUERY = `query($cursor: String) {
  products(first: 250, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id title handle productType vendor availableForSale
      tags
      priceRange { minVariantPrice { amount currencyCode } }
      images(first: 3) { edges { node { url altText } } }
      variants(first: 20) { edges { node {
        id title availableForSale
        price { amount currencyCode }
        selectedOptions { name value }
      } } }
    } }
  }
}`;

async function shopifyFetch(query, variables = {}) {
  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!resp.ok) throw new Error(`Shopify API ${resp.status}`);
  return resp.json();
}

async function fetchAllProducts() {
  let all = [];
  let cursor = null;
  let page = 1;
  do {
    console.log(`  Fetching page ${page}...`);
    const data = await shopifyFetch(PRODUCTS_QUERY, { cursor });
    const edges = data.data.products.edges;
    const products = edges
      .map(e => e.node)
      .filter(p => p.availableForSale);
    all = all.concat(products);
    const pageInfo = data.data.products.pageInfo;
    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
    page++;
  } while (cursor);
  return all;
}

// ─── Brand → Style DNA Mapping ──────────────────────────────────────
// Based on deep research of each brand's positioning
const BRAND_STYLE = {
  'CARHARTT W.I.P': { styles: ['workwear', 'street'], silhouette: 'relaxed', formality: 'decontracte' },
  'CARHARTT WIP': { styles: ['workwear', 'street'], silhouette: 'relaxed', formality: 'decontracte' },
  'UNIVERSAL WORKS': { styles: ['workwear', 'elevated'], silhouette: 'relaxed', formality: 'smart-casual' },
  'PORTUGUESE FLANNEL': { styles: ['elevated', 'heritage'], silhouette: 'regular', formality: 'smart-casual' },
  'SERVICE WORKS': { styles: ['workwear', 'street'], silhouette: 'relaxed', formality: 'decontracte' },
  'LES DEUX': { styles: ['minimal', 'elevated'], silhouette: 'regular', formality: 'smart-casual' },
  'NORDA': { styles: ['gorpcore'], silhouette: 'regular', formality: 'decontracte' },
  'OLOW': { styles: ['french-casual', 'street'], silhouette: 'regular', formality: 'decontracte' },
  'HOMECORE': { styles: ['french-casual', 'street'], silhouette: 'relaxed', formality: 'decontracte' },
  'NUDIE JEANS': { styles: ['heritage'], silhouette: 'regular', formality: 'decontracte' },
  'NUDIE JEANS CO': { styles: ['heritage'], silhouette: 'regular', formality: 'decontracte' },
  'KARHU': { styles: ['gorpcore', 'heritage'], silhouette: 'regular', formality: 'decontracte' },
  'BISOUS SKATEBOARDS': { styles: ['street'], silhouette: 'relaxed', formality: 'decontracte' },
  'JAGVI': { styles: ['minimal', 'elevated'], silhouette: 'structured', formality: 'smart-casual' },
  'JAGVI RIVE GAUCHE': { styles: ['minimal', 'elevated'], silhouette: 'structured', formality: 'smart-casual' },
  'OUTLAND DENIM': { styles: ['heritage'], silhouette: 'regular', formality: 'decontracte' },
  'RECEPTION': { styles: ['street', 'french-casual'], silhouette: 'relaxed', formality: 'decontracte' },
  'NEW BALANCE': { styles: ['street', 'heritage'], silhouette: 'regular', formality: 'decontracte' },
  'RAINS': { styles: ['minimal', 'gorpcore'], silhouette: 'regular', formality: 'decontracte' },
  'VEJA': { styles: ['minimal', 'french-casual'], silhouette: 'regular', formality: 'smart-casual' },
  'SAMSOE SAMSOE': { styles: ['minimal'], silhouette: 'regular', formality: 'smart-casual' },
  'SAMSØE SAMSØE': { styles: ['minimal'], silhouette: 'regular', formality: 'smart-casual' },
  'MINIMUM': { styles: ['minimal'], silhouette: 'structured', formality: 'smart-casual' },
  'ISCIACUS': { styles: ['french-casual'], silhouette: 'regular', formality: 'decontracte' },
};

// ─── Product Type → Slot + Season + Occasion ────────────────────────
const TYPE_META = {
  'T-Shirt':          { slot: 'HAUT', seasons: ['ete', 'mi-saison'], occasions: ['weekend', 'sortie', 'sport-outdoor'] },
  'Chemises':         { slot: 'HAUT', seasons: ['mi-saison', 'ete'], occasions: ['bureau-casual', 'date', 'sortie'] },
  'Polos':            { slot: 'HAUT', seasons: ['ete', 'mi-saison'], occasions: ['bureau-casual', 'date', 'weekend'] },
  'Sweats':           { slot: 'HAUT', seasons: ['mi-saison', 'hiver'], occasions: ['weekend', 'voyage'] },
  'Pulls':            { slot: 'HAUT', seasons: ['hiver', 'mi-saison'], occasions: ['bureau-casual', 'date', 'weekend'] },
  'Vestes':           { slot: 'VESTE', seasons: ['mi-saison', 'hiver'], occasions: ['bureau-casual', 'sortie', 'voyage'] },
  'Surchemises':      { slot: 'VESTE', seasons: ['mi-saison'], occasions: ['bureau-casual', 'weekend', 'sortie'] },
  'Pantalons':        { slot: 'BAS', seasons: ['toute-saison'], occasions: ['bureau-casual', 'date', 'sortie'] },
  'Jeans':            { slot: 'BAS', seasons: ['toute-saison'], occasions: ['weekend', 'sortie', 'date'] },
  'Shorts & Bermudas':{ slot: 'BAS', seasons: ['ete'], occasions: ['weekend', 'voyage'] },
  'Short de Bain':    { slot: null, seasons: ['ete'], occasions: [] }, // Excluded from bundles
  'Chaussures':       { slot: 'CHAUSSURES', seasons: ['toute-saison'], occasions: ['bureau-casual', 'weekend', 'sortie', 'date'] },
  'Chaussures Norda': { slot: 'CHAUSSURES', seasons: ['toute-saison'], occasions: ['sport-outdoor', 'weekend'] },
  'Bobs':             { slot: 'ACCESSOIRE', seasons: ['ete'], occasions: ['weekend', 'voyage'] },
  'Casquettes':       { slot: 'ACCESSOIRE', seasons: ['ete', 'mi-saison'], occasions: ['weekend', 'sport-outdoor'] },
  'Sacs':             { slot: 'ACCESSOIRE', seasons: ['toute-saison'], occasions: ['bureau-casual', 'voyage'] },
  'Maroquinerie':     { slot: 'ACCESSOIRE', seasons: ['toute-saison'], occasions: ['bureau-casual', 'date'] },
  'Ceintures':        { slot: 'ACCESSOIRE', seasons: ['toute-saison'], occasions: ['bureau-casual', 'date'] },
};

// Types excluded from bundles entirely
const SKIP_TYPES = new Set([
  'Lifestyle & Objets', 'Sous-Vêtements', 'Chaussettes', 'Bijoux',
  'Short de Bain', 'Accessoire',
]);

// ─── Color Extraction ────────────────────────────────────────────────
const COLOR_KEYWORDS = {
  NOIR:   ['noir','black','dark','charcoal','storm','midnight','onyx','jet','ebony'],
  BLANC:  ['blanc','white','ecru','cream','ivory','off-white','bone','natural','off white','snow'],
  MARINE: ['navy','marine','bleu','blue','indigo','ink','slate','deep blue','cobalt','denim blue'],
  VERT:   ['olive','green','vert','khaki','kaki','pine','lichen','sage','smoke green','rosemary','forest','moss','army'],
  TERRE:  ['brown','chocolat','cognac','tan','camel','walnut','sand','beige','stone','moutarde','palisander','cinder','rust','tobacco','coffee','caramel','toffee','mustard','ochre','clay','terracotta'],
  ROUGE:  ['red','orange','salmon','vermillion','rose','pink','violet','purple','burgundy','bordeaux','wine','berry','coral','brick'],
  GRIS:   ['grey','gray','gris','silver','mist','ash','smoke','light grey','heather','marl','cement'],
};

function extractColors(product) {
  const colors = new Set();

  // From variant options
  for (const v of (product.variants?.edges || [])) {
    const opts = v.node.selectedOptions || [];
    for (const opt of opts) {
      if (/couleur|color|colour/i.test(opt.name)) {
        const val = opt.value.toLowerCase();
        for (const [family, keywords] of Object.entries(COLOR_KEYWORDS)) {
          if (keywords.some(k => val.includes(k))) {
            colors.add(family);
          }
        }
      }
    }
  }

  // Fallback: title
  if (colors.size === 0) {
    const title = product.title.toLowerCase();
    for (const [family, keywords] of Object.entries(COLOR_KEYWORDS)) {
      if (keywords.some(k => title.includes(k))) {
        colors.add(family);
      }
    }
  }

  return colors.size > 0 ? [...colors] : ['NOIR'];
}

// ─── Silhouette from title/tags ──────────────────────────────────────
const SILHOUETTE_KEYWORDS = {
  relaxed: ['loose', 'oversized', 'baggy', 'wide', 'large', 'relaxed', 'ample', 'oversize', 'boxy'],
  structured: ['slim', 'fitted', 'tailored', 'ajusté', 'skinny', 'étroit', 'narrow'],
  regular: ['regular', 'straight', 'classic', 'standard', 'droit'],
};

function extractSilhouette(product, brandDefault) {
  const text = `${product.title} ${(product.tags || []).join(' ')}`.toLowerCase();
  for (const [sil, keywords] of Object.entries(SILHOUETTE_KEYWORDS)) {
    if (keywords.some(k => text.includes(k))) return sil;
  }
  // Check variant titles
  for (const v of (product.variants?.edges || [])) {
    const vTitle = (v.node.title || '').toLowerCase();
    for (const [sil, keywords] of Object.entries(SILHOUETTE_KEYWORDS)) {
      if (keywords.some(k => vTitle.includes(k))) return sil;
    }
  }
  return brandDefault || 'regular';
}

// ─── Analyze a single product ────────────────────────────────────────
function analyzeProduct(product) {
  const type = product.productType;
  const vendor = product.vendor?.toUpperCase();
  const typeMeta = TYPE_META[type];
  const brandMeta = BRAND_STYLE[vendor] || BRAND_STYLE[product.vendor] || null;

  if (!typeMeta || !typeMeta.slot) return null; // Skip unbundleable products
  if (SKIP_TYPES.has(type)) return null;

  const price = parseFloat(product.priceRange?.minVariantPrice?.amount || '0');
  if (price === 0) return null;

  const colors = extractColors(product);
  const silhouette = extractSilhouette(product, brandMeta?.silhouette);
  const styles = brandMeta?.styles || ['french-casual'];
  const formality = brandMeta?.formality || 'decontracte';
  const seasons = typeMeta.seasons;
  const occasions = typeMeta.occasions;

  // Extract available sizes
  const sizes = [];
  for (const v of (product.variants?.edges || [])) {
    if (!v.node.availableForSale) continue;
    const sizeOpt = v.node.selectedOptions?.find(o => /taille|size/i.test(o.name));
    if (sizeOpt && !sizes.includes(sizeOpt.value)) sizes.push(sizeOpt.value);
  }

  // First variant ID (for cart)
  const firstVariant = product.variants?.edges?.find(v => v.node.availableForSale);
  const variantId = firstVariant?.node?.id || null;

  // Image
  const image = product.images?.edges?.[0]?.node?.url || null;

  return {
    id: product.id,
    variantId,
    handle: product.handle,
    title: product.title,
    vendor: product.vendor,
    type,
    slot: typeMeta.slot,
    price,
    image: image ? `${image}&width=400` : null,
    colors,
    silhouette,
    styles,
    formality,
    seasons,
    occasions,
    sizes,
    tags: [
      ...styles,
      silhouette,
      formality,
      ...seasons,
      ...occasions,
      ...colors.map(c => `color-${c.toLowerCase()}`),
      typeMeta.slot.toLowerCase(),
    ],
  };
}

// ─── Color Palettes ──────────────────────────────────────────────────
const PALETTES = {
  'monochrome':   { colors: ['NOIR', 'BLANC', 'GRIS'], mood: 'Monochrome urbain' },
  'classic-navy': { colors: ['NOIR', 'MARINE', 'BLANC'], mood: 'Classique marine' },
  'earth':        { colors: ['TERRE', 'VERT', 'BLANC'], mood: 'Tons terre' },
  'maritime':     { colors: ['MARINE', 'BLANC', 'TERRE'], mood: 'Maritime décontracté' },
  'urban-green':  { colors: ['NOIR', 'VERT', 'TERRE'], mood: 'Urban outdoor' },
  'soft-neutral': { colors: ['GRIS', 'MARINE', 'BLANC'], mood: 'Neutre doux' },
  'warm-neutral': { colors: ['NOIR', 'TERRE', 'GRIS'], mood: 'Neutre chaud' },
  'safari':       { colors: ['VERT', 'TERRE', 'NOIR'], mood: 'Safari urbain' },
};

const UNIVERSAL_COLORS = new Set(['NOIR', 'BLANC', 'GRIS']);

function colorsCompatible(c1, c2) {
  if (UNIVERSAL_COLORS.has(c1) || UNIVERSAL_COLORS.has(c2)) return true;
  // Check if any palette contains both
  return Object.values(PALETTES).some(p => p.colors.includes(c1) && p.colors.includes(c2));
}

function findMatchingPalette(colors) {
  const colorSet = new Set(colors);
  for (const [name, pal] of Object.entries(PALETTES)) {
    const match = pal.colors.filter(c => colorSet.has(c)).length;
    if (match >= 2) return name;
  }
  return 'monochrome';
}

// ─── Style Compatibility Rules ───────────────────────────────────────
// Which styles can coexist in a bundle
const STYLE_COMPAT = {
  'workwear':      ['workwear', 'heritage', 'street', 'french-casual'],
  'minimal':       ['minimal', 'elevated', 'french-casual'],
  'street':        ['street', 'workwear', 'french-casual', 'gorpcore'],
  'elevated':      ['elevated', 'minimal', 'french-casual', 'heritage'],
  'gorpcore':      ['gorpcore', 'street', 'workwear'],
  'heritage':      ['heritage', 'workwear', 'elevated', 'french-casual'],
  'french-casual': ['french-casual', 'minimal', 'elevated', 'workwear', 'heritage', 'street'],
};

function stylesCompatible(s1, s2) {
  return (STYLE_COMPAT[s1] || []).includes(s2);
}

// ─── Occasion × Style Matrix ────────────────────────────────────────
// Defines which style axes work for each occasion
const OCCASION_STYLES = {
  'bureau-casual':  ['minimal', 'elevated', 'french-casual'],
  'weekend':        ['workwear', 'street', 'french-casual', 'heritage', 'gorpcore'],
  'sortie':         ['street', 'elevated', 'french-casual', 'heritage'],
  'date':           ['elevated', 'minimal', 'french-casual'],
  'voyage':         ['workwear', 'french-casual', 'gorpcore', 'minimal'],
  'sport-outdoor':  ['gorpcore', 'street', 'workwear'],
};

// ─── Bundle Generation ──────────────────────────────────────────────

function pickBest(candidates, targetStyle, targetColors, usedBrands) {
  if (candidates.length === 0) return null;

  const scored = candidates.map(p => {
    let score = 1;

    // Style match
    const styleMatch = p.styles.some(s => s === targetStyle);
    const styleCompat = p.styles.some(s => stylesCompatible(s, targetStyle));
    if (styleMatch) score += 5;
    else if (styleCompat) score += 2;
    else score -= 3;

    // Color match
    const colorMatch = p.colors.some(c => targetColors.includes(c) || UNIVERSAL_COLORS.has(c));
    const colorCompat = p.colors.every(c =>
      targetColors.some(tc => colorsCompatible(c, tc))
    );
    if (colorMatch) score += 3;
    else if (colorCompat) score += 1;
    else score -= 2;

    // Brand diversity bonus
    if (!usedBrands.has(p.vendor)) score += 2;

    // Penalize if brand already used twice
    if (usedBrands.has(p.vendor)) score -= 1;

    return { product: p, score: Math.max(0.1, score) };
  });

  // Sort by score, pick top
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.product || null;
}

function generateBundle(catalog, occasion, style, season, palette) {
  const paletteColors = PALETTES[palette]?.colors || ['NOIR', 'BLANC', 'GRIS'];

  // Filter products by season compatibility
  function seasonOk(p) {
    return p.seasons.includes(season) || p.seasons.includes('toute-saison');
  }

  // Filter products by occasion
  function occasionOk(p) {
    return p.occasions.includes(occasion);
  }

  const usedBrands = new Set();
  const items = {};

  // Pick HAUT
  const hauts = catalog.filter(p => p.slot === 'HAUT' && seasonOk(p) && occasionOk(p));
  const haut = pickBest(hauts, style, paletteColors, usedBrands);
  if (!haut) return null;
  items.haut = haut;
  usedBrands.add(haut.vendor);

  // Pick BAS
  const bas = catalog.filter(p => p.slot === 'BAS' && seasonOk(p) && occasionOk(p));
  const basItem = pickBest(bas, style, paletteColors, usedBrands);
  if (!basItem) return null;
  items.bas = basItem;
  usedBrands.add(basItem.vendor);

  // Pick CHAUSSURES
  const chaussures = catalog.filter(p => p.slot === 'CHAUSSURES' && seasonOk(p) && occasionOk(p));
  const shoe = pickBest(chaussures, style, paletteColors, usedBrands);
  if (!shoe) return null;
  items.chaussures = shoe;
  usedBrands.add(shoe.vendor);

  // Pick VESTE (optional in summer, required in winter)
  if (season !== 'ete') {
    const vestes = catalog.filter(p => p.slot === 'VESTE' && seasonOk(p));
    const veste = pickBest(vestes, style, paletteColors, usedBrands);
    if (veste) {
      items.veste = veste;
      usedBrands.add(veste.vendor);
    }
  }

  // Pick ACCESSOIRE (optional, 50% chance unless occasion needs it)
  const accProb = ['voyage', 'sport-outdoor'].includes(occasion) ? 0.7 : 0.4;
  if (Math.random() < accProb) {
    const accs = catalog.filter(p => p.slot === 'ACCESSOIRE' && seasonOk(p));
    const acc = pickBest(accs, style, paletteColors, usedBrands);
    if (acc) items.accessoire = acc;
  }

  // Validate: at least 3 items, silhouettes not clashing
  const itemList = Object.values(items);
  if (itemList.length < 3) return null;

  // Check silhouette coherence: no structured + relaxed clash
  const silhouettes = new Set(itemList.map(i => i.silhouette));
  if (silhouettes.has('structured') && silhouettes.has('relaxed')) {
    // Allow if most items are one or the other
    const relaxCount = itemList.filter(i => i.silhouette === 'relaxed').length;
    const structCount = itemList.filter(i => i.silhouette === 'structured').length;
    if (relaxCount > 1 && structCount > 1) return null; // Too conflicted
  }

  // Calculate total price
  const total = Math.round(itemList.reduce((sum, p) => sum + p.price, 0));

  // Determine dominant silhouette
  const silCounts = {};
  itemList.forEach(i => { silCounts[i.silhouette] = (silCounts[i.silhouette] || 0) + 1; });
  const dominantSilhouette = Object.entries(silCounts).sort((a, b) => b[1] - a[1])[0][0];

  // Find actual palette used
  const usedColors = [...new Set(itemList.flatMap(i => i.colors))];
  const actualPalette = findMatchingPalette(usedColors);

  return {
    style,
    occasion,
    season,
    palette: actualPalette,
    paletteMood: PALETTES[actualPalette]?.mood || 'Custom',
    silhouette: dominantSilhouette,
    formality: itemList.some(i => i.formality === 'smart-casual') ? 'smart-casual' : 'decontracte',
    total,
    items: Object.fromEntries(
      Object.entries(items).map(([slot, p]) => [slot, {
        id: p.id,
        variantId: p.variantId,
        handle: p.handle,
        title: p.title,
        vendor: p.vendor,
        type: p.type,
        price: p.price,
        colors: p.colors,
        silhouette: p.silhouette,
      }])
    ),
    tags: [
      style, occasion, season, actualPalette, dominantSilhouette,
      ...usedColors.map(c => `color-${c.toLowerCase()}`),
    ],
  };
}

// ─── Generate alternatives for each slot in a bundle ────────────────
function generateAlternatives(catalog, bundle, maxAlts = 3) {
  const alts = {};
  for (const [slot, item] of Object.entries(bundle.items)) {
    const candidates = catalog.filter(p =>
      p.slot === slot.toUpperCase() &&
      p.handle !== item.handle &&
      p.styles.some(s => stylesCompatible(s, bundle.style)) &&
      p.colors.some(c =>
        Object.values(bundle.items).some(bi =>
          bi.colors.some(bc => colorsCompatible(c, bc))
        ) || UNIVERSAL_COLORS.has(c)
      )
    );

    // Score and sort
    const scored = candidates.map(p => {
      let score = 0;
      if (p.styles.includes(bundle.style)) score += 3;
      if (p.silhouette === bundle.silhouette) score += 2;
      if (p.vendor !== item.vendor) score += 1; // Brand variety
      return { ...p, _score: score };
    });
    scored.sort((a, b) => b._score - a._score);

    alts[slot] = scored.slice(0, maxAlts).map(p => ({
      id: p.id,
      variantId: p.variantId,
      handle: p.handle,
      title: p.title,
      vendor: p.vendor,
      price: p.price,
      colors: p.colors,
    }));
  }
  return alts;
}

// ─── Deduplication ──────────────────────────────────────────────────
function bundleFingerprint(bundle) {
  return Object.values(bundle.items)
    .map(i => i.handle)
    .sort()
    .join('|');
}

// ─── Editorial Generation ───────────────────────────────────────────
const EDITORIAL_TEMPLATES = {
  'workwear': {
    'bureau-casual': 'Workwear revisité pour le bureau — matières brutes, coupe relaxed, efficacité tranquille.',
    'weekend': 'Le weekend en mode chantier chic — utilitaire sans forcer.',
    'sortie': 'Soirée workwear — le chore coat qui fait tout le boulot.',
    'default': 'Utilitaire urbain, coupes franches, zéro superflu.',
  },
  'minimal': {
    'bureau-casual': 'Clean et pro — le Scandi qui passe en réunion comme en afterwork.',
    'date': 'Minimalisme magnétique — less is more, surtout en date.',
    'default': 'Lignes pures, palette neutre, impact maximum.',
  },
  'street': {
    'weekend': 'Street décontracté — entre skatepark et terrasse.',
    'sortie': 'Le street qui sort — graphique sans être criard.',
    'default': 'Énergie urbaine, prints subtils, silhouette relax.',
  },
  'elevated': {
    'bureau-casual': 'Smart-casual texturé — le bureau sans cravate, avec du caractère.',
    'date': 'Élégance décontractée — juste assez habillé pour impressionner.',
    'sortie': 'Elevated casual — quand le détail fait la différence.',
    'default': 'Matières nobles, coupes pensées, allure naturelle.',
  },
  'gorpcore': {
    'sport-outdoor': 'Trail-to-city — performance et style en seamless.',
    'weekend': 'Gorpcore du dimanche — technique mais pas costume de ski.',
    'default': 'Outdoor urbain — les pieds sur le bitume, l\'esprit en montagne.',
  },
  'heritage': {
    'weekend': 'Denim et patine — le weekend a du vécu.',
    'sortie': 'Heritage nocturne — le raw denim sous les néons.',
    'default': 'Pièces intemporelles, matières qui vieillissent bien.',
  },
  'french-casual': {
    'bureau-casual': 'Casual parisien — sans effort, jamais négligé.',
    'weekend': 'Décontracté à la française — brunch, marché, flânerie.',
    'date': 'Le charme français — naturel, jamais forcé.',
    'default': 'L\'aisance parisienne en toute circonstance.',
  },
};

function generateEditorialText(style, occasion) {
  const styleTemplates = EDITORIAL_TEMPLATES[style] || EDITORIAL_TEMPLATES['french-casual'];
  return styleTemplates[occasion] || styleTemplates['default'] || 'Un look pensé pour toi.';
}

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('🏪 ISCIACUS Bundle Generator');
  console.log('═══════════════════════════════════════\n');

  // 1. Fetch all products
  console.log('1. Fetching products from Shopify...');
  const rawProducts = await fetchAllProducts();
  console.log(`   → ${rawProducts.length} products fetched\n`);

  // 2. Analyze and tag
  console.log('2. Analyzing products...');
  const catalog = rawProducts
    .map(analyzeProduct)
    .filter(Boolean);

  console.log(`   → ${catalog.length} bundleable products (${rawProducts.length - catalog.length} excluded)\n`);

  // Stats
  const slotCounts = {};
  const styleCounts = {};
  const vendorCounts = {};
  catalog.forEach(p => {
    slotCounts[p.slot] = (slotCounts[p.slot] || 0) + 1;
    p.styles.forEach(s => { styleCounts[s] = (styleCounts[s] || 0) + 1; });
    vendorCounts[p.vendor] = (vendorCounts[p.vendor] || 0) + 1;
  });

  console.log('   Slots:', JSON.stringify(slotCounts));
  console.log('   Styles:', JSON.stringify(styleCounts));
  console.log('   Vendors:', JSON.stringify(vendorCounts));
  console.log();

  // 3. Generate bundles
  console.log('3. Generating bundles...');
  const bundles = [];
  const seen = new Set();
  const SEASONS = ['ete', 'mi-saison', 'hiver'];
  const MAX_ATTEMPTS_PER_COMBO = 5;
  const TARGET_BUNDLES_PER_COMBO = 2;

  for (const occasion of Object.keys(OCCASION_STYLES)) {
    const validStyles = OCCASION_STYLES[occasion];
    for (const style of validStyles) {
      for (const season of SEASONS) {
        const paletteKeys = Object.keys(PALETTES);
        let generated = 0;

        for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_COMBO && generated < TARGET_BUNDLES_PER_COMBO; attempt++) {
          const palette = paletteKeys[Math.floor(Math.random() * paletteKeys.length)];
          const bundle = generateBundle(catalog, occasion, style, season, palette);
          if (!bundle) continue;

          const fp = bundleFingerprint(bundle);
          if (seen.has(fp)) continue;
          seen.add(fp);

          // Generate editorial
          bundle.editorial = generateEditorialText(style, occasion);

          // Generate alternatives
          bundle.alternatives = generateAlternatives(catalog, bundle);

          bundles.push(bundle);
          generated++;
        }
      }
    }
  }

  console.log(`   → ${bundles.length} unique bundles generated\n`);

  // Stats by axis
  const byStyle = {};
  const byOccasion = {};
  const bySeason = {};
  bundles.forEach(b => {
    byStyle[b.style] = (byStyle[b.style] || 0) + 1;
    byOccasion[b.occasion] = (byOccasion[b.occasion] || 0) + 1;
    bySeason[b.season] = (bySeason[b.season] || 0) + 1;
  });
  console.log('   By style:', JSON.stringify(byStyle));
  console.log('   By occasion:', JSON.stringify(byOccasion));
  console.log('   By season:', JSON.stringify(bySeason));
  console.log();

  // 4. Build output
  console.log('4. Writing output...');

  const output = {
    generated: new Date().toISOString(),
    store: SHOPIFY_DOMAIN,
    stats: {
      totalProducts: rawProducts.length,
      bundleableProducts: catalog.length,
      totalBundles: bundles.length,
      byStyle,
      byOccasion,
      bySeason,
    },
    // Compact product index (for Gemini RAG context)
    products: catalog.map(p => ({
      id: p.id,
      variantId: p.variantId,
      handle: p.handle,
      title: p.title,
      vendor: p.vendor,
      type: p.type,
      slot: p.slot,
      price: p.price,
      colors: p.colors,
      styles: p.styles,
      silhouette: p.silhouette,
      formality: p.formality,
      seasons: p.seasons,
      occasions: p.occasions,
      tags: p.tags,
    })),
    bundles,
  };

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  const sizeMB = (Buffer.byteLength(JSON.stringify(output)) / 1024 / 1024).toFixed(2);
  console.log(`   → ${OUTPUT_FILE}`);
  console.log(`   → ${sizeMB} MB\n`);

  console.log('✅ Done!\n');

  // Show sample bundle
  if (bundles.length > 0) {
    const sample = bundles[Math.floor(Math.random() * bundles.length)];
    console.log('─── Sample Bundle ───────────────────────');
    console.log(`Style: ${sample.style} | Occasion: ${sample.occasion} | Season: ${sample.season}`);
    console.log(`Palette: ${sample.paletteMood} | Silhouette: ${sample.silhouette} | Total: ${sample.total}€`);
    console.log(`Editorial: "${sample.editorial}"`);
    for (const [slot, item] of Object.entries(sample.items)) {
      const altCount = sample.alternatives[slot]?.length || 0;
      console.log(`  ${slot.toUpperCase()}: ${item.vendor} — ${item.title} (${item.price}€) [${item.colors.join(',')}] +${altCount} alts`);
    }
  }
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
