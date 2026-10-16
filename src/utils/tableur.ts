// Lire et écrire des tableurs (.xlsx, .csv) pour les imports et les exports.
//
// Remplace la bibliothèque « xlsx » (SheetJS), dont la version publiée sur npm traîne des
// failles sans correctif. Deux petites bibliothèques à la place : read-excel-file pour lire
// un .xlsx, write-excel-file pour en écrire un ; le CSV est lu ici même. Les deux ne se
// chargent qu'au premier import ou export, jamais au démarrage de l'appli.
//
// Les anciens fichiers .xls (format binaire d'avant 2007) ne sont plus lus : Excel les
// enregistre en .xlsx en un clic.

export type LigneTableur = Record<string, unknown>;

/** La première feuille, ligne par ligne, chaque ligne étant un tableau de cellules. */
export async function lireTableau(fichier: File): Promise<unknown[][]> {
  const nom = fichier.name.toLowerCase();
  if (nom.endsWith('.csv') || nom.endsWith('.txt') || fichier.type === 'text/csv') {
    return lireCsv(await fichier.arrayBuffer());
  }
  if (nom.endsWith('.xls')) {
    throw new Error('Les fichiers .xls (ancien format) ne sont plus pris en charge : enregistrez-le en .xlsx dans Excel.');
  }
  const { readSheet } = await import('read-excel-file/browser');
  const lignes = await readSheet(fichier);
  return lignes.map(l => l.map(c => (c === null ? undefined : c)));
}

/**
 * Les lignes sous l'en-tête en objets { « Nom de colonne »: valeur }, comme le faisait
 * SheetJS : la ligne d'en-tête donne les clés, les cellules vides sont omises, les lignes
 * entièrement vides sautées, un en-tête vide devient « __EMPTY », un doublon « Nom_1 ».
 */
export function tableauVersObjets(lignes: unknown[][], ligneEntete: number): LigneTableur[] {
  const entete = lignes[ligneEntete] || [];
  const cles: string[] = [];
  const vus = new Map<string, number>();
  const largeur = Math.max(entete.length, ...lignes.slice(ligneEntete + 1).map(l => l.length));
  for (let i = 0; i < largeur; i++) {
    const brut = String(entete[i] ?? '').trim();
    let cle = brut || (i === 0 || !vus.has('__EMPTY') ? '__EMPTY' : '__EMPTY');
    const n = vus.get(cle) || 0;
    vus.set(cle, n + 1);
    if (n > 0) cle = `${cle}_${n}`;
    cles.push(cle);
  }
  const objets: LigneTableur[] = [];
  for (const ligne of lignes.slice(ligneEntete + 1)) {
    const o: LigneTableur = {};
    let vide = true;
    ligne.forEach((v, i) => {
      if (v === undefined || v === null || v === '') return;
      o[cles[i]] = v;
      vide = false;
    });
    if (!vide) objets.push(o);
  }
  return objets;
}

/**
 * Télécharge un .xlsx à partir d'objets : les clés du premier objet font les colonnes.
 * `largeurs` : la largeur de chaque colonne en caractères, dans l'ordre.
 */
export async function exporterTableau(
  lignes: LigneTableur[],
  nomFichier: string,
  { feuille = 'Feuille 1', largeurs = [] }: { feuille?: string; largeurs?: number[] } = {},
): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const colonnes = lignes.length > 0 ? Object.keys(lignes[0]) : [];
  const columns = colonnes.map((colonne, i) => {
    const exemple = lignes.map(l => l[colonne]).find(v => v !== undefined && v !== null && v !== '');
    const genre = typeof exemple === 'number' ? 'nombre' : exemple instanceof Date ? 'date' : typeof exemple === 'boolean' ? 'booleen' : 'texte';
    return {
      header: { value: colonne, fontWeight: 'bold' as const },
      width: largeurs[i] || Math.min(40, Math.max(8, colonne.length + 2)),
      cell: (l: LigneTableur) => {
        const v = l[colonne];
        if (v === undefined || v === null || v === '') return null;
        if (genre === 'nombre') return { value: typeof v === 'number' ? v : Number(v), type: Number };
        if (genre === 'date' && v instanceof Date) return { value: v, type: Date, format: 'dd/mm/yyyy' };
        if (genre === 'booleen' && typeof v === 'boolean') return { value: v, type: Boolean };
        return { value: String(v), type: String };
      },
    };
  });
  await writeXlsxFile(lignes, { columns, sheet: feuille }).toFile(nomFichier);
}

// ---- CSV ----

/** UTF-8 d'abord ; si le texte est truffé de caractères de remplacement, c'est du Windows-1252 (Excel français). */
function decoder(donnees: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(donnees);
  const rates = (utf8.match(/�/g) || []).length;
  if (rates === 0) return utf8.replace(/^﻿/, '');
  try { return new TextDecoder('windows-1252').decode(donnees); } catch { return utf8; }
}

function separateur(premiereLigne: string): string {
  const candidats = [';', ',', '\t'];
  let meilleur = ';'; let max = -1;
  for (const c of candidats) {
    const n = premiereLigne.split(c).length - 1;
    if (n > max) { max = n; meilleur = c; }
  }
  return meilleur;
}

/** Un CSV en lignes de cellules ; guillemets et retours à la ligne entre guillemets respectés. */
export function lireCsv(donnees: ArrayBuffer | string): unknown[][] {
  const texte = typeof donnees === 'string' ? donnees : decoder(donnees);
  const sep = separateur(texte.split(/\r?\n/, 1)[0] || '');
  const lignes: unknown[][] = [];
  let ligne: unknown[] = [];
  let cellule = '';
  let entreGuillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const ch = texte[i];
    if (entreGuillemets) {
      if (ch === '"') {
        if (texte[i + 1] === '"') { cellule += '"'; i++; } else entreGuillemets = false;
      } else cellule += ch;
    } else if (ch === '"') {
      entreGuillemets = true;
    } else if (ch === sep) {
      ligne.push(cellule); cellule = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texte[i + 1] === '\n') i++;
      ligne.push(cellule); cellule = '';
      lignes.push(ligne); ligne = [];
    } else cellule += ch;
  }
  if (cellule !== '' || ligne.length > 0) { ligne.push(cellule); lignes.push(ligne); }
  // Les nombres restent des nombres, comme dans un .xlsx ; une cellule vide est absente.
  return lignes.map(l => l.map(c => {
    const s = String(c).trim();
    if (s === '') return undefined;
    return /^-?\d+([.,]\d+)?$/.test(s) && !/^0\d/.test(s) ? Number(s.replace(',', '.')) : s;
  }));
}
