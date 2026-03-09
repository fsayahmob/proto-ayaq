/**
 * Vercel Serverless Function — Gemini Proxy for ISCIACUS (concept store styling)
 *
 * Endpoint: POST /api/gemini-isciacus
 *
 * Takes user context + behavioral signals, returns style direction for bundle composition.
 * Used for the "nudge" system and advanced recomposition, NOT for basic bundle generation
 * (which runs client-side for speed).
 */

const SYSTEM_PROMPT = `Tu es le styliste personnel d'ISCIACUS, un concept store masculin à Issy-les-Moulineaux. Tu connais parfaitement les marques : Carhartt WIP (workwear heritage), Universal Works (British relaxed tailoring), Portuguese Flannel (Mediterranean casual), Service Works (chef/service aesthetic), LES DEUX (Scandinavian minimalism), Norda (ultra-premium trail), Olow (French surf/skate), Homecore (Parisian comfort), Nudie Jeans (Swedish sustainable denim), Karhu (Finnish retro running), Bisous Skateboards (Parisian skate).

Tu analyses le contexte d'un utilisateur pour recommander une DIRECTION STYLISTIQUE, pas des produits spécifiques.

Réponds UNIQUEMENT avec un objet JSON valide :

{
  "axis": "workwear" | "minimal" | "street" | "elevated" | "sport" | "heritage",
  "mood": "description courte du mood en 1 phrase",
  "colors": ["couleur1", "couleur2", "couleur3"],
  "brands_priority": ["marque1", "marque2"],
  "avoid_brands": ["marque_à_éviter"],
  "slots": {
    "haut": "t-shirt" | "chemise" | "polo" | "sweat" | "pull",
    "veste": "veste" | "surchemise" | null,
    "bas": "pantalon" | "jean" | "short" | "chino",
    "chaussures": "sneakers_retro" | "sneakers_tech" | "trail" | "casual",
    "accessoire": "bob" | "casquette" | "sac" | null
  },
  "editorial": "Note éditoriale en 1-2 phrases, comme un styliste qui parle à son client. Ton décontracté mais expert. Tutoiement."
}

Axes stylistiques :
- workwear : Carhartt WIP, Service Works, Universal Works. Couleurs terre, coupes droites, matières brutes.
- minimal : LES DEUX, Homecore, JAGVI. Couleurs neutres, coupes slim, matières fluides.
- street : Bisous Skateboards, Carhartt WIP, Olow. Couleurs vives, prints, sneakers colorées.
- elevated : Portuguese Flannel, Universal Works, LES DEUX. Textures riches, coupes structurées, tons chauds.
- sport : Norda, Karhu, Carhartt WIP. Tech fabrics, coupes fonctionnelles, contraste.
- heritage : Nudie Jeans, Universal Works, Outland. Denim, toile, patine, vintage.

Règles :
- Matin semaine → elevated ou minimal
- Soir/weekend → workwear, street, ou heritage
- Pluie → privilégier vestes, éviter shorts
- Chaud (>22°) → pas de veste, shorts possibles, chemises légères
- Froid (<8°) → veste obligatoire, pulls, couches
- Si l'utilisateur swipe right souvent sur une marque → la prioriser
- Si l'utilisateur évite un type de pièce → l'exclure du slot`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { context, signals } = req.body;
    if (!context) {
      return res.status(400).json({ error: "Missing context" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY not configured" });
    }

    let userMessage = `Contexte : ${context.day}, ${context.time}, ${context.temp}°C, ${context.weather} à Paris.`;

    if (signals) {
      if (signals.preferredBrands && Object.keys(signals.preferredBrands).length > 0) {
        const top = Object.entries(signals.preferredBrands)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([b]) => b);
        userMessage += ` Marques préférées : ${top.join(", ")}.`;
      }
      if (signals.avoidedTypes && signals.avoidedTypes.length > 0) {
        userMessage += ` Évite : ${signals.avoidedTypes.join(", ")}.`;
      }
      if (signals.swipeCount) {
        userMessage += ` ${signals.swipeCount} looks vus.`;
      }
    }

    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ parts: [{ text: userMessage }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 400,
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

    let direction;
    try {
      direction = JSON.parse(text);
    } catch {
      direction = {
        axis: "workwear",
        mood: "Look urbain décontracté",
        colors: ["noir", "kaki", "écru"],
        brands_priority: ["CARHARTT W.I.P", "UNIVERSAL WORKS"],
        avoid_brands: [],
        slots: { haut: "t-shirt", veste: "veste", bas: "pantalon", chaussures: "sneakers_retro", accessoire: null },
        editorial: "On part sur un classique workwear, ça marche toujours."
      };
    }

    return res.status(200).json(direction);
  } catch (err) {
    return res.status(500).json({ error: "Internal error" });
  }
}
