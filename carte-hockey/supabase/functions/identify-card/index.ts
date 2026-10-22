// Fonction Supabase : identifie une carte à partir des photos recto et verso.
// Reçoit : { recto: "<base64 jpeg>", verso?: "<base64 jpeg>" }
// Renvoie : { fiche: {...}, modele: "..." }
//
// Secrets (Supabase > Edge Functions > Secrets) :
//   ANTHROPIC_API_KEY   ta clé API Claude (obligatoire)
//   ALLOWED_EMAILS      courriels autorisés, séparés par des virgules (obligatoire)
//   CLAUDE_MODEL        optionnel, par défaut claude-haiku-5-5
//
// Réglage de la fonction : « Verify JWT with legacy secret » = OFF.
// La vérification est faite ici : la personne doit être connectée ET autorisée.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODELE_DEFAUT = "claude-haiku-5-5";
const TAILLE_MAX_IMAGE = 1_500_000; // caractères base64 (~1,1 Mo)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CONSIGNE = `Tu identifies des cartes de sport à collectionner, surtout des cartes de hockey.
Tu reçois la photo du recto et, si disponible, celle du verso.
Le verso contient habituellement le numéro de la carte, l'année, la marque et la série : lis-le attentivement.

Règles :
- Ne devine jamais. Si une information n'est pas lisible ou pas certaine, mets null et ajoute le champ à "champs_incertains".
- "annee" au format de saison, par exemple "2023-24". Pour une carte d'une seule année, par exemple "1991".
- "numerotation" seulement si la carte porte un tirage limité imprimé, par exemple "519/599".
- "parallele" : le nom de la variante (Silver, Exclusives, Red...). null pour une carte de base.
- "jersey" vrai seulement s'il y a un morceau de chandail ou d'équipement intégré à la carte.
- "gradee" seulement si la carte est dans un boîtier de gradation (PSA, BGS, SGC...), par exemple "PSA 9".
- "requete_recherche" : une courte requête en anglais pour retrouver les ventes de cette carte sur eBay, par exemple "2023-24 Upper Deck Ultimate Rookies Stanislav Svozil Jersey /599".
Enregistre ta réponse avec l'outil enregistrer_fiche.`;

const OUTIL = {
  name: "enregistrer_fiche",
  description: "Enregistre la fiche d'identification de la carte.",
  input_schema: {
    type: "object",
    properties: {
      joueur: { type: ["string", "null"], description: "Nom complet du joueur" },
      equipe: { type: ["string", "null"], description: "Équipe sur la carte" },
      annee: { type: ["string", "null"] },
      marque: { type: ["string", "null"], description: "Fabricant : Upper Deck, Topps, Score, O-Pee-Chee..." },
      serie: { type: ["string", "null"], description: "Nom du set ou de la série" },
      numero: { type: ["string", "null"], description: "Numéro de la carte dans la série" },
      parallele: { type: ["string", "null"] },
      numerotation: { type: ["string", "null"] },
      recrue: { type: "boolean", description: "Carte recrue (RC, Young Guns, Rookies...)" },
      jersey: { type: "boolean" },
      autographe: { type: "boolean" },
      gradee: { type: ["string", "null"] },
      confiance: { type: "string", enum: ["haute", "moyenne", "basse"] },
      champs_incertains: { type: "array", items: { type: "string" } },
      requete_recherche: { type: "string" },
    },
    required: [
      "joueur", "equipe", "annee", "marque", "serie", "numero", "parallele",
      "numerotation", "recrue", "jersey", "autographe", "gradee",
      "confiance", "champs_incertains", "requete_recherche",
    ],
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function imageBloc(base64: string) {
  return {
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: base64 },
  };
}

function nettoyer(b64: unknown): string | null {
  if (typeof b64 !== "string" || b64.length === 0) return null;
  // Accepte aussi une URL de données « data:image/jpeg;base64,... »
  const virgule = b64.indexOf(",");
  return b64.startsWith("data:") && virgule > 0 ? b64.slice(virgule + 1) : b64;
}

/**
 * Vérifie auprès de Supabase Auth que le jeton appartient à une personne connectée,
 * puis que son courriel est dans la liste autorisée. Renvoie le courriel ou une erreur.
 */
async function verifierUtilisateur(req: Request): Promise<{ courriel: string } | { erreur: string; statut: number }> {
  const autorisation = req.headers.get("authorization") ?? "";
  const jeton = autorisation.replace(/^Bearer\s+/i, "").trim();
  if (!jeton || jeton.startsWith("sb_")) return { erreur: "Connexion requise", statut: 401 };

  const urlProjet = Deno.env.get("SUPABASE_URL");
  const clePublique = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!urlProjet) return { erreur: "SUPABASE_URL indisponible", statut: 500 };

  const rep = await fetch(`${urlProjet}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jeton}`, apikey: clePublique },
  });
  if (!rep.ok) return { erreur: "Session invalide ou expirée : reconnecte-toi", statut: 401 };
  const utilisateur = await rep.json();
  const courriel = String(utilisateur?.email ?? "").toLowerCase();

  const autorises = (Deno.env.get("ALLOWED_EMAILS") ?? "")
    .split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);
  if (autorises.length === 0) return { erreur: "ALLOWED_EMAILS manquant dans les secrets Supabase", statut: 500 };
  if (!courriel || !autorises.includes(courriel)) return { erreur: "Compte non autorisé", statut: 403 };

  return { courriel };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erreur: "Méthode non permise" }, 405);

  const verif = await verifierUtilisateur(req);
  if ("erreur" in verif) return json({ erreur: verif.erreur }, verif.statut);

  const cle = Deno.env.get("ANTHROPIC_API_KEY");
  if (!cle) return json({ erreur: "ANTHROPIC_API_KEY manquante dans les secrets Supabase" }, 500);
  const modele = Deno.env.get("CLAUDE_MODEL") || MODELE_DEFAUT;

  let corps: { recto?: unknown; verso?: unknown };
  try {
    corps = await req.json();
  } catch {
    return json({ erreur: "Corps JSON invalide" }, 400);
  }

  const recto = nettoyer(corps.recto);
  const verso = nettoyer(corps.verso);
  if (!recto) return json({ erreur: "La photo du recto est requise" }, 400);
  for (const img of [recto, verso]) {
    if (img && img.length > TAILLE_MAX_IMAGE) {
      return json({ erreur: "Image trop lourde : réduis-la à environ 1000 px" }, 413);
    }
  }

  const contenu: unknown[] = [{ type: "text", text: "Recto de la carte :" }, imageBloc(recto)];
  if (verso) contenu.push({ type: "text", text: "Verso de la carte :" }, imageBloc(verso));
  else contenu.push({ type: "text", text: "Pas de photo du verso. Sois prudent sur l'année, la série et le numéro." });

  const reponse = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": cle,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: modele,
      max_tokens: 800,
      system: CONSIGNE,
      tools: [OUTIL],
      tool_choice: { type: "tool", name: OUTIL.name },
      messages: [{ role: "user", content: contenu }],
    }),
  });

  if (!reponse.ok) {
    const detail = await reponse.text();
    console.error("Erreur Anthropic", reponse.status, detail);
    return json({ erreur: `Le service d'identification a répondu ${reponse.status}` }, 502);
  }

  const donnees = await reponse.json();
  const bloc = (donnees.content ?? []).find(
    (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === OUTIL.name,
  );
  if (!bloc) return json({ erreur: "Réponse inattendue du modèle" }, 502);

  return json({ fiche: bloc.input, modele, usage: donnees.usage ?? null });
});
