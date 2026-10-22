// Fonctions pures, sans dépendance au navigateur : faciles à tester.

export const CHAMPS_TEXTE = [
  "joueur", "equipe", "annee", "marque", "serie",
  "numero", "parallele", "numerotation", "gradee",
];
export const CHAMPS_BOOL = ["recrue", "jersey", "autographe"];

/** Normalise une valeur texte pour la comparaison (casse, espaces, vide = null). */
export function normaliser(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/\s+/g, " ").toLowerCase();
  return s === "" ? null : s;
}

/** Liste les champs que l'utilisateur a corrigés par rapport à la proposition de l'IA. */
export function champsCorriges(proposition, finale) {
  if (!proposition) return [];
  const corriges = [];
  for (const c of CHAMPS_TEXTE) {
    if (normaliser(proposition[c]) !== normaliser(finale[c])) corriges.push(c);
  }
  for (const c of CHAMPS_BOOL) {
    if (Boolean(proposition[c]) !== Boolean(finale[c])) corriges.push(c);
  }
  return corriges;
}

/** Requête de recherche eBay à partir d'une fiche. */
export function requeteCarte(fiche) {
  const morceaux = [
    fiche.annee, fiche.marque, fiche.serie, fiche.joueur,
    fiche.numero ? `#${fiche.numero}` : null,
    fiche.parallele,
    fiche.jersey ? "jersey" : null,
    fiche.autographe ? "auto" : null,
    fiche.numerotation ? `/${String(fiche.numerotation).split("/").pop()}` : null,
    fiche.gradee,
  ];
  return morceaux.filter((m) => m && String(m).trim()).join(" ").replace(/\s+/g, " ").trim();
}

/** Lien vers les ventes complétées sur eBay.ca. */
export function lienVentesEbay(requete) {
  const params = new URLSearchParams({ _nkw: requete, LH_Sold: "1", LH_Complete: "1" });
  return `https://www.ebay.ca/sch/i.html?${params.toString()}`;
}

/** Filtre une liste de cartes par texte libre et par équipe. */
export function filtrerCartes(cartes, texte, equipe) {
  const t = normaliser(texte);
  return cartes.filter((c) => {
    if (equipe && c.equipe !== equipe) return false;
    if (!t) return true;
    const bloc = [c.joueur, c.equipe, c.annee, c.marque, c.serie, c.parallele, c.numero]
      .map((v) => normaliser(v) ?? "").join(" ");
    return bloc.includes(t);
  });
}

/** Statistiques de la collection et de l'exactitude de l'IA. */
export function statistiques(cartes) {
  const total = cartes.reduce((n, c) => n + (c.quantite || 1), 0);
  const scannees = cartes.filter((c) => c.ia_proposition);
  const justes = scannees.filter((c) => (c.champs_corriges || []).length === 0).length;
  return {
    fiches: cartes.length,
    total,
    hits: cartes.filter((c) => c.jersey || c.autographe || c.numerotation || c.gradee).length,
    exactitude: scannees.length ? Math.round((100 * justes) / scannees.length) : null,
  };
}

/** Titre lisible d'une carte. */
export function titreCarte(c) {
  return [c.annee, c.marque, c.serie].filter(Boolean).join(" ") || "Série inconnue";
}
