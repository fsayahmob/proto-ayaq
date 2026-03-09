/**
 * Vercel Serverless Function — Gemini Proxy for AYAQ (outdoor layering)
 *
 * Endpoint: POST /api/gemini-ayaq
 *
 * Setup: Uses same GEMINI_API_KEY in Vercel Dashboard
 */

const SYSTEM_PROMPT = `Tu es un expert outdoor et montagne de haut niveau. Tu analyses le message d'un utilisateur pour déterminer son profil d'activité ET les tags produit qui correspondent à ses besoins en système de couches (layering).

Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans backticks, juste le JSON :

{
  "activity": "hiking" | "ski-touring" | "alpine" | "trail" | "ski",
  "season": "winter" | "spring" | "summer" | "autumn",
  "condition": "rain" | "wind" | "cold" | "mixed" | "intense",
  "level": "beginner" | "regular" | "expert",
  "tags": ["tag1", "tag2", ...],
  "summary": "Réponse conversationnelle en 1-2 phrases, comme un expert montagne qui parle à un passionné. Reformule ce que tu as compris de son besoin et annonce ce que tu vas lui proposer. JAMAIS de format 'Profil X · Y'. Exemple : 'Compris, un trek hivernal en conditions humides ! Je te prépare un système de couches chaud et respirant pour rester au sec.'"
}

Tags disponibles (choisis ceux qui correspondent au profil, 3-8 tags) :
hiking, trail, ski-touring, alpinisme, ski, extreme, expedition,
hivernal, froid, ete, printemps, automne, polyvalent,
pluie, imperméable, hardshell, softshell, coupe-vent, vent,
respirant, actif, effort, leger, ultraléger,
chaleur, polaire, merinos, duvet, isolation,
base, mid, outer, pants,
debutant, regulier, expert, technique, competition,
durable, confort, stretch, thermique,
tshirt, manches-courtes, manches-longues, sous-vetement,
veste, fleece, gilet, vest, doudoune, windbreaker,
pantalon

Règles d'inférence :
- "rando", "marche", "trek" → activity = "hiking", tags incluent "hiking","polyvalent"
- "ski de rando", "skimo" → activity = "ski-touring", tags incluent "ski-touring","respirant","technique"
- "alpinisme", "glacier", "sommet", "haute montagne" → activity = "alpine", tags incluent "alpinisme","extreme","expedition"
- "trail", "course", "running" → activity = "trail", tags incluent "trail","leger","respirant","actif"
- "ski alpin", "piste", "station" → activity = "ski", tags incluent "ski","froid","hivernal"
- "hiver", "neige", "froid" → season = "winter", tags incluent "hivernal","froid"
- "été", "chaud", "canicule" → season = "summer", tags incluent "ete","leger","respirant"
- "pluie", "mouillé", "imperméable" → condition = "rain", tags incluent "pluie","imperméable","hardshell"
- "vent", "tempête", "rafale" → condition = "wind", tags incluent "vent","coupe-vent"
- "effort intense", "transpiration" → condition = "intense", tags incluent "respirant","actif","effort"
- "débute", "commence", "premier" → level = "beginner", tags incluent "debutant","polyvalent","confort"
- "expert", "expédition", "compétition" → level = "expert", tags incluent "expert","technique","extreme"
- "base layer", "sous-vêtement", "mérinos", "première couche" → tags incluent "base","merinos","sous-vetement"
- "t-shirt", "tshirt", "manches courtes" → tags incluent "tshirt","manches-courtes","base"
- "manches longues", "longsleeve" → tags incluent "manches-longues","base"
- "polaire", "fleece" → tags incluent "mid","polaire","fleece","veste"
- "doudoune", "down", "primaloft" → tags incluent "mid","doudoune","isolation","veste"
- "gilet", "vest", "sans manches" → tags incluent "mid","gilet","vest"
- "coupe-vent", "windbreaker" → tags incluent "outer","coupe-vent","windbreaker","veste"
- "hardshell", "veste imperméable", "gore-tex" → tags incluent "outer","hardshell","imperméable","veste"
- "veste" → tags incluent "veste","outer"
- "pantalon", "pants" → tags incluent "pants","pantalon"

Si une info manque, utilise la valeur la plus probable.

IMPORTANT pour le summary :
- Parle comme un expert montagne qui s'adresse directement à l'utilisateur (tutoiement)
- Reformule ce que tu as compris de SA situation spécifique
- Annonce ce que tu vas lui proposer en termes de système de couches
- JAMAIS de format générique type "Profil Randonnée · Hiver"
- Sois chaleureux, passionné et expert
- Exemple bon : "Ah super, un trek hivernal sous la pluie ! Je te prépare un système 3 couches respirant et imperméable pour rester au sec sans surchauffer."
- Exemple mauvais : "Profil détecté : Hiking · Winter"`;

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

    let systemText = SYSTEM_PROMPT;
    if (currentProfile && typeof currentProfile === "object") {
      systemText += `\n\nCONTEXTE : L'utilisateur a déjà un profil établi : activity=${currentProfile.activity}, season=${currentProfile.season}, condition=${currentProfile.condition}, level=${currentProfile.level}.\nMets à jour son profil en tenant compte de sa nouvelle demande. Ne change que les champs concernés, garde les autres identiques.`;
    }

    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemText }] },
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
        activity: "hiking", season: "winter", condition: "mixed",
        level: "regular", tags: [], summary: "Profil outdoor standard détecté."
      };
    }

    // Validate enum values
    const valid = {
      activity: ["hiking", "ski-touring", "alpine", "trail", "ski"],
      season: ["winter", "spring", "summer", "autumn"],
      condition: ["rain", "wind", "cold", "mixed", "intense"],
      level: ["beginner", "regular", "expert"],
    };

    for (const [key, allowed] of Object.entries(valid)) {
      if (!allowed.includes(profile[key])) {
        profile[key] = allowed[0];
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
