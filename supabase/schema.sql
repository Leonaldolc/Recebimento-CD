-- =====================================================================
-- SCHEMA BANCO DE DADOS SUPABASE (POSTGRESQL) — APP "CHAVE DA NF"
-- 100% Idempotente (pode ser executado várias vezes com segurança)
-- =====================================================================

-- 1. Habilitar extensão pgcrypto / uuid se necessário
create extension if not exists "pgcrypto";

-- =====================================================================
-- 2. TABELAS PRINCIPAIS
-- =====================================================================

-- Empresas (Preparado para multiempresa futura)
create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  criado_em timestamptz not null default now()
);

-- Inserir empresa padrão (TK Elevator) se não existir
insert into public.empresas (id, nome)
values ('00000000-0000-0000-0000-000000000001', 'TK Elevator')
on conflict (id) do nothing;

-- Configurações da Empresa
create table if not exists public.configuracoes (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  horas_alerta integer not null default 24,
  atualizado_em timestamptz not null default now()
);

insert into public.configuracoes (empresa_id, horas_alerta)
values ('00000000-0000-0000-0000-000000000001', 24)
on conflict (empresa_id) do nothing;

-- Perfis de Usuários (vinculados ao auth.users do Supabase)
create table if not exists public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,
  email text not null,
  papel text not null check (papel in ('RECEBIMENTO', 'FISCAL', 'ADMIN')),
  unidade text not null default '',
  ativo boolean not null default false,
  criado_em timestamptz not null default now()
);

-- Centros de Distribuição / Fábricas internas (emitem NF de transferência)
create table if not exists public.centros (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  cnpj char(14) not null,
  nome text not null,
  criado_em timestamptz not null default now(),
  primary key (empresa_id, cnpj)
);

-- Fornecedores de Compras
create table if not exists public.fornecedores (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  cnpj char(14) not null,
  nome text not null,
  criado_em timestamptz not null default now(),
  primary key (empresa_id, cnpj)
);

-- Bipes das Notas Fiscais
create table if not exists public.bipes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  chave char(44) not null,
  etapa text not null check (etapa in ('RECEBIMENTO', 'FISCAL', 'ENTRADA_DADA')),
  tipo text not null check (tipo in ('COMPRA', 'TRANSFERENCIA')),
  cnpj_emitente char(14) not null,
  nome_emitente text not null default '',
  numero_nf text not null default '',
  serie text not null default '',
  usuario_id uuid not null references auth.users(id),
  usuario_nome text not null default '',
  unidade text not null default '',
  alerta text,
  bipado_em timestamptz not null default now(),
  -- Uma nota só pode ser bipada uma única vez por etapa na mesma empresa
  constraint uq_bipes_empresa_chave_etapa unique (empresa_id, chave, etapa),
  -- ENTRADA_DADA só faz sentido para transferência
  constraint chk_entrada_apenas_transferencia check (etapa <> 'ENTRADA_DADA' or tipo = 'TRANSFERENCIA')
);

-- Índices essenciais para consultas ultrarrápidas
create index if not exists idx_bipes_empresa_chave on public.bipes(empresa_id, chave);
create index if not exists idx_bipes_empresa_bipado_em on public.bipes(empresa_id, bipado_em);
create index if not exists idx_bipes_empresa_etapa on public.bipes(empresa_id, etapa);

-- Tabela para Fase 2 (armazenamento de XML baixado - não usada na fase 1)
create table if not exists public.nfe_xml (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  chave char(44) not null,
  xml text not null,
  baixado_em timestamptz not null default now(),
  primary key (empresa_id, chave)
);

-- =====================================================================
-- 3. FUNÇÕES AUXILIARES DE SEGURANÇA (SECURITY DEFINER)
-- Evitam recursão infinita e lentidão nas políticas RLS
-- =====================================================================

create or replace function public.minha_empresa()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select empresa_id from public.perfis where id = auth.uid() limit 1;
$$;

create or replace function public.meu_papel()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select papel from public.perfis where id = auth.uid() limit 1;
$$;

create or replace function public.sou_ativo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(ativo, false) from public.perfis where id = auth.uid() limit 1;
$$;

-- =====================================================================
-- 4. TRIGGER DE NOVO USUÁRIO (Criação automática do perfil)
-- Primeiro usuário virará ADMIN ativo automaticamente; os demais ficam inativos.
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_empresa_id uuid;
  v_nome text;
