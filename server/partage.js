// Fiche Google Maps partagée (depuis WhatsApp, Google Maps ou Google Business) → prospect.
//
// Ce que l'on reçoit est un texte libre : le message WhatsApp tel quel, ou juste le lien.
// On en tire le nom, l'adresse et la position, dans cet ordre de confiance :
//   1. le lien Google Maps résolu (les liens courts maps.app.goo.gl redirigent vers
//      /maps/place/<nom>/@lat,lng/… qui contient déjà le nom et la position) ;
//   2. la page Google Maps (balises og:title = « Nom · Adresse », og:description = catégorie) ;
//   3. le texte autour du lien (Google Maps partage « Nom\nAdresse\nlien ») ;
//   4. l'API adresse de l'État pour compléter : position → adresse, ou adresse → position.
// Rien n'est bloquant : sans réseau, la fiche est créée avec ce que le texte donne, et le
// prospecteur complète le reste (c'est le sens de l'étape « Partagé »).

// google.fr, google.com/maps, maps.app.goo.gl, goo.gl, g.co, g.page, et share.google (bouton
// « Partager » de l'application Google et de la recherche Google).
const HOTES_MAPS = /(^|\.)(google\.[a-z.]+|share\.google|goo\.gl|g\.co|g\.page)$/i;

