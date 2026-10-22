-- Cartes QC : schéma initial
-- À exécuter une fois dans Supabase > SQL Editor (ou via `supabase db push`).

-- ---------------------------------------------------------------
-- Table des cartes
-- ---------------------------------------------------------------
create table if not exists public.cartes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,

  -- Fiche (validée par l'utilisateur)
  joueur          text not null check (length(trim(joueur)) > 0),
  equipe          text,
  annee           text,          -- ex. « 2023-24 »
  marque          text,          -- ex. « Upper Deck »
  serie           text,          -- ex. « Ultimate Collection »
  numero          text,          -- numéro de la carte dans la série, ex. « 123 »
  parallele       text,          -- ex. « Silver », « Exclusives »
  numerotation    text,          -- ex. « 519/599 »
  recrue          boolean not null default false,
  jersey          boolean not null default false,
  autographe      boolean not null default false,
  gradee          text,          -- ex. « PSA 9 », vide si non gradée
  quantite        integer not null default 1 check (quantite > 0),
  notes           text,

  -- Photos (chemins dans le bucket « cartes »)
  photo_recto     text,
  photo_verso     text,

  -- Ce que l'IA a proposé, pour mesurer son exactitude
  ia_modele       text,
  ia_proposition  jsonb,
  ia_confiance    text check (ia_confiance in ('haute', 'moyenne', 'basse')),
  champs_corriges text[] not null default '{}',

  -- Valeur (phase 2)
  valeur_estimee  numeric(10, 2),
  valeur_devise   text not null default 'CAD',
  valeur_date     date,

  cree_le         timestamptz not null default now(),
  modifie_le      timestamptz not null default now()
);

create index if not exists cartes_user_idx   on public.cartes (user_id);
create index if not exists cartes_equipe_idx on public.cartes (user_id, equipe);
create index if not exists cartes_joueur_idx on public.cartes (user_id, joueur);

-- Date de modification automatique
create or replace function public.set_modifie_le()
returns trigger language plpgsql as $$
begin
  new.modifie_le := now();
  return new;
end;
$$;

drop trigger if exists cartes_modifie_le on public.cartes;
create trigger cartes_modifie_le
  before update on public.cartes
  for each row execute function public.set_modifie_le();

-- ---------------------------------------------------------------
-- Sécurité : chaque personne ne voit et ne modifie que ses cartes
-- ---------------------------------------------------------------
alter table public.cartes enable row level security;

drop policy if exists "cartes_select_own" on public.cartes;
create policy "cartes_select_own" on public.cartes
  for select using (user_id = auth.uid());

drop policy if exists "cartes_insert_own" on public.cartes;
create policy "cartes_insert_own" on public.cartes
  for insert with check (user_id = auth.uid());

drop policy if exists "cartes_update_own" on public.cartes;
create policy "cartes_update_own" on public.cartes
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "cartes_delete_own" on public.cartes;
create policy "cartes_delete_own" on public.cartes
  for delete using (user_id = auth.uid());

-- Accès explicite pour les personnes connectées seulement (rien pour « anon »).
-- Nécessaire si l'option « Automatically expose new tables » est désactivée.
grant select, insert, update, delete on public.cartes to authenticated;

-- ---------------------------------------------------------------
-- Stockage des photos : bucket privé, un dossier par utilisateur
-- Chemin attendu : <user_id>/<id_carte>-recto.jpg
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cartes', 'cartes', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "photos_select_own" on storage.objects;
create policy "photos_select_own" on storage.objects
  for select using (bucket_id = 'cartes' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "photos_insert_own" on storage.objects;
create policy "photos_insert_own" on storage.objects
  for insert with check (bucket_id = 'cartes' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "photos_update_own" on storage.objects;
create policy "photos_update_own" on storage.objects
  for update using (bucket_id = 'cartes' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "photos_delete_own" on storage.objects;
create policy "photos_delete_own" on storage.objects
  for delete using (bucket_id = 'cartes' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------
-- Vue de suivi : exactitude de l'IA (critère de la phase 1)
-- ---------------------------------------------------------------
create or replace view public.stats_ia
with (security_invoker = true) as
select
  count(*)                                                    as total_cartes,
  count(*) filter (where cardinality(champs_corriges) = 0)    as fiches_justes,
  round(100.0 * count(*) filter (where cardinality(champs_corriges) = 0)
        / nullif(count(*), 0), 1)                             as pct_justes
from public.cartes
where ia_proposition is not null;

grant select on public.stats_ia to authenticated;
