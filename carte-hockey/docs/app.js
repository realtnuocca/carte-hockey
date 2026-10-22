import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import {
  CHAMPS_TEXTE, CHAMPS_BOOL, champsCorriges, requeteCarte, lienVentesEbay,
  filtrerCartes, statistiques, titreCarte,
} from "./lib.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const BUCKET = "cartes";
const TAILLE_IMAGE = 1024; // px, côté le plus long : assez pour lire le verso, peu coûteux

const $ = (id) => document.getElementById(id);
const etat = {
  session: null,
  recto: null,        // Blob JPEG réduit
  verso: null,
  proposition: null,  // fiche proposée par l'IA
  modele: null,
  cartes: [],
  carteOuverte: null,
};

// ---------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------
function afficher(idVue) {
  for (const v of document.querySelectorAll(".vue")) v.hidden = v.id !== idVue;
  for (const b of document.querySelectorAll("#onglets button")) {
    b.classList.toggle("actif", b.dataset.vue === idVue);
  }
  if (idVue === "vue-inventaire") chargerCartes();
}

function message(id, texte, type = "") {
  const el = $(id);
  el.textContent = texte;
  el.className = `message ${type}`;
}

// ---------------------------------------------------------------
// Connexion (lien magique par courriel)
// ---------------------------------------------------------------
$("form-connexion").addEventListener("submit", async (e) => {
  e.preventDefault();
  const courriel = $("courriel").value.trim();
  message("msg-connexion", "Envoi…");
  const { error } = await supabase.auth.signInWithOtp({
    email: courriel,
    options: { emailRedirectTo: window.location.href.split("#")[0] },
  });
  message("msg-connexion",
    error ? `Erreur : ${error.message}` : "Lien envoyé. Ouvre-le sur ce téléphone.",
    error ? "erreur" : "ok");
});

$("btn-deconnexion").addEventListener("click", () => supabase.auth.signOut());

supabase.auth.onAuthStateChange((_evt, session) => {
  etat.session = session;
  const connecte = Boolean(session);
  $("btn-deconnexion").hidden = !connecte;
  $("onglets").hidden = !connecte;
  afficher(connecte ? "vue-scan" : "vue-connexion");
});

for (const b of document.querySelectorAll("#onglets button")) {
  b.addEventListener("click", () => afficher(b.dataset.vue));
}

