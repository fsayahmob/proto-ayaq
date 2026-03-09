/**
 * Cloudflare Worker — Gemini Proxy for Padel Configurator
 *
 * Hides the API key server-side. Free tier = 100k requests/day.
 *
 * DEPLOY:
 * 1. npm install -g wrangler
 * 2. wrangler login
 * 3. cd worker && wrangler deploy
 * 4. wrangler secret put GEMINI_API_KEY   (paste your key)
 * 5. Set WORKER_URL in padel.html:
 *    window.__PADEL_WORKER_URL = "https://padel-ai-proxy.<your-subdomain>.workers.dev/api/gemini"
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
- Si le joueur mentionne "débuter", "commencer", "nouveau", "6 mois" → level = "debutant"
- Si "1-3 ans", "progresse", "s'améliore" → level = "intermediaire"
- Si "3+ ans", "compétition occasionnelle" → level = "avance"
- Si "tournois", "classé", "compétiteur" → level = "expert"
- Si "défense", "patience", "placement", "lob" → style = "controle"
- Si "smash", "attaque", "puissance", "agressif" → style = "puissance"
- Si non précisé ou "un peu de tout" → style = "polyvalent"
- Si "côté droit", "revés" → position = "droite"
- Si "côté gauche", "volée", "attaque au filet" → position = "gauche"
- Si non précisé → position = "les-deux"
- Si "1 fois par mois", "de temps en temps" → freq = "occasionnel"
- Si "1-2 fois par semaine" → freq = "regulier"
- Si "3+ fois", "tous les jours", "intensif" → freq = "intensif"
- Si "coude", "tennis elbow", "avant-bras" → injury = "coude"
- Si "épaule", "poignet" → injury = "epaule"
- Si "genou", "cheville" → injury = "genoux"
- Si aucune douleur mentionnée → injury = "aucune"

Si une information manque, utilise la valeur la plus probable pour un joueur typique.
Le summary doit être personnel et encourageant, ex: "Joueur intermédiaire avec un jeu défensif solide — on va optimiser votre contrôle côté droit."`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "POST only" }), {
        status: 405,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/api/gemini") {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    try {
      const { message } = await request.json();
      if (!message || typeof message !== "string" || message.length > 2000) {
        return new Response(JSON.stringify({ error: "Invalid message" }), {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }

      const apiKey = env.GEMINI_API_KEY;
      if (!apiKey) {
        return new Response(JSON.stringify({ error: "API key not configured" }), {
          status: 500,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
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
        const errText = await geminiResp.text();
        return new Response(
          JSON.stringify({ error: "Gemini API error", status: geminiResp.status }),
          {
            status: 502,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          }
        );
      }

      const geminiData = await geminiResp.json();
      const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

      let profile;
      try {
        profile = JSON.parse(text);
      } catch {
        profile = { level: "intermediaire", style: "polyvalent", position: "les-deux", freq: "regulier", injury: "aucune", summary: "Profil standard détecté." };
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

      return new Response(JSON.stringify(profile), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Internal error" }),
        {
          status: 500,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        }
      );
    }
  },
};
