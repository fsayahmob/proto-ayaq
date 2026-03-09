/**
 * Vercel Serverless Function — Gemini Proxy
 *
 * Auto-detected by Vercel when placed in /api/
 * Endpoint: POST /api/gemini
 *
 * Setup: Add GEMINI_API_KEY in Vercel Dashboard → Settings → Environment Variables
 */

const SYSTEM_PROMPT = `Tu es un expert padel de haut niveau. Tu analyses le message d'un joueur pour déterminer son profil de jeu ET les tags produit qui correspondent à ses besoins.

Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans backticks, juste le JSON :

{
  "level": "debutant" | "intermediaire" | "avance" | "expert",
  "style": "controle" | "polyvalent" | "puissance",
  "position": "droite" | "gauche" | "les-deux",
  "freq": "occasionnel" | "regulier" | "intensif",
  "injury": "aucune" | "coude" | "epaule" | "genoux",
  "tags": ["tag1", "tag2", ...],
  "summary": "Résumé en 1 phrase du profil détecté, en français, chaleureux et expert"
}

Tags disponibles (choisis ceux qui correspondent au profil du joueur, 3-8 tags) :
debutant, intermediaire, avance, expert, pro, leger, confort, tolerant, sweet-spot, progression,
controle, defense, spin, ronde, maniable, basse, effet, placement, patience,
polyvalent, equilibre, stable,
puissance, diamant, attaque, smash, agressif, explosif,
carbone, premium, competition, precision, toucher, ferme,
protection, genoux, blessure, amorti, anti-vibration,
femme, homme, grip, transpiration, durable, intensif, respirant, dynamique, lateral

Règles d'inférence :
- "débuter", "commencer", "nouveau", "6 mois" → level = "debutant", tags incluent "debutant","confort","tolerant","progression"
- "1-3 ans", "progresse" → level = "intermediaire", tags incluent "intermediaire","progression"
- "3+ ans", "compétition occasionnelle" → level = "avance", tags incluent "avance","competition"
- "tournois", "classé", "compétiteur" → level = "expert", tags incluent "expert","pro","competition"
- "défense", "patience", "placement", "lob" → style = "controle", tags incluent "controle","defense","placement","patience"
- "smash", "attaque", "puissance", "agressif" → style = "puissance", tags incluent "puissance","attaque","smash","explosif"
- Non précisé ou "un peu de tout" → style = "polyvalent", tags incluent "polyvalent","equilibre"
- "côté droit", "revés" → position = "droite"
- "côté gauche", "volée au filet" → position = "gauche"
- Non précisé → position = "les-deux"
- "1 fois par mois", "de temps en temps" → freq = "occasionnel"
- "1-2 fois par semaine" → freq = "regulier"
- "3+ fois", "tous les jours" → freq = "intensif", tags incluent "intensif","durable"
- "coude", "tennis elbow" → injury = "coude", tags incluent "confort","anti-vibration"
- "épaule", "poignet" → injury = "epaule", tags incluent "leger","confort"
- "genou", "cheville" → injury = "genoux", tags incluent "amorti","protection","genoux"
- Aucune douleur → injury = "aucune"

Si une info manque, utilise la valeur la plus probable.
Le summary doit être personnel et encourageant.`;

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { message, currentProfile } = req.body;
    if (!message || typeof message !== "string" || message.length > 2000) {
      return res.status(400).json({ error: "Invalid message" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY not configured" });
    }

    // Build prompt: if refining an existing profile, include context
    let userText = message;
    if (currentProfile && typeof currentProfile === "object") {
      userText = `Profil actuel du joueur : level=${currentProfile.level}, style=${currentProfile.style}, position=${currentProfile.position}, freq=${currentProfile.freq}, injury=${currentProfile.injury}.\n\nLe joueur demande maintenant : "${message}"\n\nMets à jour son profil en tenant compte de sa demande. Ne change que les champs concernés par sa demande, garde les autres identiques.`;
    }

    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ parts: [{ text: userText }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 300,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (!geminiResp.ok) {
      return res.status(502).json({ error: "Gemini API error", status: geminiResp.status });
    }

    const geminiData = await geminiResp.json();
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

    let profile;
    try {
      profile = JSON.parse(text);
    } catch {
      profile = {
        level: "intermediaire", style: "polyvalent", position: "les-deux",
        freq: "regulier", injury: "aucune", summary: "Profil standard détecté."
      };
    }

    // Validate enum values
    const valid = {
      level: ["debutant", "intermediaire", "avance", "expert"],
      style: ["controle", "polyvalent", "puissance"],
      position: ["droite", "gauche", "les-deux"],
      freq: ["occasionnel", "regulier", "intensif"],
      injury: ["aucune", "coude", "epaule", "genoux"],
    };

    for (const [key, allowed] of Object.entries(valid)) {
      if (!allowed.includes(profile[key])) {
        profile[key] = allowed[Math.floor(allowed.length / 2)];
      }
    }

    // Ensure tags is an array of strings
    if (!Array.isArray(profile.tags)) {
      profile.tags = [];
    } else {
      profile.tags = profile.tags.filter(t => typeof t === "string").slice(0, 15);
    }

    return res.status(200).json(profile);
  } catch (err) {
    return res.status(500).json({ error: "Internal error" });
  }
}