begin
  -- Contar quantos perfis já existem
  select count(*) into v_count from public.perfis;

  -- Buscar primeira empresa
  select id into v_empresa_id from public.empresas order by criado_em asc limit 1;
  if v_empresa_id is null then
    v_empresa_id := '00000000-0000-0000-0000-000000000001';
  end if;

  -- Nome informado nos metadados ou extraído do e-mail
  v_nome := coalesce(
    new.raw_user_meta_data->>'nome',
    split_part(new.email, '@', 1)
  );

  if v_count = 0 then
    -- PRIMEIRO USUÁRIO: ADMIN ATIVO
    insert into public.perfis (id, empresa_id, nome, email, papel, unidade, ativo, criado_em)
    values (new.id, v_empresa_id, v_nome, new.email, 'ADMIN', 'Matriz', true, now())
    on conflict (id) do update set papel = 'ADMIN', ativo = true;
  else
    -- USUÁRIOS SUBSEQUENTES: RECEBIMENTO INATIVO (Aguardando liberação do ADMIN)
    insert into public.perfis (id, empresa_id, nome, email, papel, unidade, ativo, criado_em)
    values (new.id, v_empresa_id, v_nome, new.email, 'RECEBIMENTO', '', false, now())
    on conflict (id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- 5. TRIGGER DE VALIDAÇÃO DE REGRAS DE NEGÓCIO EM BIPES
-- Garante integridade no servidor mesmo se chamado fora do front-end
-- =====================================================================

create or replace function public.validar_bipe_regras()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 1. ENTRADA_DADA só vale para TRANSFERENCIA
  if new.etapa = 'ENTRADA_DADA' and new.tipo <> 'TRANSFERENCIA' then
    raise exception 'A etapa ENTRADA_DADA só é permitida para notas de TRANSFERENCIA.';
  end if;

  -- 2. ENTRADA_DADA exige bipe prévio de RECEBIMENTO
  if new.etapa = 'ENTRADA_DADA' then
    if not exists (
      select 1 from public.bipes
      where empresa_id = new.empresa_id
        and chave = new.chave
        and etapa = 'RECEBIMENTO'
    ) then
      raise exception 'A nota precisa ter sido recebida primeiro antes de dar entrada.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validar_bipe on public.bipes;
create trigger trg_validar_bipe
  before insert on public.bipes
  for each row execute function public.validar_bipe_regras();

-- =====================================================================
-- 6. VIEW DE PENDÊNCIAS (vw_pendencias)
-- Respeita o RLS e isolamento por empresa
-- =====================================================================

create or replace view public.vw_pendencias as
with bipes_agg as (
  select
    b.empresa_id,
    b.chave,
    max(b.tipo) as tipo,
    max(b.cnpj_emitente) as cnpj_emitente,
    max(b.nome_emitente) as nome_emitente,
    max(b.numero_nf) as numero_nf,
    max(b.serie) as serie,
    bool_or(b.etapa = 'RECEBIMENTO') as tem_recebimento,
    bool_or(b.etapa = 'FISCAL') as tem_fiscal,
    bool_or(b.etapa = 'ENTRADA_DADA') as tem_entrada,
    max(case when b.etapa = 'RECEBIMENTO' then b.bipado_em end) as recebido_em,
    max(case when b.etapa = 'RECEBIMENTO' then b.usuario_nome end) as recebido_por,
    max(case when b.etapa = 'RECEBIMENTO' then b.unidade end) as recebido_unidade,
    max(case when b.etapa = 'FISCAL' then b.bipado_em end) as fiscal_em,
    max(case when b.etapa = 'FISCAL' then b.usuario_nome end) as fiscal_por,
    max(case when b.etapa = 'ENTRADA_DADA' then b.bipado_em end) as entrada_em,
    max(case when b.etapa = 'ENTRADA_DADA' then b.usuario_nome end) as entrada_por,
    max(b.bipado_em) as ultimo_bipe_em,
    (array_agg(b.usuario_nome order by b.bipado_em desc))[1] as ultimo_usuario,
    (array_agg(b.etapa order by b.bipado_em desc))[1] as ultima_etapa,
    (array_agg(b.unidade order by b.bipado_em desc))[1] as ultima_unidade
  from public.bipes b
  where b.empresa_id = public.minha_empresa()
  group by b.empresa_id, b.chave
),
classificacao as (
  select
    b.*,
    round(extract(epoch from (now() - b.ultimo_bipe_em)) / 3600.0, 1) as horas_desde_ultimo_bipe,
    case
      -- 1. Compra recebida e não lançada
      when b.tipo = 'COMPRA' and b.tem_recebimento and not b.tem_fiscal then 'COMPRA_SEM_FISCAL'
      -- 2. Transferência sem entrada
      when b.tipo = 'TRANSFERENCIA' and b.tem_recebimento and not b.tem_entrada then 'TRANSFERENCIA_SEM_ENTRADA'
      -- 3. Fiscal sem recebimento
      when (b.tem_fiscal or b.tem_entrada) and not b.tem_recebimento then 'LANCADA_SEM_RECEBIMENTO'
      else null
    end as status_pendencia,
    case
      when b.tipo = 'COMPRA' and b.tem_recebimento and not b.tem_fiscal then 'Perdida entre recebimento e fiscal'
      when b.tipo = 'TRANSFERENCIA' and b.tem_recebimento and not b.tem_entrada then 'Transferência sem entrada dada'
      when (b.tem_fiscal or b.tem_entrada) and not b.tem_recebimento then 'Lançada sem passar pelo recebimento'
      else 'Concluída'
    end as descricao_pendencia
  from bipes_agg b
)
select * from classificacao
where status_pendencia is not null;

-- Função RPC para limpar bipes de teste (ADMIN apenas)
create or replace function public.limpar_dados_teste()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.meu_papel() <> 'ADMIN' then
    raise exception 'Apenas administradores podem limpar dados de teste.';
  end if;
  delete from public.bipes where empresa_id = public.minha_empresa();
end;
$$;

-- =====================================================================
-- 7. ROW LEVEL SECURITY (RLS) EM TODAS AS TABELAS
-- =====================================================================

alter table public.empresas enable row level security;
alter table public.perfis enable row level security;
alter table public.centros enable row level security;
alter table public.fornecedores enable row level security;
alter table public.bipes enable row level security;
alter table public.configuracoes enable row level security;
alter table public.nfe_xml enable row level security;

-- Limpar políticas anteriores para idempotência
drop policy if exists "empresas_select_minha" on public.empresas;
drop policy if exists "perfis_select" on public.perfis;
drop policy if exists "perfis_update_admin" on public.perfis;
drop policy if exists "centros_select" on public.centros;
drop policy if exists "centros_admin_all" on public.centros;
drop policy if exists "fornecedores_select" on public.fornecedores;
drop policy if exists "fornecedores_admin_all" on public.fornecedores;
drop policy if exists "configuracoes_select" on public.configuracoes;
drop policy if exists "configuracoes_admin_all" on public.configuracoes;
drop policy if exists "bipes_select" on public.bipes;
drop policy if exists "bipes_insert" on public.bipes;
drop policy if exists "bipes_delete_admin" on public.bipes;
drop policy if exists "nfe_xml_all" on public.nfe_xml;

-- EMPRESAS
create policy "empresas_select_minha" on public.empresas
  for select using (id = public.minha_empresa());

-- PERFIS
-- Cada um lê o próprio perfil; ADMIN lê todos da sua empresa
create policy "perfis_select" on public.perfis
  for select using (
    id = auth.uid() or (empresa_id = public.minha_empresa() and public.meu_papel() = 'ADMIN')
  );

-- Apenas ADMIN atualiza perfis (liberar usuário, alterar papel ou unidade)
create policy "perfis_update_admin" on public.perfis
  for update using (
    empresa_id = public.minha_empresa() and public.meu_papel() = 'ADMIN' and public.sou_ativo()
  );

-- CENTROS
create policy "centros_select" on public.centros
  for select using (empresa_id = public.minha_empresa() and public.sou_ativo());

create policy "centros_admin_all" on public.centros
  for all using (
    empresa_id = public.minha_empresa() and public.meu_papel() = 'ADMIN' and public.sou_ativo()
  );

-- FORNECEDORES
create policy "fornecedores_select" on public.fornecedores
  for select using (empresa_id = public.minha_empresa() and public.sou_ativo());

create policy "fornecedores_admin_all" on public.fornecedores
  for all using (
    empresa_id = public.minha_empresa() and public.meu_papel() = 'ADMIN' and public.sou_ativo()
  );

-- CONFIGURAÇÕES
create policy "configuracoes_select" on public.configuracoes
  for select using (empresa_id = public.minha_empresa() and public.sou_ativo());

create policy "configuracoes_admin_all" on public.configuracoes
  for all using (
    empresa_id = public.minha_empresa() and public.meu_papel() = 'ADMIN' and public.sou_ativo()
  );

-- BIPES
-- Leitura: qualquer usuário ativo lê os bipes da sua empresa
create policy "bipes_select" on public.bipes
  for select using (empresa_id = public.minha_empresa() and public.sou_ativo());

-- Inserção: apenas usuário ativo, com seu próprio auth.uid(), e nas etapas autorizadas ao seu papel
create policy "bipes_insert" on public.bipes
  for insert with check (
    empresa_id = public.minha_empresa() and
    public.sou_ativo() and
    usuario_id = auth.uid() and (
      public.meu_papel() = 'ADMIN' or
      (public.meu_papel() = 'RECEBIMENTO' and etapa in ('RECEBIMENTO', 'ENTRADA_DADA')) or
      (public.meu_papel() = 'FISCAL' and etapa = 'FISCAL')
    )
  );

-- Exclusão: NENHUM operador pode excluir; APENAS ADMIN pode excluir
create policy "bipes_delete_admin" on public.bipes
  for delete using (
    empresa_id = public.minha_empresa() and
    public.meu_papel() = 'ADMIN' and
    public.sou_ativo()
  );

-- NFE_XML (Fase 2)
create policy "nfe_xml_all" on public.nfe_xml
  for all using (
    empresa_id = public.minha_empresa() and
    public.meu_papel() = 'ADMIN' and
    public.sou_ativo()
  );
