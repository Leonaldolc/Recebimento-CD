/**
 * auth.js
 * Módulo de autenticação com Supabase Auth e consulta de perfis com RLS.
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

let supabase = null;
let perfilAtual = null;
let usuarioAtual = null;

/**
 * Verifica se as credenciais no config.js foram preenchidas.
 * @returns {boolean}
 */
export function configuracaoValida() {
  return (
    SUPABASE_URL &&
    SUPABASE_ANON_KEY &&
    SUPABASE_URL.indexOf('SUA_URL_AQUI') === -1 &&
    SUPABASE_ANON_KEY.indexOf('SUA_CHAVE_ANON') === -1
  );
}

/**
 * Retorna ou inicializa a instância do cliente Supabase.
 * @returns {object|null}
 */
export function obterSupabase() {
  if (supabase) return supabase;
  if (!configuracaoValida()) return null;

  if (typeof window !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function') {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      }
    });
    return supabase;
  } else {
    console.error('Biblioteca @supabase/supabase-js não encontrada no escopo global.');
    return null;
  }
}

/**
 * Realiza login com e-mail e senha.
 * @param {string} email 
 * @param {string} senha 
 * @returns {Promise<{sucesso: boolean, erro?: string, perfil?: object}>}
 */
export async function login(email, senha) {
  const client = obterSupabase();
  if (!client) {
    return { sucesso: false, erro: 'Supabase não configurado em js/config.js' };
  }

  try {
    const { data, error } = await client.auth.signInWithPassword({
      email: email.trim(),
      password: senha
    });

    if (error) {
      return { sucesso: false, erro: traduzirErroAuth(error.message) };
    }

    usuarioAtual = data.user;
    const perfilRes = await carregarPerfil(data.user.id);
    if (!perfilRes.sucesso) {
      return { sucesso: false, erro: perfilRes.erro };
    }

    perfilAtual = perfilRes.perfil;
    return { sucesso: true, perfil: perfilAtual };
  } catch (err) {
    return { sucesso: false, erro: err.message || 'Falha na conexão de login.' };
  }
}

/**
 * Cria uma nova conta de usuário.
 * O primeiro usuário do banco virará ADMIN ativo automaticamente via trigger SQL.
 * Os demais nascem inativos e com papel RECEBIMENTO.
 * @param {string} nome 
 * @param {string} email 
 * @param {string} senha 
 * @returns {Promise<{sucesso: boolean, erro?: string, perfil?: object, aguardando?: boolean}>}
 */
export async function cadastrar(nome, email, senha) {
  const client = obterSupabase();
  if (!client) {
    return { sucesso: false, erro: 'Supabase não configurado em js/config.js' };
  }

  try {
    const { data, error } = await client.auth.signUp({
      email: email.trim(),
      password: senha,
      options: {
        data: {
          nome: nome.trim()
        }
      }
    });

    if (error) {
      return { sucesso: false, erro: traduzirErroAuth(error.message) };
    }

    if (!data.user) {
      return { sucesso: false, erro: 'Não foi possível criar o usuário.' };
    }

    usuarioAtual = data.user;

    // Aguarda 500ms para a trigger do banco criar o perfil
    await new Promise(r => setTimeout(r, 600));

    const perfilRes = await carregarPerfil(data.user.id);
    if (perfilRes.sucesso) {
      perfilAtual = perfilRes.perfil;
      return {
        sucesso: true,
        perfil: perfilAtual,
        aguardando: !perfilAtual.ativo
      };
    }

    return { sucesso: true, aguardando: true };
  } catch (err) {
    return { sucesso: false, erro: err.message || 'Falha ao registrar usuário.' };
  }
}

/**
 * Carrega os dados do perfil na tabela public.perfis.
 * @param {string} userId 
 * @returns {Promise<{sucesso: boolean, perfil?: object, erro?: string}>}
 */
export async function carregarPerfil(userId) {
  const client = obterSupabase();
  if (!client) return { sucesso: false, erro: 'Cliente não disponível' };

  try {
    const { data, error } = await client
      .from('perfis')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      return { sucesso: false, erro: 'Erro ao buscar perfil: ' + error.message };
    }

    if (!data) {
      return { sucesso: false, erro: 'Perfil não encontrado no banco.' };
    }

    perfilAtual = data;
    return { sucesso: true, perfil: data };
  } catch (err) {
    return { sucesso: false, erro: err.message };
  }
}

/**
 * Encerra a sessão atual.
 */
export async function logout() {
  const client = obterSupabase();
  if (client) {
    try {
      await client.auth.signOut();
    } catch (e) {
      console.warn('Erro ao encerrar sessão:', e);
    }
  }
  usuarioAtual = null;
  perfilAtual = null;
}

/**
 * Retorna o usuário e perfil autenticados no momento.
 * @returns {{ usuario: object|null, perfil: object|null }}
 */
export function obterUsuarioAtual() {
  return {
    usuario: usuarioAtual,
    perfil: perfilAtual
  };
}

/**
 * Registra callback de mudança no estado da autenticação.
 * @param {function(string, object): void} callback 
 */
export function onAuthStateChange(callback) {
  const client = obterSupabase();
  if (!client) return;

  client.auth.onAuthStateChange(async (evento, session) => {
    if (session && session.user) {
      usuarioAtual = session.user;
      const res = await carregarPerfil(session.user.id);
      if (res.sucesso) {
        perfilAtual = res.perfil;
      }
    } else {
      usuarioAtual = null;
      perfilAtual = null;
    }
    if (typeof callback === 'function') {
      callback(evento, { usuario: usuarioAtual, perfil: perfilAtual });
    }
  });
}

/**
 * Traduz mensagens técnicas comuns do Supabase Auth para português amigável.
 * @param {string} msg 
 * @returns {string}
 */
function traduzirErroAuth(msg) {
  if (!msg) return 'Erro desconhecido de autenticação.';
  const lower = msg.toLowerCase();
  if (lower.indexOf('invalid login credentials') !== -1) {
    return 'E-mail ou senha incorretos.';
  }
  if (lower.indexOf('user already registered') !== -1) {
    return 'Este e-mail já está cadastrado no sistema.';
  }
  if (lower.indexOf('password should be at least') !== -1) {
    return 'A senha deve conter no mínimo 6 caracteres.';
  }
  if (lower.indexOf('email not confirmed') !== -1) {
    return 'E-mail não confirmado no Supabase. O administrador deve desmarcar "Confirm email" no painel.';
  }
  return msg;
}