export function extraireLien(texte) {
  const m = String(texte || '').match(/https?:\/\/[^\s<>"')\]]+/i);
  if (!m) return '';
  // Ponctuation de fin de phrase collée au lien.
  return m[0].replace(/[.,;:!?]+$/, '');
}

export function estLienGoogle(url) {
  try { return HOTES_MAPS.test(new URL(url).hostname); } catch { return false; }
}

function decoderSegment(s) {
  try { return decodeURIComponent(String(s).replace(/\+/g, ' ')).trim(); } catch { return String(s).replace(/\+/g, ' ').trim(); }
}

/** Ce que l'adresse d'un lien Google Maps contient à elle seule. */
export function analyserLienMaps(url) {
  const r = { nom: '', latitude: 0, longitude: 0 };
  let u;
  try { u = new URL(url); } catch { return r; }
  const chemin = u.pathname;
  // /maps/place/<nom>/@lat,lng,17z/data=!…!3d<lat>!4d<lng>
  const place = chemin.match(/\/maps\/place\/([^/@]+)/);
  if (place) r.nom = decoderSegment(place[1]);
  const search = chemin.match(/\/maps\/search\/([^/@]+)/);
  if (!r.nom && search) r.nom = decoderSegment(search[1]);
  // Recherche Google (fiche d'établissement partagée depuis l'application Google) : ?q=Nom
  const q = u.searchParams.get('q') || u.searchParams.get('query') || '';
  const coordQ = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (coordQ) { r.latitude = Number(coordQ[1]); r.longitude = Number(coordQ[2]); }
  else if (!r.nom && q) r.nom = q.trim();
  // Position exacte du lieu (!3d…!4d…) avant le centre de la carte (@lat,lng).
  const precise = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const centre = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const ll = (u.searchParams.get('ll') || '').match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
  const pos = precise || centre || ll;
  if (pos && !r.latitude) { r.latitude = Number(pos[1]); r.longitude = Number(pos[2]); }
  // Un nom qui n'est qu'une coordonnée n'est pas un nom.
  if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(r.nom)) r.nom = '';
  return r;
}

function attributsMeta(html) {
  const metas = [];
  for (const m of String(html).matchAll(/<meta\s+([^>]*?)\/?>/gi)) {
    const attrs = {};
    for (const a of m[1].matchAll(/([a-zA-Z:-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1].toLowerCase()] = a[2];
    metas.push(attrs);
  }
  return metas;
}

function decoderHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}

function texteSansBalises(s) {
  return decoderHtml(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Valeur d'un bloc « data-attrid » de la fiche d'établissement d'une page de recherche Google. */
function attributFiche(html, attrid) {
  const i = String(html).indexOf(`data-attrid="${attrid}"`);
  if (i < 0) return '';
  const bloc = String(html).slice(i, i + 1500);
  const fin = bloc.search(/data-attrid="(?!${attrid})/);
  const texte = texteSansBalises(fin > 0 ? bloc.slice(0, fin) : bloc);
  // « Adresse : 12 Rue X » → on retire le libellé.
  return texte.replace(/^[^:]{0,30}:\s*/, '').trim();
}

/** Ce que la page Google d'un lieu dit de lui : Open Graph (Maps) ou fiche d'établissement (recherche Google). */
export function analyserPageMaps(html) {
  const r = { nom: '', adresse: '', categorie: '', telephone: '' };
  if (!html) return r;
  const metas = attributsMeta(html);
  const contenu = (cle) => {
    const m = metas.find(a => (a.property === cle || a.name === cle) && a.content);
    return m ? decoderHtml(m.content).trim() : '';
  };
  const titre = contenu('og:title');
  if (titre) {
    const parts = titre.split(' · ').map(s => s.trim()).filter(Boolean);
    r.nom = parts[0] || '';
    if (parts.length > 1) r.adresse = parts.slice(1).join(', ');
  }
  const desc = contenu('og:description');
  if (desc) {
    // « ★★★★☆ · Bar » ou « Bar » ; on garde le morceau sans étoiles ni note.
    const cat = desc.split(' · ').map(s => s.trim()).find(s => s && !/[★☆]/.test(s) && !/^\d+([.,]\d+)?$/.test(s));
    if (cat) r.categorie = cat;
  }
  if (!r.nom) {
    const t = String(html).match(/<title>([^<]*)<\/title>/i);
    if (t) r.nom = decoderHtml(t[1]).replace(/\s*-\s*(Google Maps|Google Search|Recherche Google)\s*$/i, '').trim();
  }
  // Fiche d'établissement de la recherche Google : adresse, téléphone, « Restaurant à Le Puy-en-Velay ».
  if (!r.adresse) r.adresse = attributFiche(html, 'kc:/location/location:address');
  const tel = attributFiche(html, 'kc:/collection/knowledge_panels/has_phone:phone');
  if (tel) r.telephone = tel.replace(/[^\d+ .-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!r.categorie) {
    const sousTitre = attributFiche(html, 'subtitle');
    if (sousTitre) r.categorie = sousTitre.split(/\s+(?:à|a|in|dans)\s+/i)[0].trim();
  }
  return r;
}

/** « 12 Rue X, 43000 Le Puy-en-Velay, France » → morceaux d'une fiche. */
export function decouperAdresse(adresse) {
  const r = { adresse: '', code_postal: '', ville: '', departement: '' };
  let s = String(adresse || '').replace(/\s+/g, ' ').replace(/,?\s*France\s*$/i, '').trim();
  if (!s) return r;
  const m = s.match(/^(.*?)[,\s]*\b(\d{5})\s+([^,]+?)\s*(?:,.*)?$/);
  if (m) {
    r.adresse = m[1].replace(/[,\s]+$/, '').trim();
    r.code_postal = m[2];
    r.ville = m[3].trim();
  } else {
    r.adresse = s;
  }
  if (r.code_postal) r.departement = r.code_postal.startsWith('97') ? r.code_postal.slice(0, 3) : r.code_postal.slice(0, 2);
  return r;
}

const sansAccents = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Catégorie Google (ou nom) → type d'établissement de SuiviPro. */
export function devinerType(...textes) {
  const t = ' ' + textes.map(sansAccents).join(' ') + ' ';
  // Début de mot seulement : « bar » dans « barbecue » oui, dans « Tabarly » non.
  const a = (...mots) => mots.some(m => new RegExp('(^|[^a-z])' + m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(t));
  if (a('camping')) return 'camping';
  if (a('traiteur')) return 'traiteur';
  if (a('hotel', 'chambre d\'hote', 'chambres d\'hote', 'gite', 'auberge de jeunesse')) return 'hotel';
  if (a('supermarche', 'hypermarche', 'intermarche', 'leclerc', 'carrefour', 'casino', 'lidl', 'aldi', 'super u', 'u express', 'monoprix', 'grande surface')) return 'supermarche';
  if (a('cave', 'caviste', 'vins et spiritueux', 'magasin de vin', 'magasin de biere', 'bieres')) return 'cave';
  if (a('epicerie', 'primeur', 'alimentation generale', 'fromagerie', 'boucherie', 'boulangerie', 'superette', 'produits regionaux', 'magasin bio', 'magasin d\'alimentation')) return 'epicerie';
  if (a('bar', 'pub', 'cafe', 'restaurant', 'brasserie', 'pizzeria', 'bistro', 'creperie', 'auberge', 'grill', 'taverne', 'guinguette', 'salon de the', 'cantine', 'snack', 'buvette', 'discotheque', 'bowling')) return 'bar_restaurant';
  if (a('marche')) return 'marche';
  if (a('grossiste', 'distributeur')) return 'distributeur';
  if (a('mairie', 'collectivite', 'communaute de communes', 'office de tourisme')) return 'collectivite';
  if (a('comite d\'entreprise', 'cse')) return 'comite_entreprise';
  if (a('association')) return 'association';
  return 'autre';
}

/** Le texte autour du lien : Google Maps partage « Nom\nAdresse\nlien », WhatsApp y ajoute parfois un mot. */
export function analyserTexte(texte) {
  const lien = extraireLien(texte);
  const lignes = String(texte || '')
    .replace(/https?:\/\/[^\s<>"')\]]+/gi, ' ')
    .split(/\r?\n/)
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(l => l && !/^(voir|see|via|regarde|regardez)\b/i.test(l));
  const r = { lien, nom: '', adresse: '', telephone: '' };
  for (const l of lignes) {
    const tel = l.match(/(?:\+33|0)\s?[1-9](?:[\s.-]?\d{2}){4}/);
    if (tel && !r.telephone) { r.telephone = tel[0].trim(); continue; }
    if (!r.adresse && /\b\d{5}\b/.test(l) && /\d/.test(l)) { r.adresse = l; continue; }
    if (!r.nom) r.nom = l.replace(/^[«"“']+|[»"”']+$/g, '').trim();
  }
  return r;
}

const ENTETES = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  // Sans ce cookie, Google renvoie sa page de consentement à la place de la fiche.
  'Cookie': 'CONSENT=YES+cb.20240101-00-p0.fr+FX+000; SOCS=CAESHAgBEhJnd3NfMjAyNDAxMDEtMF9SQzIaAmZyIAEaBgiAo_SsBg',
};

async function avecDelai(promesse, ms) {
  let t;
  const garde = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('délai dépassé')), ms); });
  try { return await Promise.race([promesse, garde]); } finally { clearTimeout(t); }
}

/** Suit les redirections d'un lien (court ou non) et lit la page. Jamais bloquant : null si le réseau manque. */
export async function resoudreLien(url, fetchFn = globalThis.fetch) {
  if (!url || !fetchFn) return null;
  try {
    const controller = new AbortController();
    const rep = await avecDelai(fetchFn(url, { headers: ENTETES, redirect: 'follow', signal: controller.signal }), 8000);
    let urlFinale = rep.url || url;
    // Page de consentement européenne : le vrai lien est dans « continue ».
    try {
      const uf = new URL(urlFinale);
      if (/consent\.google\./.test(uf.hostname)) urlFinale = uf.searchParams.get('continue') || urlFinale;
    } catch { /* on garde l'adresse telle quelle */ }
    let html = '';
    if (rep.ok) {
      const lecteur = rep.body?.getReader ? rep.body.getReader() : null;
      if (lecteur) {
        // On ne lit que le début : les balises og: sont dans l'en-tête de la page.
        const morceaux = []; let taille = 0;
        while (taille < 400000) {
          const { value, done } = await avecDelai(lecteur.read(), 4000);
          if (done) break;
          morceaux.push(value); taille += value.length;
        }
        try { await lecteur.cancel(); } catch { /* flux déjà fermé */ }
        html = Buffer.concat(morceaux.map(m => Buffer.from(m))).toString('utf8');
      } else {
        html = await avecDelai(rep.text(), 4000);
      }
    }
    return { urlFinale, html };
  } catch {
    return null;
  }
}

const API_ADRESSE = 'https://api-adresse.data.gouv.fr';

async function lireJson(fetchFn, url) {
  try {
    const rep = await avecDelai(fetchFn(url), 5000);
    if (!rep.ok) return null;
    return await rep.json();
  } catch { return null; }
}

function proprietesAdresse(feature) {
  const p = feature?.properties || {};
  const rue = [p.housenumber, p.street || p.name].filter(Boolean).join(' ');
  return {
    adresse: rue,
    code_postal: p.postcode || '',
    ville: p.city || '',
    departement: p.postcode ? (p.postcode.startsWith('97') ? p.postcode.slice(0, 3) : p.postcode.slice(0, 2)) : '',
  };
}

export async function positionVersAdresse(latitude, longitude, fetchFn = globalThis.fetch) {
  if (!latitude || !longitude || !fetchFn) return null;
  const data = await lireJson(fetchFn, `${API_ADRESSE}/reverse/?lon=${longitude}&lat=${latitude}`);
  const f = data?.features?.[0];
  return f ? proprietesAdresse(f) : null;
}

export async function adresseVersPosition(adresse, fetchFn = globalThis.fetch) {
  if (!adresse || adresse.trim().length < 4 || !fetchFn) return null;
  const data = await lireJson(fetchFn, `${API_ADRESSE}/search/?${new URLSearchParams({ q: adresse, limit: '1' })}`);
  const f = data?.features?.[0];
  if (!f) return null;
  const [longitude, latitude] = f.geometry.coordinates;
  return { latitude, longitude, ...proprietesAdresse(f) };
}

/**
 * Le texte partagé → les champs d'un prospect (sans identifiant ni dates).
 * `sources` liste d'où vient chaque information, pour l'afficher à celui qui complète.
 */
export async function ficheDepuisPartage(texte, { fetchFn = globalThis.fetch } = {}) {
  const t = analyserTexte(texte);
  const fiche = {
    nom_etablissement: t.nom, adresse: '', code_postal: '', ville: '', departement: '',
    latitude: 0, longitude: 0, telephone: t.telephone, type_etablissement: 'autre',
    source_url: t.lien, categorie_google: '',
  };
  const sources = [];
  if (t.nom) sources.push('nom : message');

  let adresseBrute = t.adresse;
  if (t.lien && estLienGoogle(t.lien)) {
    const res = await resoudreLien(t.lien, fetchFn);
    const urlFinale = res?.urlFinale || t.lien;
    fiche.source_url = urlFinale.length < 2000 ? urlFinale : t.lien;
    const page = analyserPageMaps(res?.html);
    const lien = analyserLienMaps(urlFinale);
    const nomPage = page.nom && !/^google maps$/i.test(page.nom) ? page.nom : '';
    if (nomPage) { fiche.nom_etablissement = nomPage; sources.push('nom : fiche Google'); }
    else if (lien.nom && (!fiche.nom_etablissement || fiche.nom_etablissement.length < 3)) { fiche.nom_etablissement = lien.nom; sources.push('nom : lien'); }
    if (page.adresse) { adresseBrute = page.adresse; sources.push('adresse : fiche Google'); }
    if (page.telephone && !fiche.telephone) { fiche.telephone = page.telephone; sources.push('téléphone : fiche Google'); }
    if (lien.latitude) { fiche.latitude = lien.latitude; fiche.longitude = lien.longitude; sources.push('position : lien'); }
    if (page.categorie) fiche.categorie_google = page.categorie;
  } else if (t.lien) {
    fiche.source_url = t.lien;
  }
  if (adresseBrute) Object.assign(fiche, decouperAdresse(adresseBrute));
  if (adresseBrute && !sources.some(s => s.startsWith('adresse'))) sources.push('adresse : message');

  // Compléments par l'API adresse : position → adresse, ou adresse → position.
  if (fiche.latitude && !fiche.code_postal) {
    const a = await positionVersAdresse(fiche.latitude, fiche.longitude, fetchFn);
    if (a) {
      if (!fiche.adresse) fiche.adresse = a.adresse;
      fiche.code_postal = a.code_postal; fiche.ville = a.ville; fiche.departement = a.departement;
      sources.push('commune : API adresse');
    }
  } else if (!fiche.latitude && (fiche.adresse || fiche.ville)) {
    const p = await adresseVersPosition([fiche.adresse, fiche.code_postal, fiche.ville].filter(Boolean).join(' '), fetchFn);
    if (p) {
      fiche.latitude = p.latitude; fiche.longitude = p.longitude;
      if (!fiche.code_postal) { fiche.code_postal = p.code_postal; fiche.ville = p.ville; fiche.departement = p.departement; }
      sources.push('position : API adresse');
    }
  }
  fiche.type_etablissement = devinerType(fiche.categorie_google, fiche.nom_etablissement);
  return { fiche, sources };
}
