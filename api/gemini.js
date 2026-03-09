/**
 * Vercel Serverless Function — Gemini Proxy
 *
 * Auto-detected by Vercel when placed in /api/
 * Endpoint: POST /api/gemini
 *
 * Setup: Add GEMINI_API_KEY in Vercel Dashboard → Settings → Environment Variables
 */

const SYSTEM_PROMPT = `Tu es un expert padel de haut niveau. Tu analyses le message d'un joueur pour déterminer son profil de jeu.

Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans backticks, juste le JSON :

{
  "level": "debutant" | "intermediaire" | "avance" | "expert",
  "style": "controle" | "polyvalent" | "puissance",
  "position": "droite" | "gauche" | "les-deux",
  "freq": "occasionnel" | "regulier" | "intensif",
  "injury": "aucune" | "coude" | "epaule" | "genoux",
  "summary": "Résumé en 1 phrase du profil détecté, en français, chaleureux et expert"
}

Règles d'inférence :
- "débuter", "commencer", "nouveau", "6 mois" → level = "debutant"
- "1-3 ans", "progresse" → level = "intermediaire"
- "3+ ans", "compétition occasionnelle" → level = "avance"
- "tournois", "classé", "compétiteur" → level = "expert"
- "défense", "patience", "placement", "lob" → style = "controle"
- "smash", "attaque", "puissance", "agressif" → style = "puissance"
- Non précisé ou "un peu de tout" → style = "polyvalent"
- "côté droit", "revés" → position = "droite"
- "côté gauche", "volée au filet" → position = "gauche"
- Non précisé → position = "les-deux"
- "1 fois par mois", "de temps en temps" → freq = "occasionnel"
- "1-2 fois par semaine" → freq = "regulier"
- "3+ fois", "tous les jours" → freq = "intensif"
- "coude", "tennis elbow" → injury = "coude"
- "épaule", "poignet" → injury = "epaule"
- "genou", "cheville" → injury = "genoux"
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
    const { message } = req.body;
    if (!message || typeof message !== "string" || message.length > 2000) {
      return res.status(400).json({ error: "Invalid message" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY not configured" });
    }

    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ parts: [{ text: message }] }],
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

    return res.status(200).json(profile);
  } catch (err) {
    return res.status(500).json({ error: "Internal error" });
  }
}
