// Photos partagées avec un signalement : on les réduit avant l'envoi (1600 px de côté,
// JPEG), pour qu'une photo de téléphone de 4 Mo pèse 100 à 400 Ko. Sur Android, le partage
// dépose les fichiers dans un cache du service worker que l'on relit ici.

export interface PhotoPrete {
  /** Type après réduction (toujours JPEG, sauf PNG gardé pour les captures d'écran). */
  type_mime: string;
  /** Contenu en base64, sans le préfixe data:. */
  contenu: string;
  /** Aperçu affichable (data URL). */
  apercu: string;
  taille: number;
}

export const PHOTOS_MAX = 6;
const COTE_MAX = 1600;

function chargerImage(fichier: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fichier);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
    img.src = url;
  });
}

export async function reduirePhoto(fichier: Blob): Promise<PhotoPrete> {
  const img = await chargerImage(fichier);
  const ratio = Math.min(1, COTE_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const largeur = Math.max(1, Math.round(img.naturalWidth * ratio));
  const hauteur = Math.max(1, Math.round(img.naturalHeight * ratio));
  const toile = document.createElement('canvas');
  toile.width = largeur; toile.height = hauteur;
  const ctx = toile.getContext('2d');
  if (!ctx) throw new Error('Impossible de préparer la photo');
  ctx.drawImage(img, 0, 0, largeur, hauteur);
  const png = fichier.type === 'image/png';
  const apercu = toile.toDataURL(png ? 'image/png' : 'image/jpeg', 0.82);
  const contenu = apercu.replace(/^data:[^;]+;base64,/, '');
  return { type_mime: png ? 'image/png' : 'image/jpeg', contenu, apercu, taille: Math.floor(contenu.length * 3 / 4) };
}

/** Les fichiers déposés par le service worker lors d'un partage Android. */
export async function lirePhotosPartagees(nombre: number): Promise<Blob[]> {
  if (!('caches' in window) || nombre <= 0) return [];
  try {
    const cache = await caches.open('suivipro-partage');
    const blobs: Blob[] = [];
    for (let i = 0; i < nombre; i++) {
      const rep = await cache.match(`/partage-fichier/${i}`);
      if (rep) { blobs.push(await rep.blob()); await cache.delete(`/partage-fichier/${i}`); }
    }
    return blobs;
  } catch {
    return [];
  }
}

/** Les images d'un événement de collage (iPhone : copier l'image dans WhatsApp, coller ici). */
export function imagesCollees(e: ClipboardEvent): File[] {
  const items = e.clipboardData?.items;
  if (!items) return [];
  const out: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) { const f = item.getAsFile(); if (f) out.push(f); }
  }
  return out;
}
