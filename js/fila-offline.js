/**
 * fila-offline.js
 * Gerenciamento de fila de bipes no localStorage para resiliência a quedas de Wi-Fi no galpão.
 */

const STORAGE_KEY = 'chave_nf_fila_offline';
let ouvintesMudancaFila = [];
let sincronizando = false;

/**
 * Registra um ouvinte para quando o tamanho da fila mudar.
 * @param {function(number): void} callback 
 */
export function onMudancaFila(callback) {
  if (typeof callback === 'function') {
    ouvintesMudancaFila.push(callback);
    callback(tamanhoFila());
  }
}

function notificarMudanca() {
  const qtd = tamanhoFila();
  for (let i = 0; i < ouvintesMudancaFila.length; i++) {
    try {
      ouvintesMudancaFila[i](qtd);
    } catch (e) {
      console.error('Erro ao notificar ouvinte de fila:', e);
    }
  }
}

/**
 * Retorna todos os itens da fila armazenada no localStorage.
 * @returns {Array<object>}
 */
export function obterFila() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('Erro ao ler fila offline do localStorage:', e);
    return [];
  }
}

/**
 * Salva a fila no localStorage.
 * @param {Array<object>} itens 
 */
function salvarFila(itens) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(itens));
    notificarMudanca();
  } catch (e) {
    console.error('Erro ao salvar fila offline no localStorage:', e);
  }
}

/**
 * Retorna a quantidade de itens na fila offline.
 * @returns {number}
 */
export function tamanhoFila() {
  return obterFila().length;
}

/**
 * Adiciona um bipe à fila offline com timestamp local.
 * @param {object} bipe 
 * @returns {object}
 */
export function adicionarFila(bipe) {
  const fila = obterFila();
  const item = {
    id: bipe.id || ('local_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9)),
    chave: bipe.chave,
    etapa: bipe.etapa,
    tipo: bipe.tipo,
    cnpj_emitente: bipe.cnpj_emitente,
    nome_emitente: bipe.nome_emitente || '',
    numero_nf: bipe.numero_nf || '',
    serie: bipe.serie || '',
    alerta: bipe.alerta || null,
    usuario_id: bipe.usuario_id,
    usuario_nome: bipe.usuario_nome || '',
    unidade: bipe.unidade || '',
    bipado_em: bipe.bipado_em || new Date().toISOString()
  };

  fila.push(item);
  salvarFila(fila);
  return item;
}

/**
 * Remove um item da fila offline pelo ID.
 * @param {string} id 
 */
export function removerItemFila(id) {
  const fila = obterFila().filter(function(item) {
    return item.id !== id;
  });
  salvarFila(fila);
}

/**
 * Limpa toda a fila offline.
 */
export function limparFila() {
  salvarFila([]);
}

/**
 * Processa o reenvio da fila para o Supabase.
 * @param {object} supabaseClient 
 * @param {function(string, object): void} [onEvento] 
 */
export async function sincronizarFila(supabaseClient, onEvento) {
  if (sincronizando) return;
  if (!navigator.onLine) return;
  if (!supabaseClient) return;

  const fila = obterFila();
  if (fila.length === 0) return;

  sincronizando = true;
  if (onEvento) onEvento('inicio', { total: fila.length });

  try {
    for (let i = 0; i < fila.length; i++) {
      const item = fila[i];

      // Payload para gravação
      const payload = {
        chave: item.chave,
        etapa: item.etapa,
        tipo: item.tipo,
        cnpj_emitente: item.cnpj_emitente,
        nome_emitente: item.nome_emitente,
        numero_nf: item.numero_nf,
        serie: item.serie,
        alerta: item.alerta,
        usuario_id: item.usuario_id,
        usuario_nome: item.usuario_nome,
        unidade: item.unidade,
        bipado_em: item.bipado_em
      };

      try {
        const { data, error } = await supabaseClient
          .from('bipes')
          .insert(payload);

        if (error) {
          // Checagem de duplicidade (código 23505 no Postgres ou mensagem de chave duplicada)
          const isDuplicado = error.code === '23505' ||
            (error.message && error.message.toLowerCase().indexOf('duplicate') !== -1) ||
            (error.message && error.message.toLowerCase().indexOf('unique') !== -1);

          if (isDuplicado) {
            console.warn('[Fila Offline] Nota já havia sido bipada no servidor. Descartando silenciosamente:', item.chave, item.etapa);
            removerItemFila(item.id);
            if (onEvento) onEvento('duplicado_descartado', item);
          } else {
            console.error('[Fila Offline] Erro ao sincronizar item:', error.message, item);
            // Se for erro de validação de regra do banco (ex: falta de recebimento prévio), remove para não travar a fila
            if (error.message && (error.message.indexOf('recebida primeiro') !== -1 || error.message.indexOf('TRANSFERENCIA') !== -1)) {
              removerItemFila(item.id);
              if (onEvento) onEvento('regra_rejeitada', { item, error: error.message });
            } else {
              // Erro de rede ou indisponibilidade temporária: parar sincronização e tentar novamente depois
              break;
            }
          }
        } else {
          // Sucesso
          removerItemFila(item.id);
          if (onEvento) onEvento('item_enviado', item);
        }
      } catch (errRede) {
        console.warn('[Fila Offline] Falha de conexão durante sincronização. Tentará novamente quando restabelecido:', errRede);
        break; // Interrompe para não sobrecarregar
      }
    }
  } finally {
    sincronizando = false;
    if (onEvento) onEvento('fim', { restantes: tamanhoFila() });
  }
}

/**
 * Inicializa os ouvintes de rede e temporizador de sincronização.
 * @param {object} supabaseClient 
 */
export function inicializarSincronizacaoOffline(supabaseClient) {
  // Tentativa imediata quando a conexão online retornar
  window.addEventListener('online', function() {
    console.log('[Fila Offline] Conexão restabelecida. Sincronizando fila...');
    sincronizarFila(supabaseClient);
  });

  // Verificação periódica a cada 15 segundos se houver itens
  setInterval(function() {
    if (tamanhoFila() > 0 && navigator.onLine) {
      sincronizarFila(supabaseClient);
    }
  }, 15000);
}
