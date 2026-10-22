import { test } from "node:test";
import assert from "node:assert/strict";
import {
  champsCorriges, requeteCarte, lienVentesEbay, filtrerCartes, statistiques, normaliser,
} from "../docs/lib.js";

const ia = {
  joueur: "Stanislav Svozil", equipe: "Columbus Blue Jackets", annee: "2023-24",
  marque: "Upper Deck", serie: "Ultimate Collection", numero: null, parallele: null,
  numerotation: "519/599", recrue: true, jersey: true, autographe: false, gradee: null,
};

test("aucune correction quand seule la casse ou les espaces changent", () => {
  const finale = { ...ia, joueur: "  stanislav   SVOZIL ", numero: "" };
  assert.deepEqual(champsCorriges(ia, finale), []);
});

test("détecte les champs texte et booléens corrigés", () => {
  const finale = { ...ia, annee: "2022-23", jersey: false };
  assert.deepEqual(champsCorriges(ia, finale), ["annee", "jersey"]);
});

test("pas de proposition IA = pas de correction comptée", () => {
  assert.deepEqual(champsCorriges(null, ia), []);
});

test("requête eBay complète et compacte", () => {
  assert.equal(
    requeteCarte(ia),
    "2023-24 Upper Deck Ultimate Collection Stanislav Svozil jersey /599",
  );
});

test("lien eBay.ca filtré sur les ventes complétées", () => {
  const url = new URL(lienVentesEbay("2023-24 Upper Deck Svozil /599"));
  assert.equal(url.hostname, "www.ebay.ca");
  assert.equal(url.searchParams.get("LH_Sold"), "1");
  assert.equal(url.searchParams.get("LH_Complete"), "1");
  assert.equal(url.searchParams.get("_nkw"), "2023-24 Upper Deck Svozil /599");
});

test("filtre par texte et par équipe", () => {
  const cartes = [
    { joueur: "Sidney Crosby", equipe: "Pittsburgh Penguins", serie: "SP Authentic" },
    { joueur: "Auston Matthews", equipe: "Toronto Maple Leafs", serie: "Allure" },
    { joueur: "Mitch Marner", equipe: "Toronto Maple Leafs", serie: "Artifacts" },
  ];
  assert.equal(filtrerCartes(cartes, "", "").length, 3);
  assert.equal(filtrerCartes(cartes, "", "Toronto Maple Leafs").length, 2);
  assert.equal(filtrerCartes(cartes, "artifacts", "").length, 1);
  assert.equal(filtrerCartes(cartes, "crosby", "Toronto Maple Leafs").length, 0);
});

test("statistiques : total, hits et exactitude", () => {
  const cartes = [
    { quantite: 1, jersey: true, ia_proposition: {}, champs_corriges: [] },
    { quantite: 3, ia_proposition: {}, champs_corriges: ["annee"] },
    { quantite: 1, numerotation: "10/99" },
  ];
  assert.deepEqual(statistiques(cartes), { fiches: 3, total: 5, hits: 2, exactitude: 50 });
  assert.equal(statistiques([]).exactitude, null);
});

test("normaliser", () => {
  assert.equal(normaliser("   "), null);
  assert.equal(normaliser(undefined), null);
  assert.equal(normaliser(" Upper  Deck "), "upper deck");
});