// ---------------------------------------------------------------
// Photos : réduction côté téléphone avant tout envoi
// ---------------------------------------------------------------
async function chargerImage(fichier) {
  try {
    return await createImageBitmap(fichier, { imageOrientation: "from-image" });
  } catch {
    // Anciennes versions de Safari : passer par un élément <img>
    const url = URL.createObjectURL(fichier);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function reduireImage(fichier) {
  const bitmap = await chargerImage(fichier);
  const echelle = Math.min(1, TAILLE_IMAGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * echelle);
  canvas.height = Math.round(bitmap.height * echelle);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((ok) => canvas.toBlob(ok, "image/jpeg", 0.82));
}

function blobEnBase64(blob) {
  return new Promise((ok, ko) => {
    const lecteur = new FileReader();
    lecteur.onload = () => ok(String(lecteur.result).split(",")[1]);
    lecteur.onerror = ko;
    lecteur.readAsDataURL(blob);
  });
}

function brancherPhoto(cote) {
  $(`photo-${cote}`).addEventListener("change", async (e) => {
    const fichier = e.target.files?.[0];
    if (!fichier) return;
    try {
      const blob = await reduireImage(fichier);
      etat[cote] = blob;
      const apercu = $(`apercu-${cote}`);
      apercu.src = URL.createObjectURL(blob);
      apercu.hidden = false;
      $("btn-identifier").disabled = !etat.recto;
      message("msg-scan", "");
    } catch (err) {
      message("msg-scan", `Photo illisible : ${err.message}`, "erreur");
    }
  });
}
brancherPhoto("recto");
brancherPhoto("verso");

function reinitialiserScan() {
  etat.recto = etat.verso = etat.proposition = etat.modele = null;
  for (const cote of ["recto", "verso"]) {
    $(`photo-${cote}`).value = "";
    const apercu = $(`apercu-${cote}`);
    apercu.hidden = true;
    apercu.removeAttribute("src");
  }
  $("btn-identifier").disabled = true;
}

// ---------------------------------------------------------------
// Identification par l'IA
// ---------------------------------------------------------------
$("btn-identifier").addEventListener("click", async () => {
  const bouton = $("btn-identifier");
  bouton.disabled = true;
  message("msg-scan", "Identification en cours…");
  try {
    const corps = { recto: await blobEnBase64(etat.recto) };
    if (etat.verso) corps.verso = await blobEnBase64(etat.verso);
    const { data, error } = await supabase.functions.invoke("identify-card", { body: corps });
    if (error) {
      const detail = await error.context?.json?.().catch(() => null);
      throw new Error(detail?.erreur || error.message);
    }
    etat.proposition = data.fiche;
    etat.modele = data.modele;
    remplirFiche(data.fiche);
    message("msg-scan", "");
    afficher("vue-fiche");
  } catch (err) {
    message("msg-scan", `Échec : ${err.message}`, "erreur");
  } finally {
    bouton.disabled = !etat.recto;
  }
});

function remplirFiche(fiche) {
  const form = $("form-fiche");
  form.reset();
  const incertains = new Set(fiche.champs_incertains || []);
  for (const c of CHAMPS_TEXTE) {
    const champ = form.elements[c];
    champ.value = fiche[c] ?? "";
    champ.classList.toggle("incertain", incertains.has(c));
  }
  for (const c of CHAMPS_BOOL) form.elements[c].checked = Boolean(fiche[c]);
  form.elements.quantite.value = 1;
  const libelle = { haute: "Confiance haute", moyenne: "Confiance moyenne", basse: "Confiance basse : vérifie bien" };
  $("confiance").textContent = libelle[fiche.confiance] || "Confiance inconnue";
  $("confiance").dataset.niveau = fiche.confiance || "basse";
  message("msg-fiche", "");
}

function lireFiche() {
  const form = $("form-fiche");
  const fiche = {};
  for (const c of CHAMPS_TEXTE) {
    const v = form.elements[c].value.trim();
    fiche[c] = v === "" ? null : v;
  }
  for (const c of CHAMPS_BOOL) fiche[c] = form.elements[c].checked;
  fiche.quantite = Math.max(1, parseInt(form.elements.quantite.value, 10) || 1);
  fiche.notes = form.elements.notes.value.trim() || null;
  return fiche;
}

// ---------------------------------------------------------------
// Enregistrement : photos dans Storage, fiche dans la table
// ---------------------------------------------------------------
$("form-fiche").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fiche = lireFiche();
  if (!fiche.joueur) {
    message("msg-fiche", "Le nom du joueur est obligatoire.", "erreur");
    $("f-joueur").focus();
    return;
  }
  const bouton = e.submitter || $("form-fiche").querySelector("[type=submit]");
  bouton.disabled = true;
  message("msg-fiche", "Enregistrement…");

  const userId = etat.session.user.id;
  const id = crypto.randomUUID();
  const chemins = {};
  try {
    for (const cote of ["recto", "verso"]) {
      if (!etat[cote]) continue;
      const chemin = `${userId}/${id}-${cote}.jpg`;
      const { error } = await supabase.storage.from(BUCKET)
        .upload(chemin, etat[cote], { contentType: "image/jpeg", upsert: false });
      if (error) throw error;
      chemins[cote] = chemin;
    }

    const { error } = await supabase.from("cartes").insert({
      id,
      ...fiche,
      photo_recto: chemins.recto ?? null,
      photo_verso: chemins.verso ?? null,
      ia_modele: etat.modele,
      ia_proposition: etat.proposition,
      ia_confiance: etat.proposition?.confiance ?? null,
      champs_corriges: champsCorriges(etat.proposition, fiche),
    });
    if (error) throw error;

    reinitialiserScan();
    message("msg-scan", `${fiche.joueur} ajouté à ta collection. Carte suivante !`, "ok");
    afficher("vue-scan");
  } catch (err) {
    // Nettoyage des photos si la fiche n'a pas pu être enregistrée
    const aSupprimer = Object.values(chemins);
    if (aSupprimer.length) await supabase.storage.from(BUCKET).remove(aSupprimer);
    message("msg-fiche", `Échec : ${err.message}`, "erreur");
  } finally {
    bouton.disabled = false;
  }
});

$("btn-annuler").addEventListener("click", () => {
  reinitialiserScan();
  message("msg-scan", "");
  afficher("vue-scan");
});

// ---------------------------------------------------------------
// Inventaire
// ---------------------------------------------------------------
async function chargerCartes() {
  const { data, error } = await supabase
    .from("cartes").select("*").order("equipe", { ascending: true, nullsFirst: false })
    .order("joueur", { ascending: true });
  if (error) {
    $("liste").innerHTML = "";
    $("vide").hidden = false;
    $("vide").textContent = `Erreur : ${error.message}`;
    return;
  }
  etat.cartes = data;
  remplirFiltreEquipes();
  afficherInventaire();
}

