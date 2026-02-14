-- ============================================
-- SuiviPro - Schema Supabase
-- La Brasserie des Plantes
-- ============================================
-- A executer dans l'editeur SQL de Supabase (supabase.com > SQL Editor)

-- 1. Table des utilisateurs/commerciaux
CREATE TABLE commerciaux (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  prenom TEXT NOT NULL,
  nom TEXT NOT NULL DEFAULT '',
  email TEXT UNIQUE NOT NULL,
  telephone TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'commercial' CHECK (role IN ('admin', 'commercial')),
  objectifs JSONB DEFAULT '{"appels_semaine": 50, "rdv_mois": 10, "prospects_mois": 30, "taux_conversion": 20}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Table des prospects
CREATE TABLE prospects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nom_etablissement TEXT NOT NULL,
  type_etablissement TEXT DEFAULT 'autre',
  nom_contact TEXT DEFAULT '',
  telephone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  adresse TEXT DEFAULT '',
  ville TEXT DEFAULT '',
  code_postal TEXT DEFAULT '',
  departement TEXT DEFAULT '',
  secteur TEXT DEFAULT '',
  latitude DOUBLE PRECISION DEFAULT 0,
  longitude DOUBLE PRECISION DEFAULT 0,
  etape_pipeline TEXT DEFAULT 'nouveau',
  tags TEXT[] DEFAULT '{}',
  commercial_id UUID REFERENCES commerciaux(id) ON DELETE SET NULL,
  notes TEXT DEFAULT '',
  score INTEGER DEFAULT 50,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Table des appels
CREATE TABLE calls (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  prospect_id UUID REFERENCES prospects(id) ON DELETE CASCADE,
  commercial_id UUID REFERENCES commerciaux(id) ON DELETE SET NULL,
  date TIMESTAMPTZ DEFAULT NOW(),
  duree INTEGER DEFAULT 0,
  resultat TEXT DEFAULT 'repondu' CHECK (resultat IN ('repondu', 'pas_de_reponse', 'messagerie', 'injoignable')),
  notes TEXT DEFAULT ''
);

-- 4. Table des rendez-vous
CREATE TABLE appointments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  prospect_id UUID REFERENCES prospects(id) ON DELETE CASCADE,
  commercial_id UUID REFERENCES commerciaux(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  heure_debut TEXT DEFAULT '09:00',
  heure_fin TEXT DEFAULT '10:00',
  lieu TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  statut TEXT DEFAULT 'planifie' CHECK (statut IN ('planifie', 'confirme', 'termine', 'annule'))
);

-- 5. Table des rappels
CREATE TABLE reminders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  prospect_id UUID REFERENCES prospects(id) ON DELETE CASCADE,
  commercial_id UUID REFERENCES commerciaux(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  heure TEXT DEFAULT '09:00',
  message TEXT DEFAULT '',
  statut TEXT DEFAULT 'actif' CHECK (statut IN ('actif', 'termine', 'reporte'))
);

-- 6. Table des tags
CREATE TABLE tags (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nom TEXT NOT NULL,
  couleur TEXT DEFAULT '#6b7280'
);

-- 7. Table des templates email
CREATE TABLE email_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nom TEXT NOT NULL,
  sujet TEXT DEFAULT '',
  corps TEXT DEFAULT '',
  type TEXT DEFAULT 'presentation'
);

-- 8. Table des colonnes pipeline (personnalisables)
CREATE TABLE pipeline_columns (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  color TEXT DEFAULT '#6b7280',
  sort_order INTEGER DEFAULT 0
);

-- ============================================
-- Donnees initiales
-- ============================================

-- Colonnes pipeline par defaut
INSERT INTO pipeline_columns (id, label, color, sort_order) VALUES
  ('nouveau', 'Nouveau', '#6b7280', 0),
  ('a_contacter', 'A contacter', '#3b82f6', 1),
  ('contacte', 'Contacte', '#8b5cf6', 2),
  ('rdv_pris', 'RDV pris', '#f59e0b', 3),
  ('proposition', 'Proposition', '#f97316', 4),
  ('negociation', 'Negociation', '#ef4444', 5),
  ('gagne', 'Gagne', '#22c55e', 6),
  ('perdu', 'Perdu', '#dc2626', 7);

-- Utilisateurs par defaut (les mots de passe seront geres par Supabase Auth)
INSERT INTO commerciaux (prenom, nom, email, telephone, role) VALUES
  ('Guillaume', 'Directeur', 'guillaume@labrasseriedesplantes.fr', '06 84 44 40 44', 'admin'),
  ('Louis', 'Alternant', 'louis@labrasseriedesplantes.fr', '06 00 00 00 01', 'commercial'),
  ('Lucas', 'Alternant', 'lucas@labrasseriedesplantes.fr', '06 00 00 00 02', 'commercial');

-- Tags par defaut
INSERT INTO tags (nom, couleur) VALUES
  ('Budget limite', '#ef4444'),
  ('Gros potentiel', '#22c55e'),
  ('Decideur absent', '#eab308'),
  ('Interesse bio', '#3b82f6'),
  ('Deja client concurrent', '#a855f7'),
  ('Evenement prevu', '#f97316'),
  ('A rappeler', '#6b7280');

-- ============================================
-- Row Level Security (RLS)
-- ============================================
-- Activer RLS sur toutes les tables
ALTER TABLE commerciaux ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_columns ENABLE ROW LEVEL SECURITY;

-- Politique: tout utilisateur authentifie peut lire/ecrire (travail collaboratif)
CREATE POLICY "Authenticated users full access" ON commerciaux FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON prospects FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON calls FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON appointments FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON reminders FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON tags FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON email_templates FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON pipeline_columns FOR ALL USING (auth.role() = 'authenticated');

-- Index pour les recherches frequentes
CREATE INDEX idx_prospects_secteur ON prospects(secteur);
CREATE INDEX idx_prospects_pipeline ON prospects(etape_pipeline);
CREATE INDEX idx_prospects_commercial ON prospects(commercial_id);
CREATE INDEX idx_calls_prospect ON calls(prospect_id);
CREATE INDEX idx_calls_commercial ON calls(commercial_id);
CREATE INDEX idx_calls_date ON calls(date DESC);
CREATE INDEX idx_appointments_date ON appointments(date);
CREATE INDEX idx_reminders_date ON reminders(date);
