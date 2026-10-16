// Le rayon d'« Appeler autour », que chacun règle pour soi (3, 5, 10, 15 ou 20 km).
//
// Un seul rayon pour toutes les questions « qu'est-ce qu'il y a autour ? » : le bouton
// « Appeler autour » d'un rendez-vous, les bulles de la carte, le bloc des tournées à garnir
// de l'accueil, et les voisins affichés sur une fiche. Il est gardé sur le profil, donc le
// même sur le téléphone et l'ordinateur.
import { useCallback } from 'react';
import { useApp } from '../store/AppContext';
import { apiPut } from '../api/client';
import { toast } from 'sonner';
import { RAYONS_APPELS_KM, rayonAppelsDe } from '../utils/voisinage';

export function useRayonAppels(): { rayon: number; rayons: readonly number[]; choisir: (km: number) => Promise<void> } {
  const { state, dispatchLocal } = useApp();
  const moi = state.currentUser;
  const rayon = rayonAppelsDe(moi);

  const choisir = useCallback(async (km: number) => {
    if (!moi || !RAYONS_APPELS_KM.includes(km) || km === moi.rayon_appels_km) return;
    const maj = { ...moi, rayon_appels_km: km };
    // Tout de suite à l'écran ; le serveur suit.
    dispatchLocal({ type: 'UPDATE_COMMERCIAL', payload: maj });
    dispatchLocal({ type: 'SET_CURRENT_USER', payload: maj });
    try {
      const { password: _mdp, ...sansMotDePasse } = maj;
      await apiPut(`/commerciaux/${moi.id}`, sansMotDePasse);
    } catch {
      toast.error('Le rayon n\'a pas pu être enregistré');
    }
  }, [moi, dispatchLocal]);

  return { rayon, rayons: RAYONS_APPELS_KM, choisir };
}