function remplirFiltreEquipes() {
  const select = $("filtre-equipe");
  const choisie = select.value;
  const equipes = [...new Set(etat.cartes.map((c) => c.equipe).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  select.replaceChildren(new Option("Toutes les équipes", ""), ...equipes.map((e) => new Option(e, e)));
  select.value = equipes.includes(choisie) ? choisie : "";
}

function afficherInventaire() {
  const s = statistiques(etat.cartes);
  $("stats").innerHTML = `
    <div><strong>${s.total}</strong><span>cartes</span></div>
    <div><strong>${s.hits}</strong><span>hits</span></div>
    <div><strong>${s.exactitude === null ? "–" : s.exactitude + " %"}</strong><span>fiches justes (IA)</span></div>`;

  const cartes = filtrerCartes(etat.cartes, $("recherche").value, $("filtre-equipe").value);
  const liste = $("liste");
  liste.replaceChildren();
  $("vide").hidden = cartes.length > 0;
  $("vide").textContent = etat.cartes.length ? "Aucun résultat." : "Aucune carte pour l'instant. Scanne ta première !";

  for (const c of cartes) {
    const li = document.createElement("li");
    li.tabIndex = 0;
    const badges = [
      c.recrue && "RC", c.jersey && "Jersey", c.autographe && "Auto",
      c.numerotation, c.gradee, c.quantite > 1 && `×${c.quantite}`,
    ].filter(Boolean);
    li.innerHTML = `<div class="ligne-principale"><strong></strong><span class="equipe"></span></div>
      <div class="ligne-secondaire"></div><div class="badges"></div>`;
    li.querySelector("strong").textContent = c.joueur;
    li.querySelector(".equipe").textContent = c.equipe || "";
    li.querySelector(".ligne-secondaire").textContent =
      [titreCarte(c), c.numero && `#${c.numero}`, c.parallele].filter(Boolean).join(" · ");
    const zoneBadges = li.querySelector(".badges");
    for (const b of badges) {
      const span = document.createElement("span");
      span.textContent = b;
      zoneBadges.append(span);
    }
    li.addEventListener("click", () => ouvrirDetail(c));
    li.addEventListener("keydown", (e) => { if (e.key === "Enter") ouvrirDetail(c); });
    liste.append(li);
  }
}

$("recherche").addEventListener("input", afficherInventaire);
$("filtre-equipe").addEventListener("change", afficherInventaire);

// ---------------------------------------------------------------
// Détail d'une carte
// ---------------------------------------------------------------
async function ouvrirDetail(c) {
  etat.carteOuverte = c;
  $("d-titre").textContent = c.joueur;
  $("d-sous-titre").textContent =
    [titreCarte(c), c.numero && `#${c.numero}`, c.parallele, c.numerotation, c.equipe].filter(Boolean).join(" · ");
  $("d-ebay").href = lienVentesEbay(c.ia_proposition?.requete_recherche && !(c.champs_corriges || []).length
    ? c.ia_proposition.requete_recherche
    : requeteCarte(c));

  const chemins = [c.photo_recto, c.photo_verso].filter(Boolean);
  for (const id of ["d-recto", "d-verso"]) { $(id).hidden = true; $(id).removeAttribute("src"); }
  if (chemins.length) {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(chemins, 3600);
    for (const s of data || []) {
      if (s.error) continue;
      const cible = s.path === c.photo_recto ? "d-recto" : "d-verso";
      $(cible).src = s.signedUrl;
      $(cible).hidden = false;
    }
  }
  $("detail").showModal();
}

$("d-fermer").addEventListener("click", () => $("detail").close());

$("d-supprimer").addEventListener("click", async () => {
  const c = etat.carteOuverte;
  if (!c || !confirm(`Supprimer ${c.joueur} de ta collection ?`)) return;
  const { error } = await supabase.from("cartes").delete().eq("id", c.id);
  if (error) { alert(`Échec : ${error.message}`); return; }
  const chemins = [c.photo_recto, c.photo_verso].filter(Boolean);
  if (chemins.length) await supabase.storage.from(BUCKET).remove(chemins);
  $("detail").close();
  chargerCartes();
});

// ---------------------------------------------------------------
// Mode hors ligne minimal (coquille de l'app en cache)
// ---------------------------------------------------------------
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
